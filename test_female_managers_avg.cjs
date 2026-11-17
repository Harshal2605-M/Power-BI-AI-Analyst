const http = require('http');

function postQuery(query) {
  return new Promise((resolve, reject) => {
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
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed.rows || []);
        } catch (e) {
          reject(e);
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
    const q = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Manager_Gender],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= DATE(2025,1,1) && 'Emp_Master'[Snap_Date] <= DATE(2025,12,31)),
          "Average_Headcount_Direct_Reports", [Average Headcount (Direct Reports)]
        )
    `;
    console.log("2025 Average Headcount (Direct Reports) grouped by Manager_Gender:");
    console.log(await postQuery(q).catch(e => `Error: ${e.message}`));
  } catch (e) {
    console.error(e);
  }
}

run();
