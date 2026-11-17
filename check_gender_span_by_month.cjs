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
    const dates = [
      { y: 2026, m: 1, d: 31, label: "2026-01-31" },
      { y: 2026, m: 2, d: 28, label: "2026-02-28" },
      { y: 2026, m: 3, d: 31, label: "2026-03-31" },
      { y: 2026, m: 4, d: 30, label: "2026-04-30" },
      { y: 2026, m: 5, d: 17, label: "2026-05-17" }
    ];

    for (const d of dates) {
      console.log(`\n========================================`);
      console.log(`Date: ${d.label}`);
      console.log(`========================================`);
      
      const query = `
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Manager_Gender],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(${d.y}, ${d.m}, ${d.d})),
            "Avg_Headcount_Direct_Reports", [Average Headcount (Direct Reports)]
          )
      `;
      const res = await postQuery(query);
      console.log(res);
    }

  } catch (err) {
    console.error("Error in check_gender_span_by_month:", err);
  }
}

run();
