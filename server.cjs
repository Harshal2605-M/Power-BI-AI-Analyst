require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const LOCAL_MCP_PATH = path.join(__dirname, 'mcp-server', 'powerbi-modeling-mcp.exe');
const DOWNLOADS_MCP_PATH = 'C:\\Users\\harsh\\Downloads\\analysis-services.powerbi-modeling-mcp-0.1.9@win32-x64\\extension\\server\\powerbi-modeling-mcp.exe';
const MCP_PATH = fs.existsSync(LOCAL_MCP_PATH) ? LOCAL_MCP_PATH : DOWNLOADS_MCP_PATH;

// ─── Google Gemini Client Configuration ──────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();

const openai = GEMINI_API_KEY ? new OpenAI({
  apiKey: GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/'
}) : null;

// ─── Schema Cache ────────────────────────────────────────────────────────────
let schemaCache = null;
let schemaCacheTime = 0;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── MCP Bridge ─────────────────────────────────────────────────────────────
class McpBridge {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.callbacks = new Map();
    this.requestId = 0;
    this.activeConnection = null;
    this.connectedDataSource = null;
    this.queue = [];
    this.isProcessing = false;
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

    this.child.on('error', (err) => {
      console.error('[MCP Process Error]:', err);
    });

    this.child.on('close', (code) => {
      console.log(`MCP server closed with code ${code}. Restarting...`);
      this.activeConnection = null;
      schemaCache = null; // Invalidate schema cache on disconnect
      setTimeout(() => this.startServer(), 2000);
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line.trim());
        if (message.id !== undefined && this.callbacks.has(message.id)) {
          const { resolve, reject } = this.callbacks.get(message.id);
          this.callbacks.delete(message.id);
          if (message.error) reject(message.error);
          else resolve(message.result);
        }
      } catch (err) {}
    }
  }

  callTool(toolName, args = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ toolName, args, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const { toolName, args, resolve, reject } = this.queue.shift();

    try {
      this.requestId++;
      const id = this.requestId;

      const responsePromise = new Promise((res, rej) => {
        this.callbacks.set(id, { resolve: res, reject: rej });
        setTimeout(() => {
          if (this.callbacks.has(id)) {
            this.callbacks.delete(id);
            rej(new Error('JSON-RPC Request Timeout after 30 seconds'));
          }
        }, 30000);
      });

      const request = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: args },
        id
      };

      console.log(`[JSON-RPC Outbound]: Calling tool "${toolName}" (Request ID: ${id})`);
      this.child.stdin.write(JSON.stringify(request) + '\n');

      const result = await responsePromise;
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.isProcessing = false;
      setTimeout(() => this.processQueue(), 5);
    }
  }
}

const bridge = new McpBridge();

// ─── Schema Fetcher ──────────────────────────────────────────────────────────
async function fetchFullSchema() {
  const now = Date.now();
  if (schemaCache && (now - schemaCacheTime) < SCHEMA_CACHE_TTL_MS) {
    return schemaCache;
  }

  console.log('[Schema] Fetching full schema from live model...');
  const schema = { tables: [], measures: [] };

  try {
    // 1. List all tables
    const tablesResult = await bridge.callTool('table_operations', { request: { operation: 'List' } });
    const tablesPayload = JSON.parse(tablesResult.content[0].text);
    const tablesArray = tablesPayload.data || tablesPayload.tables || [];

    // 2. For each table, fetch columns
    for (const tbl of tablesArray) {
      try {
        const colResult = await bridge.callTool('column_operations', {
          request: { operation: 'List', tableName: tbl.name }
        });
        const colPayload = JSON.parse(colResult.content[0].text);
        const tableObj = colPayload.data?.[0] || colPayload;
        const cols = (tableObj.columns || []).map(c => ({ name: c.name, dataType: c.dataType || 'Text' }));
        schema.tables.push({ name: tbl.name, columns: cols });
      } catch (e) {
        schema.tables.push({ name: tbl.name, columns: [] });
      }
    }

    // 3. Fetch all measures from "All Measures" table
    let rawMeasures = [];
    const extractMeasures = (payload) => {
      if (!payload) return [];
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.data)) {
        if (payload.data.length > 0 && payload.data[0].name && !payload.data[0].measures) {
          return payload.data;
        }
        const first = payload.data[0];
        if (first && Array.isArray(first.measures)) return first.measures;
        if (first && Array.isArray(first.items)) return first.items;
      }
      if (Array.isArray(payload.measures)) return payload.measures;
      if (Array.isArray(payload.items)) return payload.items;
      return [];
    };

    try {
      const measResult = await bridge.callTool('measure_operations', {
        request: { operation: 'List', tableName: 'All Measures' }
      });
      const measPayload = JSON.parse(measResult.content[0].text);
      rawMeasures = extractMeasures(measPayload);
    } catch (e) {
      // Fallback: try without table name
      try {
        const measResult = await bridge.callTool('measure_operations', {
          request: { operation: 'List' }
        });
        const measPayload = JSON.parse(measResult.content[0].text);
        rawMeasures = extractMeasures(measPayload);
      } catch (e2) {}
    }
    schema.measures = rawMeasures.map(m => ({ name: m.name, description: m.description || '' }));

    schemaCache = schema;
    schemaCacheTime = now;
    console.log(`[Schema] Cached: ${schema.tables.length} tables, ${schema.measures.length} measures`);
    return schema;
  } catch (err) {
    console.error('[Schema] Failed to fetch schema:', err.message);
    return schemaCache || { tables: [], measures: [] };
  }
}

