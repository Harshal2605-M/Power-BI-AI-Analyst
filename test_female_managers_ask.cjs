const http = require('http');

function getStatus() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/status',
      method: 'GET'
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function askQuestion(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ question });
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/ask',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse body: ${body}. Error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  try {
    // Wait for the bridge server to auto-connect
    await new Promise(resolve => setTimeout(resolve, 3000));

    const status = await getStatus();
    console.log("Server Status:", status);

    const question = "for 2026 Average Headcount Direct Reports for female managers";
    console.log(`\nAsking: "${question}"...`);
    const start = Date.now();
    const result = await askQuestion(question);
    console.log(`\nResponse received in ${Date.now() - start}ms:`);
    console.log("Generated DAX:");
    console.log(result.dax);
    console.log("\nColumns:", result.columns);
    console.log("Rows:", result.rows);
    console.log("Error:", result.error);
  } catch (e) {
    console.error(e);
  }
}

run();
