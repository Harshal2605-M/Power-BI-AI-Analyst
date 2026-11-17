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
        sendListRelationships();
      } else {
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          console.log(JSON.stringify(payload.data || payload, null, 2));
        } else {
          console.error("Failed to list relationships:", message);
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

function sendListRelationships() {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'relationship_operations',
      arguments: {
        request: {
          operation: 'List'
        }
      }
    },
    id: requestId
  };
  child.stdin.write(JSON.stringify(request) + '\n');
}