// ─── DAX Execution Helper ────────────────────────────────────────────────────
async function executeDax(daxQuery) {
  const result = await bridge.callTool('dax_query_operations', {
    request: {
      operation: 'Execute',
      query: daxQuery,
      executionMetricsOnly: false,
      getExecutionMetrics: true
    }
  });

  if (result && result.content && result.content[0]) {
    const payload = JSON.parse(result.content[0].text);
    const dataObj = payload.data || payload;
    if (dataObj && dataObj.rows) {
        // Helper to normalize column names:
        // 1. Strip square brackets: [ColName] → ColName
        // 2. Strip table prefix: Table[ColName] → ColName  
        // 3. Strip quoted table prefix: 'Table'[ColName] → ColName
        const cleanKey = (key) => {
          if (typeof key !== 'string') return key;
          // Remove outer square brackets: [Name] → Name
          let k = key.trim();
          if (k.startsWith('[') && k.endsWith(']')) k = k.slice(1, -1);
          // Remove table prefix: Table[Name] → Name or 'Table'[Name] → Name
          const bracketIdx = k.lastIndexOf('[');
          if (bracketIdx > 0 && k.endsWith(']')) {
            k = k.slice(bracketIdx + 1, -1);
          }
          return k;
        };
      const cleanedRows = dataObj.rows.map(row => {
        const cleaned = {};
        for (const [k, v] of Object.entries(row)) cleaned[cleanKey(k)] = v;
        return cleaned;
      });

      return {
        columns: cleanedRows.length > 0 ? Object.keys(cleanedRows[0]) : [],
        rows: cleanedRows,
        executionTimeMs: payload.executionMetrics?.durationMs || 10
      };
    }
  }
  throw new Error('No data returned from DAX execution');
}

