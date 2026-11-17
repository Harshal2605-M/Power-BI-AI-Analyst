const { spawn } = require('child_process');
const MCP_PATH = 'C:\\Users\\harsh\\Downloads\\analysis-services.powerbi-modeling-mcp-0.1.9@win32-x64\\extension\\server\\powerbi-modeling-mcp.exe';

const child = spawn(MCP_PATH, ['--start']);

let buffer = '';
let step = 0;
let requestId = 1;
const port = 54226;

setTimeout(() => {
  sendConnect();
}, 1000);

child.stdout.on('data', (data) => {
  buffer += data.toString();
  processBuffer();
});

function processBuffer() {
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line.trim());
      if (message.id === undefined) continue;

      if (step === 0) {
        step = 1;
        sendListColumns();
      } else if (step === 1) {
        step = 2;
        console.log("\n--- PEOPLE MANAGER COMPLETE SPAN COLUMNS ---");
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          const tableObj = payload.data?.[0] || payload;
          const cols = tableObj.columns || [];
          console.log(`Found ${cols.length} columns:`);
          cols.forEach(c => {
            console.log(`- Column: "${c.name}" (Type: ${c.dataType})`);
          });
        }
        sendSampleRow();
      } else if (step === 2) {
        console.log("\n--- SAMPLE ROW FROM PEOPLE MANAGER COMPLETE SPAN ---");
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          const rows = payload.data?.rows || payload.rows || [];
          if (rows.length > 0) {
            console.log(JSON.stringify(rows[0], null, 2));
          } else {
            console.log("No rows returned", payload);
          }
        }
        child.kill();
        process.exit(0);
      }
    } catch (err) {
      console.error("JSON parse error:", err);
    }
  }
}

function sendConnect() {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'connection_operations',
      arguments: {
        request: {
          operation: 'Connect',
          connectionString: `Provider=MSOLAP;Data Source=localhost:${port}`
        }
      }
    },
    id: requestId
  };
  child.stdin.write(JSON.stringify(request) + '\n');
}

function sendListColumns() {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'column_operations',
      arguments: {
        request: {
          operation: 'List',
          tableName: 'People Manager Complete Span'
        }
      }
    },
    id: requestId
  };
  child.stdin.write(JSON.stringify(request) + '\n');
}

function sendSampleRow() {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'dax_query_operations',
      arguments: {
        request: {
          operation: 'Execute',
          query: `EVALUATE SAMPLE(1, 'People Manager Complete Span', 1)`,
          executionMetricsOnly: false,
          getExecutionMetrics: true
        }
      }
    },
    id: requestId
  };
  child.stdin.write(JSON.stringify(request) + '\n');
}
