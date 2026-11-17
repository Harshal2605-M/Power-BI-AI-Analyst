const http = require('http');

const query = process.argv[2];
if (!query) {
  console.error("Please provide a DAX query.");
  process.exit(1);
}

const data = JSON.stringify({ query });

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/query',
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
      if (parsed.error) {
        console.error("Error from API:", parsed.error);
      } else if (parsed.rows) {
        console.log(JSON.stringify(parsed.rows, null, 2));
      } else {
        console.log(JSON.stringify(parsed, null, 2));
      }
    } catch (e) {
      console.error("Failed to parse response:", e);
      console.log("Raw body:", body);
    }
  });
});

req.on('error', (e) => {
  console.error(`Request error: ${e.message}`);
});

req.write(data);
req.end();