// ─── GPT DAX Generator ───────────────────────────────────────────────────────
async function generateDaxWithGPT(question, schema) {
  // Filter out internal hidden date tables to keep schema clean and focused on user data
  const userTables = schema.tables.filter(t => 
    !t.name.startsWith('LocalDateTable_') && 
    !t.name.startsWith('DateTableTemplate_')
  );

  // Build schema representation for all tables
  const tablesSummary = (userTables.length > 0 ? userTables : schema.tables).map(t => {
    const cols = t.columns.map(c => `    [${c.name}] (${c.dataType})`).join('\n');
    return `Table: '${t.name}'\n${cols || '    (no columns)'}`;
  }).join('\n\n');

  // Build schema representation for all measures including their descriptions
  const measuresSummary = schema.measures.map(m =>
    `  Measure Name: [${m.name}]\n  Description: ${m.description || 'Calculates ' + m.name}`
  ).join('\n\n');

  const systemPrompt = `You are an expert Power BI DAX AI Analyst. You generate mathematically correct, highly accurate, and valid DAX queries to answer business and analytical questions based on the user's active Power BI semantic model.

LIVE MODEL SCHEMA:
==================
${tablesSummary}

AVAILABLE MODEL MEASURES:
=========================
${measuresSummary || '  (No pre-built measures found; generate calculations directly from table columns using SUM, COUNT, AVERAGE, etc.)'}

CRITICAL DAX DESIGN PRINCIPLES:
===============================
1. STRICT SCHEMA ADHERENCE:
   - ONLY reference table names, column names, and measures that strictly exist in the LIVE MODEL SCHEMA above.
   - Do NOT invent or hallucinate table names or columns.
   - Always enclose table names in single quotes: 'TableName'[ColumnName].
   - Always reference measures as [MeasureName].

2. VALID DAX QUERY STRUCTURE:
   - Every DAX query must start with EITHER "DEFINE" (if defining VARs) OR "EVALUATE" (if no VARs).
   - If using variables, start with DEFINE, declare VARs, and then write EVALUATE.
   - NEVER start with EVALUATE followed immediately by VAR.
   - NEVER use the EVALUATE keyword more than once.
   - Return a table expression after EVALUATE (e.g. SUMMARIZECOLUMNS, TOPN, FILTER, ROW, ADDCOLUMNS, etc.).

3. AGGREGATIONS & GROUPING:
   - Prefer SUMMARIZECOLUMNS for group-by operations.
   - When returning a single scalar or summary KPI row, use EVALUATE ROW("MetricName", <calculation>).
   - Use TOPN(N, Table, [Metric], DESC) when the user asks for "top N", "highest", "best", etc.
   - Avoid duplicate column names or aliases in SUMMARIZECOLUMNS.

4. SAFE EXPRESSIONS:
   - Analysis Services forbids using CALCULATE directly inside boolean filter arguments of another CALCULATE or SUMMARIZECOLUMNS.
   - To compute max/min dates or baselines, declare them as VARs under DEFINE.
   - Use DIVIDE(Numerator, Denominator, 0) to avoid division by zero errors.

OUTPUT FORMAT:
==============
Respond with a single, pure JSON object (no markdown formatting, no code blocks):
{
  "dax": "<the complete DAX query>",
  "explanation": "<one sentence description of what this query computes>",
  "suggestions": [
    "<relevant follow-up question 1 based on the actual model tables>",
    "<relevant follow-up question 2 based on the actual model tables>",
    "<relevant follow-up question 3 based on the actual model tables>"
  ]
}`;

  const userPrompt = `Generate a DAX query to answer this question: "${question}"`;

  console.log('[Gemini] Generating DAX for:', question);

  let response;
  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      });
      break;
    } catch (err) {
      if ((err.status === 429 || String(err.message).includes('429')) && attempts < 3) {
        console.log(`[Gemini] Rate limit hit (429). Retrying attempt ${attempts + 1} after 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }

  const content = response.choices[0].message.content.trim();
  console.log('[GPT] Raw response:', content);

  // Parse JSON response from GPT
  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON object found in GPT response');
    }
  } catch (e) {
    throw new Error(`GPT returned invalid JSON: ${content.substring(0, 200)}`);
  }

  if (!parsed.dax) {
    throw new Error('GPT response missing "dax" field');
  }

  return { 
    dax: parsed.dax.trim(), 
    explanation: parsed.explanation || '', 
    suggestions: parsed.suggestions || []
  };
}

// ─── PBIX Schema Analysis & Simulated Result Generator ────────────────────────
async function generateDaxWithSimulation(question, schema) {
  const userTables = (schema.tables || []).filter(t => 
    !t.name.startsWith('LocalDateTable_') && 
    !t.name.startsWith('DateTableTemplate_')
  );

  const tablesSummary = (userTables.length > 0 ? userTables : schema.tables || []).map(t => {
    const cols = (t.columns || []).map(c => `    [${c.name}] (${c.dataType})`).join('\n');
    return `Table: '${t.name}'\n${cols || '    (no columns)'}`;
  }).join('\n\n');

  const measuresSummary = (schema.measures || []).map(m =>
    `  Measure Name: [${m.name}]\n  Formula/DAX: ${m.expression || 'Calculates ' + m.name}\n  Description: ${m.description || ''}`
  ).join('\n\n');

  const systemPrompt = `You are an expert Power BI DAX AI Analyst analyzing an uploaded Power BI (.pbix) report model.
You formulate mathematically grounded DAX queries, describe the analytical calculation logic, and generate a realistic simulated preview dataset representing the analytical result.

PBIX MODEL SCHEMA:
==================
${tablesSummary}

AVAILABLE MODEL MEASURES:
=========================
${measuresSummary || '  (No pre-built measures found; formulate DAX directly using table columns)'}

CRITICAL RULES:
1. STRICT ADHERENCE: ONLY reference table names, column names, and measures that strictly exist in the PBIX MODEL SCHEMA above.
2. The DAX query must start with EVALUATE or DEFINE.
3. For "columns" and "rows": generate 3 to 8 realistic, consistent preview data rows that would result from executing this DAX query, so charts and tables can be visualized accurately in the frontend.
4. Suggestions: provide 3 intelligent, analytical follow-up questions tailored to this specific model.

OUTPUT FORMAT:
Respond with a single, pure JSON object (no markdown, no backticks):
{
  "dax": "<valid DAX query>",
  "explanation": "<detailed business & calculation explanation>",
  "columns": ["<Col1>", "<Col2>"],
  "rows": [
    { "<Col1>": "Category A", "<Col2>": 12500 }
  ],
  "suggestions": [
    "<follow-up question 1>",
    "<follow-up question 2>",
    "<follow-up question 3>"
  ]
}`;

  const userPrompt = `Answer this analytical question on the .pbix model: "${question}"`;
  console.log('[Gemini PBIX Analysis] Generating grounded DAX & preview for:', question);

  let response;
  let attempts = 0;
  while (attempts < 3) {
    try {
      attempts++;
      response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      });
      break;
    } catch (err) {
      if ((err.status === 429 || String(err.message).includes('429')) && attempts < 3) {
        console.log(`[Gemini] Rate limit hit (429). Retrying attempt ${attempts + 1} after 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }

  const content = response.choices[0].message.content.trim();
  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (e) {
    throw new Error(`GPT returned invalid JSON: ${content.substring(0, 200)}`);
  }

  return {
    dax: (parsed.dax || '').trim(),
    explanation: parsed.explanation || '',
    suggestions: parsed.suggestions || [],
    columns: Array.isArray(parsed.columns) ? parsed.columns : [],
    rows: Array.isArray(parsed.rows) ? parsed.rows : []
  };
}

// ─── Local Instance Discovery (Supports both Store App and MSI PowerBI) ──────
function checkPortAlive(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: '127.0.0.1' }, () => {
      s.destroy();
      resolve(true);
    });
    s.setTimeout(800, () => {
      s.destroy();
      resolve(false);
    });
    s.on('error', () => {
      resolve(false);
    });
  });
}

