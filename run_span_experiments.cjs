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
    // Experiment 1: Group by Manager in Emp_Master (filtered by Business_Unit_Name = "Human Resources")
    // and compute average of active reportee count over 2026.
    console.log(`\n========================================`);
    console.log(`Exp 1: Active Reportees count (Business_Unit_Name = HR)`);
    console.log(`========================================`);
    const q1 = `
      DEFINE
        VAR YearStart = DATE(2026, 1, 1)
        VAR YearEnd = DATE(2026, 12, 31)
      EVALUATE
        TOPN(
          5,
          FILTER(
            SUMMARIZECOLUMNS(
              'Emp_Master'[Manager_Full_Name],
              'Emp_Master'[Manager_ID],
              FILTER('Emp_Master', 'Emp_Master'[Business_Unit_Name] = "Human Resources" && 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd)
            ),
            NOT(ISBLANK('Emp_Master'[Manager_Full_Name]))
          ),
          AVERAGEX(
            FILTER(VALUES('Emp_Master'[Snap_Date]), 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd),
            CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
          ),
          DESC
        )
    `;
    // Wait, let's also compute the actual average value in the SELECT columns so we can print it
    const q1WithVal = `
      DEFINE
        VAR YearStart = DATE(2026, 1, 1)
        VAR YearEnd = DATE(2026, 12, 31)
      EVALUATE
        TOPN(
          10,
          FILTER(
            ADDCOLUMNS(
              SUMMARIZECOLUMNS(
                'Emp_Master'[Manager_Full_Name],
                'Emp_Master'[Manager_ID],
                FILTER('Emp_Master', 'Emp_Master'[Business_Unit_Name] = "Human Resources" && 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd)
              ),
              "Avg_Direct_Span", AVERAGEX(
                FILTER(VALUES('Emp_Master'[Snap_Date]), 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            ),
            NOT(ISBLANK([Manager_Full_Name]))
          ),
          [Avg_Direct_Span],
          DESC
        )
    `;
    console.log(await postQuery(q1WithVal));

    // Experiment 2: Let's query Dione Dewars specifically to see her details in 2026
    console.log(`\n========================================`);
    console.log(`Exp 2: Query Dione Dewars specifically`);
    console.log(`========================================`);
    const qDione = `
      DEFINE
        VAR YearStart = DATE(2026, 1, 1)
        VAR YearEnd = DATE(2026, 12, 31)
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Snap_Date],
          FILTER('Emp_Master', 'Emp_Master'[Manager_Full_Name] = "Dione Dewars" && 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd),
          "Active_Reportees", CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active"),
          "Direct_Repotee_Col_Sum", CALCULATE(SUM('Emp_Master'[Direct Repotee])),
          "Manager_BU", FIRSTNONBLANK('Emp_Master'[Manager_BU], 1),
          "Emp_BU", FIRSTNONBLANK('Emp_Master'[Business_Unit_Name], 1)
        )
    `;
    console.log(await postQuery(qDione));

    // Experiment 3: What if we filter by Manager_BU = "Human Resources"?
    console.log(`\n========================================`);
    console.log(`Exp 3: Group by Manager (Manager_BU = HR)`);
    console.log(`========================================`);
    const q3 = `
      DEFINE
        VAR YearStart = DATE(2026, 1, 1)
        VAR YearEnd = DATE(2026, 12, 31)
      EVALUATE
        TOPN(
          10,
          FILTER(
            ADDCOLUMNS(
              SUMMARIZECOLUMNS(
                'Emp_Master'[Manager_Full_Name],
                'Emp_Master'[Manager_ID],
                FILTER('Emp_Master', 'Emp_Master'[Manager_BU] = "Human Resources" && 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd)
              ),
              "Avg_Direct_Span", AVERAGEX(
                FILTER(VALUES('Emp_Master'[Snap_Date]), 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd),
                CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
              )
            ),
            NOT(ISBLANK([Manager_Full_Name]))
          ),
          [Avg_Direct_Span],
          DESC
        )
    `;
    console.log(await postQuery(q3));

  } catch (err) {
    console.error("Error running experiments:", err);
  }
}

run();
