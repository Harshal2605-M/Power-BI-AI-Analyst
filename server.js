const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const MCP_PATH = 'C:\\Users\\harsh\\Downloads\\analysis-services.powerbi-modeling-mcp-0.1.9@win32-x64\\extension\\server\\powerbi-modeling-mcp.exe';

class McpBridge {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.callbacks = new Map();
    this.requestId = 0;
    this.activeConnection = null;
    
    this.startServer();
  }

  startServer() {
    console.log(`Spawning MCP server: ${MCP_PATH}`);
    this.child = spawn(MCP_PATH, ['--start']);

    this.child.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.child.stderr.on('data', (data) => {
      console.error('[MCP Server Error]:', data.toString().trim());
    });

    this.child.on('close', (code) => {
      console.log(`MCP server closed with code ${code}. Restarting...`);
      setTimeout(() => this.startServer(), 2000);
    });
  }

  processBuffer() {
    // Process JSON-RPC lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep partial line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line.trim());
        if (message.id !== undefined && this.callbacks.has(message.id)) {
          const { resolve, reject } = this.callbacks.get(message.id);
          this.callbacks.delete(message.id);
          
          if (message.error) {
            reject(message.error);
          } else {
            resolve(message.result);
          }
        }
      } catch (err) {
        // Not valid json, ignore or append back
      }
    }
  }

  callTool(toolName, args = {}) {
    return new Promise((resolve, reject) => {
      this.requestId++;
      const id = this.requestId;
      
      this.callbacks.set(id, { resolve, reject });

      const request = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        },
        id
      };

      console.log(`[JSON-RPC Outbound]: Calling tool "${toolName}" (Request ID: ${id})`);
      this.child.stdin.write(JSON.stringify(request) + '\n');

      // Set a 30-second timeout
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error('JSON-RPC Request Timeout after 30 seconds'));
        }
      }, 30000);
    });
  }
}

const bridge = new McpBridge();

// --- REST API ENDPOINTS ---

// Check Status
app.get('/api/status', (req, res) => {
  res.json({
    status: bridge.child ? 'running' : 'stopped',
    activeConnection: bridge.activeConnection,
    serverExecutable: MCP_PATH
  });
});

// List Open Power BI Desktop local instances
app.get('/api/instances', async (req, res) => {
  try {
    const result = await bridge.callTool('connection_operations', {
      request: {
        operation: 'ListLocalInstances'
      }
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect to a local instance (port)
app.post('/api/connect', async (req, res) => {
  const { dataSource } = req.body;
  if (!dataSource) {
    return res.status(400).json({ error: 'dataSource parameter is required (e.g. localhost:51234)' });
  }

  try {
    console.log(`Connecting to local data source: ${dataSource}`);
    const result = await bridge.callTool('connection_operations', {
      request: {
        operation: 'Connect',
        connectionString: `Provider=MSOLAP;Data Source=${dataSource}`
      }
    });

    // Check if connection succeeded
    if (result && result.content && result.content[0]) {
      const connInfo = JSON.parse(result.content[0].text);
      bridge.activeConnection = connInfo.connectionName || 'Local Connection';
    } else {
      bridge.activeConnection = 'Local Connection';
    }

    res.json({ success: true, activeConnection: bridge.activeConnection, details: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect to a Fabric Workspace Model
app.post('/api/connect-fabric', async (req, res) => {
  const { workspaceName, semanticModelName } = req.body;
  if (!workspaceName || !semanticModelName) {
    return res.status(400).json({ error: 'workspaceName and semanticModelName are required' });
  }

  try {
    const result = await bridge.callTool('connection_operations', {
      request: {
        operation: 'ConnectFabric',
        workspaceName,
        semanticModelName
      }
    });

    if (result && result.content && result.content[0]) {
      const connInfo = JSON.parse(result.content[0].text);
      bridge.activeConnection = connInfo.connectionName || `${workspaceName} - ${semanticModelName}`;
    } else {
      bridge.activeConnection = `${workspaceName} - ${semanticModelName}`;
    }

    res.json({ success: true, activeConnection: bridge.activeConnection, details: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Tables in active connection model
app.get('/api/tables', async (req, res) => {
  try {
    const result = await bridge.callTool('table_operations', {
      request: {
        operation: 'List'
      }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute DAX Query against active connection model
app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'DAX query parameter is required' });
  }

  try {
    const result = await bridge.callTool('dax_query_operations', {
      request: {
        operation: 'Execute',
        query,
        executionMetricsOnly: false, // Critical to get actual row records
        getExecutionMetrics: true
      }
    });

    // Parse the MCP output. Standard MCP responses return an array of contents,
    // usually returning raw text that is a JSON block representing rows and metrics.
    if (result && result.content && result.content[0]) {
      const payload = JSON.parse(result.content[0].text);
      
      // Map it back to standard DaxResult: { columns: string[], rows: object[] }
      if (payload && payload.rows) {
        const rows = payload.rows;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return res.json({
          columns,
          rows,
          executionTimeMs: payload.executionMetrics?.durationMs || 10
        });
      }
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PowerBI MCP Bridge Server running on http://localhost:${PORT}`);
});