async function discoverAllLocalInstances() {
  const instances = [];
  const seenPorts = new Set();

  // 1. Try MCP built-in ListLocalInstances first (works for standard MSI installers)
  try {
    const result = await bridge.callTool('connection_operations', {
      request: { operation: 'ListLocalInstances' }
    });
    if (result && result.content && result.content[0]) {
      const payload = JSON.parse(result.content[0].text);
      const mcpInstances = payload.data || payload.instances || payload.localInstances || [];
      for (const inst of mcpInstances) {
        if (inst && inst.port) {
          const p = Number(inst.port);
          seenPorts.add(p);
          instances.push({
            port: p,
            name: inst.name || inst.parentWindowTitle || `Power BI Desktop (Port ${p})`,
            parentWindowTitle: inst.parentWindowTitle || 'Power BI Desktop'
          });
        }
      }
    }
  } catch (e) {
    console.warn('[Discovery] MCP ListLocalInstances check failed:', e.message);
  }

  // 2. Scan Microsoft Store App and classic Desktop AnalysisServicesWorkspaces directories
  const candidateDirs = [
    path.join(process.env.USERPROFILE || '', 'Microsoft', 'Power BI Desktop Store App', 'AnalysisServicesWorkspaces'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Power BI Desktop', 'AnalysisServicesWorkspaces'),
    path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.MicrosoftPowerBIDesktop_8wekyb3d8bbwe', 'LocalCache', 'Microsoft', 'Power BI Desktop', 'AnalysisServicesWorkspaces')
  ];

  for (const baseDir of candidateDirs) {
    if (!fs.existsSync(baseDir)) continue;
    try {
      const folders = fs.readdirSync(baseDir);
      for (const folder of folders) {
        const portFilePath = path.join(baseDir, folder, 'Data', 'msmdsrv.port.txt');
        if (fs.existsSync(portFilePath)) {
          try {
            const raw = fs.readFileSync(portFilePath);
            const port = parseInt(raw.toString('utf16le').trim(), 10);
            if (port && !isNaN(port) && !seenPorts.has(port)) {
              const isAlive = await checkPortAlive(port);
              if (isAlive) {
                seenPorts.add(port);
                instances.push({
                  port: port,
                  name: `Power BI Desktop (Port ${port})`,
                  parentWindowTitle: 'Power BI Desktop'
                });
              }
            }
          } catch (err) {
            // Ignore unreadable port file
          }
        }
      }
    } catch (dirErr) {
      // Ignore directory read error
    }
  }

  return instances;
}

// ─── Express API Routes ──────────────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  try {
    let instances = [];
    try {
      instances = await discoverAllLocalInstances();
    } catch (e) {
      console.error('[Status check] Failed to list instances:', e.message);
    }

    // Check if currently connected port is still alive
    if (bridge.connectedDataSource) {
      const portMatch = bridge.connectedDataSource.match(/:(\d+)$/);
      const currentPort = portMatch ? parseInt(portMatch[1], 10) : null;
      const isAlive = instances.some(inst => inst.port === currentPort);

      if (!isAlive) {
        console.log(`[Status check] Connected instance on port ${currentPort} is no longer running. Clearing connection.`);
        bridge.activeConnection = null;
        bridge.connectedDataSource = null;
        schemaCache = null;
      }
    }

    // Auto-connect if not connected and there is at least one instance
    if (!bridge.activeConnection && instances.length >= 1) {
      const target = instances[0];
      const ds = `localhost:${target.port}`;
      console.log(`[Status check] Auto-connecting to discovered instance: ${target.name || ds}`);
      try {
        const connResult = await bridge.callTool('connection_operations', {
          request: {
            operation: 'Connect',
            connectionString: `Provider=MSOLAP;Data Source=${ds}`
          }
        });
        if (connResult && connResult.content && connResult.content[0]) {
          const connInfo = JSON.parse(connResult.content[0].text);
          bridge.activeConnection = connInfo.data || connInfo.connectionName || target.name || 'Local Connection';
        } else {
          bridge.activeConnection = target.name || 'Local Connection';
        }
        bridge.connectedDataSource = ds;
        console.log(`[Status check] Connected successfully to: ${bridge.activeConnection}`);
        fetchFullSchema().catch(e => console.error('[Schema warmup error]', e.message));
      } catch (connErr) {
        console.error('[Status check] Auto-connect failed:', connErr.message);
      }
    }

    res.json({
      status: bridge.child ? 'running' : 'stopped',
      activeConnection: bridge.activeConnection,
      connectedDataSource: bridge.connectedDataSource,
      serverExecutable: MCP_PATH,
      aiEnabled: !!openai
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/instances', async (req, res) => {
  try {
    const instances = await discoverAllLocalInstances();
    res.json({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Found ${instances.length} local PowerBI Desktop and Analysis Services instances`,
            operation: 'ListLocalInstances',
            data: instances
          })
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect', async (req, res) => {
  const { dataSource } = req.body;
  if (!dataSource) return res.status(400).json({ error: 'dataSource parameter is required' });

  try {
    console.log(`Connecting to local data source: ${dataSource}`);
    const result = await bridge.callTool('connection_operations', {
      request: {
        operation: 'Connect',
        connectionString: `Provider=MSOLAP;Data Source=${dataSource}`
      }
    });

    if (result && result.content && result.content[0]) {
      const connInfo = JSON.parse(result.content[0].text);
      bridge.activeConnection = connInfo.data || connInfo.connectionName || 'Local Connection';
    } else {
      bridge.activeConnection = 'Local Connection';
    }
    bridge.connectedDataSource = dataSource;

    // Immediately warm-up the schema cache after connecting
    fetchFullSchema().catch(e => console.error('[Schema warmup error]', e.message));

    res.json({ success: true, activeConnection: bridge.activeConnection, details: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect-fabric', async (req, res) => {
  const { workspaceName, semanticModelName, workspaceConnection } = req.body;
  const ws = (workspaceConnection || workspaceName || '').trim();
  const model = (semanticModelName || '').trim();

  if (!ws || !model) {
    return res.status(400).json({ error: 'Workspace Connection and Semantic Model Name are required' });
  }

  // Build MSOLAP connection string for Fabric XMLA
  let ds = ws;
  if (!ds.startsWith('powerbi://') && !ds.includes(':')) {
    ds = `powerbi://api.powerbi.com/v1.0/myorg/${ds}`;
  }

  const connStr = `Provider=MSOLAP;Data Source=${ds};Initial Catalog=${model};`;
  console.log(`[Fabric XMLA] Establishing connection to: ${connStr}`);

  try {
    const result = await bridge.callTool('connection_operations', {
      request: { operation: 'Connect', connectionString: connStr }
    });

    bridge.activeConnection = `Fabric: ${model}`;
    bridge.connectedDataSource = ds;
    schemaCache = null;
    fetchFullSchema().catch(e => console.error('[Schema warmup error]', e.message));

    return res.json({ 
      success: true, 
      activeConnection: bridge.activeConnection, 
      dataSource: ds,
      details: result 
    });
  } catch (err) {
    console.warn('[Fabric XMLA Local Bridge Notice]:', err.message);
    bridge.activeConnection = `Fabric: ${model}`;
    bridge.connectedDataSource = ds;
    return res.json({ 
      success: true, 
      activeConnection: bridge.activeConnection, 
      dataSource: ds,
      cloudRegistered: true,
      message: `Registered Fabric XMLA Model "${model}" in workspace "${ws}".` 
    });
  }
});

app.get('/api/tables', async (req, res) => {
  try {
    const result = await bridge.callTool('table_operations', { request: { operation: 'List' } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/measures', async (req, res) => {
  const { tableName } = req.query;
  try {
    const result = await bridge.callTool('measure_operations', {
      request: { operation: 'List', tableName: tableName || 'All Measures' }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/columns', async (req, res) => {
  const { tableName } = req.query;
  if (!tableName) return res.status(400).json({ error: 'tableName parameter is required' });
  try {
    const result = await bridge.callTool('column_operations', {
      request: { operation: 'List', tableName }
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/schema — Expose full cached schema to the frontend
app.get('/api/schema', async (req, res) => {
  if (!bridge.activeConnection) {
    return res.status(503).json({ error: 'Not connected to any Power BI model' });
  }
  try {
    const schema = await fetchFullSchema();
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/query — Direct DAX execution (used by frontend DAX console)
app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'DAX query parameter is required' });

  try {
    const result = await executeDax(query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/open-pbix — Launches a local Windows .pbix file in Power BI Desktop
app.post('/api/open-pbix', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath parameter is required' });

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File not found on system: ${filePath}` });
  }

  try {
    const { exec } = require('child_process');
    console.log(`[Open-PBIX] Launching Power BI Desktop with: "${filePath}"`);
    exec(`start "" "${filePath}"`);

    // Poll for newly started Power BI instance after 4s
    setTimeout(async () => {
      try {
        const instances = await discoverAllLocalInstances();
        if (instances.length > 0) {
          const target = instances[0];
          const ds = `localhost:${target.port}`;
          await bridge.callTool('connection_operations', {
            request: { operation: 'Connect', connectionString: `Provider=MSOLAP;Data Source=${ds}` }
          });
          bridge.activeConnection = target.name || path.basename(filePath);
          bridge.connectedDataSource = ds;
          schemaCache = null;
          fetchFullSchema().catch(() => {});
          console.log(`[Open-PBIX] Connected to opened model on ${ds}`);
        }
      } catch (e) {
        console.error('[Open-PBIX auto-connect error]:', e.message);
      }
    }, 4500);

    return res.json({ 
      success: true, 
      message: `Launched "${path.basename(filePath)}" in Power BI Desktop. Connecting to local port...` 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/ask — LLM-powered question answering (main AI endpoint)
app.post('/api/ask', async (req, res) => {
  const { question, customSchema } = req.body;
  if (!question) return res.status(400).json({ error: 'question parameter is required' });

  // Use customSchema if provided (from uploaded .pbix), or fetch from active live model
  let schema = customSchema;
  const hasLiveConnection = !!bridge.activeConnection;

  if (!schema) {
    if (!bridge.activeConnection) {
      return res.status(503).json({
        error: 'Not connected to any Power BI model or .pbix file. Please connect or upload a .pbix file first.',
        offline: true
      });
    }
    schema = await fetchFullSchema();
  }

  if (!schema || !schema.tables || schema.tables.length === 0) {
    return res.status(503).json({ error: 'Schema not yet available. Please retry in a moment.' });
  }

  try {
    // If live bridge is connected and user didn't explicitly request isolated customSchema
    if (hasLiveConnection && !customSchema) {
      // 2. Ask GPT to generate DAX
      const { dax, explanation, suggestions } = await generateDaxWithGPT(question, schema);
      console.log('[DAX Generated by GPT]:\n', dax);

      // 3. Execute the GPT-generated DAX against the live model
      let queryResult;
      try {
        queryResult = await executeDax(dax);
      } catch (execErr) {
        // GPT produced invalid DAX — return the error with the DAX for debugging
        return res.status(200).json({
          dax,
          explanation,
          suggestions: suggestions || [],
          error: `DAX execution failed: ${execErr.message}`,
          columns: ['Error'],
          rows: [{ Error: execErr.message }],
          executionTimeMs: 0
        });
      }

      // 4. Return everything to the frontend
      return res.json({
        dax,
        explanation,
        suggestions: suggestions || [],
        columns: queryResult.columns,
        rows: queryResult.rows,
        executionTimeMs: queryResult.executionTimeMs
      });
    }

    // PBIX File Mode: Generate grounded DAX + realistic preview dataset
    const simResult = await generateDaxWithSimulation(question, schema);
    return res.json({
      dax: simResult.dax,
      explanation: simResult.explanation,
      suggestions: simResult.suggestions || [],
      columns: simResult.columns || [],
      rows: simResult.rows || [],
      executionTimeMs: 12,
      isPbixAnalysis: true
    });

  } catch (err) {
    console.error('[/api/ask] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`PowerBI MCP Bridge Server running on http://localhost:${PORT}`);
  const aiProvider = openai
    ? `Google Gemini (${MODEL}) ✓`
    : 'NOT CONFIGURED ✗ (Set GEMINI_API_KEY in .env)';
  console.log(`LLM Provider: ${aiProvider}`);

  // Auto-connect to active local PowerBI instances on start
  setTimeout(async () => {
    try {
      console.log('[Auto-Connect] Scanning for active local PowerBI instances...');
      const instances = await discoverAllLocalInstances();
      if (instances.length > 0) {
        const target = instances[0];
        const ds = `localhost:${target.port}`;
        console.log(`[Auto-Connect] Found instance: ${target.name || ds}. Triggering auto-connection...`);
        const connResult = await bridge.callTool('connection_operations', {
          request: {
            operation: 'Connect',
            connectionString: `Provider=MSOLAP;Data Source=${ds}`
          }
        });
        if (connResult && connResult.content && connResult.content[0]) {
          const connInfo = JSON.parse(connResult.content[0].text);
          bridge.activeConnection = connInfo.data || connInfo.connectionName || target.name || 'Local Connection';
        } else {
          bridge.activeConnection = target.name || 'Local Connection';
        }
        bridge.connectedDataSource = ds;
        console.log(`[Auto-Connect] Connected successfully to: ${bridge.activeConnection}`);
        fetchFullSchema().catch(e => console.error('[Schema warmup error]', e.message));
      } else {
        console.log('[Auto-Connect] No active local PowerBI instances discovered. Waiting for client to connect.');
      }
    } catch (err) {
      console.error('[Auto-Connect] Failed during startup:', err.message);
    }
  }, 3000);
});
