const { spawn } = require('child_process');
const MCP_PATH = 'C:\\Users\\harsh\\Downloads\\analysis-services.powerbi-modeling-mcp-0.1.9@win32-x64\\extension\\server\\powerbi-modeling-mcp.exe';

const child = spawn(MCP_PATH, ['--start']);

let buffer = '';
let step = 0;
let requestId = 1;
const port = 54226; // The active port discovered in logs

setTimeout(() => {
  sendConnect();
}, 1000);

child.stdout.on('data', (data) => {
  buffer += data.toString();
  processBuffer();
});

child.stderr.on('data', (data) => {
  // console.error('[MCP Error]:', data.toString());
});

async function processBuffer() {
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line.trim());
      if (message.id === undefined) continue;

      if (step === 0) {
        step = 1;
        sendListMeasures();
      } else if (step === 1) {
        step = 2;
        console.log("\n--- DISCOVERING MEASURES ---");
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          const measures = payload.data || payload.measures || [];
          console.log(`Total Measures: ${measures.length}`);
          
          // Filter measures containing "headcount" or "report" or "span" (case-insensitive)
          const filtered = measures.filter(m => 
            /headcount|report|span/i.test(m.name)
          );
          
          console.log("\nMatching Measures:");
          filtered.forEach(m => {
            console.log(`- [${m.name}] (Description: ${m.description || 'none'})`);
          });

          // Let's print details of some key candidates
          this.candidates = filtered.map(m => m.name);
          this.currentIndex = 0;
          fetchNextCandidate();
        } else {
          console.log("Failed to list measures", message);
          child.kill();
          process.exit(1);
        }
      } else if (step >= 2) {
        if (message.result && message.result.content && message.result.content[0]) {
          const payload = JSON.parse(message.result.content[0].text);
          const mData = payload.data?.[0] || payload.data || payload;
          console.log(`\n========================================`);
          console.log(`Measure: [${mData.name}]`);
          console.log(`Expression:\n${mData.expression || mData.formula || 'No formula'}`);
          console.log(`========================================`);
        }
        this.currentIndex++;
        fetchNextCandidate();
      }
    } catch (err) {
      console.error("JSON parse error:", err);
    }
  }
}

function fetchNextCandidate() {
  if (!this.candidates || this.currentIndex >= this.candidates.length) {
    console.log("\nFinished fetching candidate details.");
    child.kill();
    process.exit(0);
  }
  const name = this.candidates[this.currentIndex];
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

function sendListMeasures() {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'measure_operations',
      arguments: {
        request: {
          operation: 'List',
          tableName: 'All Measures'
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
