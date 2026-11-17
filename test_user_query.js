const http = require('http');

const data = JSON.stringify({
  question: "show Average Headcount Direct Reportee by grade level for 2026"
});

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

console.log("Sending query to /api/ask route...");
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`\nResponse Status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(body);
      console.log("\n--- GPT GENERATED DAX ---");
      console.log(parsed.dax);
      console.log("\n--- EXPLANATION ---");
      console.log(parsed.explanation);
      console.log("\n--- ROWS ---");
      if (parsed.rows) {
        console.log(JSON.stringify(parsed.rows, null, 2));
      }
      if (parsed.error) {
        console.log("Error returned in payload:", parsed.error);
      }
    } catch (e) {
      console.log("Failed to parse response body:", e);
      console.log("Raw body:", body);
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
