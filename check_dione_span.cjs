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
    const queries = [
      {
        name: "Dione Dewars 2023 Span",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars" && YEAR('Emp_Master'[Snap_Date]) = 2023),
              "Avg_Direct_Span", AVERAGEX(
                VALUES('Emp_Master'[Snap_Date]),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            )
        `
      },
      {
        name: "Dione Dewars 2024 Span",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars" && YEAR('Emp_Master'[Snap_Date]) = 2024),
              "Avg_Direct_Span", AVERAGEX(
                VALUES('Emp_Master'[Snap_Date]),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            )
        `
      },
      {
        name: "Dione Dewars 2025 Span",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars" && YEAR('Emp_Master'[Snap_Date]) = 2025),
              "Avg_Direct_Span", AVERAGEX(
                VALUES('Emp_Master'[Snap_Date]),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            )
        `
      },
      {
        name: "Dione Dewars 2026 Span",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars" && YEAR('Emp_Master'[Snap_Date]) = 2026),
              "Avg_Direct_Span", AVERAGEX(
                VALUES('Emp_Master'[Snap_Date]),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            )
        `
      },
      {
        name: "Dione Dewars All-Time Span",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars"),
              "Avg_Direct_Span", AVERAGEX(
                VALUES('Emp_Master'[Snap_Date]),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            )
        `
      }
    ];

    for (const q of queries) {
      console.log(`\n========================================`);
      console.log(q.name);
      console.log(`========================================`);
      const res = await postQuery(q.query);
      console.log(res);
    }

  } catch (err) {
    console.error("Error in run:", err);
  }
}

run();
