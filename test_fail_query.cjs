const http = require('http');

const data = JSON.stringify({
  question: "for 2026 what is the average direct reportee span for managers in each grade category?"
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
    console.log("Raw Response Body:\n", body);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
