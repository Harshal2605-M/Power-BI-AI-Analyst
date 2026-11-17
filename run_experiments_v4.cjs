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
    const filters = [
      {
        name: "Standard Measure (Full Time + Direct Consultant)",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              'Emp_Master'[Grade_Level],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(2026, 1, 31)),
              "HC", [Average Headcount (Direct Reports)]
            )
        `
      },
      {
        name: "Only Full Time (Excluding Direct Consultant)",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              'Emp_Master'[Grade_Level],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(2026, 1, 31)),
              "HC", CALCULATE(
                COUNT(Emp_Master[Employee_ID]),
                Emp_Master[IS_ACTIVE]=1,
                Emp_Master[Employment_Type] = "Full Time",
                REMOVEFILTERS(Emp_Master[Exit_Type])
              )
            )
        `
      },
      {
        name: "Active Employee_Status (Excluding Direct Consultant)",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              'Emp_Master'[Grade_Level],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(2026, 1, 31)),
              "HC", CALCULATE(
                COUNT(Emp_Master[Employee_ID]),
                Emp_Master[Employee_Status]="Active",
                Emp_Master[Employment_Type] = "Full Time",
                REMOVEFILTERS(Emp_Master[Exit_Type])
              )
            )
        `
      },
      {
        name: "Active Employee_Status (Full Time + Direct Consultant)",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              'Emp_Master'[Grade_Level],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(2026, 1, 31)),
              "HC", CALCULATE(
                COUNT(Emp_Master[Employee_ID]),
                Emp_Master[Employee_Status]="Active",
                Emp_Master[Employment_Type] IN {"Full Time", "Direct Consultant"},
                REMOVEFILTERS(Emp_Master[Exit_Type])
              )
            )
        `
      },
      {
        name: "IS_ACTIVE = 1 (No Employment Type filter)",
        query: `
          EVALUATE
            SUMMARIZECOLUMNS(
              'Emp_Master'[Grade_Level],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(2026, 1, 31)),
              "HC", CALCULATE(
                COUNT(Emp_Master[Employee_ID]),
                Emp_Master[IS_ACTIVE]=1,
                REMOVEFILTERS(Emp_Master[Exit_Type])
              )
            )
        `
      }
    ];

    for (const f of filters) {
      console.log(`\n========================================`);
      console.log(f.name);
      console.log(`========================================`);
      const res = await postQuery(f.query);
      console.log(res);
    }

  } catch (err) {
    console.error("Error in run:", err);
  }
}

run();
