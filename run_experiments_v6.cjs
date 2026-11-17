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
    // 1. Average for Year 2025 by Manager Gender
    console.log(`\n========================================`);
    console.log(`Average for Year 2025`);
    console.log(`========================================`);
    const q2025 = `
      DEFINE
        VAR YearStart = DATE(2025,1,1)
        VAR YearEnd = DATE(2025,12,31)
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Manager_Gender],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd),
          "Avg_Headcount_Direct_Reports", [Average Headcount (Direct Reports)]
        )
    `;
    console.log(await postQuery(q2025));

    // 2. Average for all-time by Manager Gender
    console.log(`\n========================================`);
    console.log(`Average for All-Time`);
    console.log(`========================================`);
    const qAll = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Manager_Gender],
          "Avg_Headcount_Direct_Reports", [Average Headcount (Direct Reports)]
        )
    `;
    console.log(await postQuery(qAll));

  } catch (err) {
    console.error("Error running gender experiments v6:", err);
  }
}

run();
