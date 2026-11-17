const { spawn } = require('child_process');
const MCP_PATH = 'C:\\Users\\harsh\\Downloads\\analysis-services.powerbi-modeling-mcp-0.1.9@win32-x64\\extension\\server\\powerbi-modeling-mcp.exe';

const child = spawn(MCP_PATH, ['--start']);

let buffer = '';
let step = 0;
let requestId = 1;
const port = 54226;

const targetMeasures = [
  "Average Headcount (Direct Reports)",
  "Headcount",
  "Repotee Count",
  "Average Headcount",
  "Total Exits (Direct Reports)"
];

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
        this.currentIndex = 0;
        fetchNext();
      } else {
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          const mData = payload.data?.[0] || payload.data || payload;
          console.log(`\n========================================`);
          console.log(`Measure: [${mData.name}]`);
          console.log(`Expression:\n${mData.expression || mData.formula || 'No formula'}`);
          console.log(`========================================`);
        } else {
          console.log(`Failed for target: ${targetMeasures[this.currentIndex - 1]}`);
        }
        fetchNext();
      }
    } catch (err) {
      console.error("JSON parse error:", err);
    }
  }
}

function fetchNext() {
  if (this.currentIndex >= targetMeasures.length) {
    child.kill();
    process.exit(0);
  }
  const name = targetMeasures[this.currentIndex];
  this.currentIndex++;
  sendGetMeasure(name);
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

function sendGetMeasure(measureName) {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'measure_operations',
      arguments: {
        request: {
          operation: 'Get',
          tableName: 'All Measures',
          measureName: measureName
        }
      }
    },
    id: requestId
  };
  child.stdin.write(JSON.stringify(request) + '\n');
}
