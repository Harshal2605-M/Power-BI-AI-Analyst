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
    const YearStart = "DATE(2026, 1, 1)";
    const YearEnd = "DATE(2026, 12, 31)";

    // Experiment 1: Group by Employee's Grade_Category
    console.log(`\n========================================`);
    console.log(`Exp 1: Group by Employee's Grade_Category`);
    console.log(`========================================`);
    const q1 = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Grade_Category],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= ${YearStart} && 'Emp_Master'[Snap_Date] <= ${YearEnd}),
          "Average_Direct_Span", AVERAGEX(
            VALUES('Emp_Master'[Snap_Date]),
            CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
          )
        )
    `;
    console.log(await postQuery(q1).catch(e => `Error: ${e.message}`));

    // Experiment 2: Group by Employee's Grade_Level
    console.log(`\n========================================`);
    console.log(`Exp 2: Group by Employee's Grade_Level`);
    console.log(`========================================`);
    const q2 = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Grade_Level],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= ${YearStart} && 'Emp_Master'[Snap_Date] <= ${YearEnd}),
          "Average_Direct_Span", AVERAGEX(
            VALUES('Emp_Master'[Snap_Date]),
            CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
          )
        )
    `;
    console.log(await postQuery(q2).catch(e => `Error: ${e.message}`));

    // Experiment 3: Group by Manager's Grade Category (using LOOKUPVALUE)
    // Wait, in SUMMARIZECOLUMNS, you can't add an ad-hoc column via LOOKUPVALUE inside the grouping columns directly.
    // Instead, we can use ADDCOLUMNS on a SUMMARIZE query, or we can use SUMMARIZECOLUMNS with a manager grouping, 
    // and then lookup their Grade Category, and then summarize that!
    console.log(`\n========================================`);
    console.log(`Exp 3: Manager's Grade Category using Lookup`);
    console.log(`========================================`);
    const q3 = `
      DEFINE
        VAR ManagerSpans = 
          ADDCOLUMNS(
            SUMMARIZECOLUMNS(
              'Emp_Master'[Manager_ID],
              'Emp_Master'[Manager_Full_Name],
              FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= ${YearStart} && 'Emp_Master'[Snap_Date] <= ${YearEnd})
            ),
            "Manager_Grade_Category", LOOKUPVALUE('Emp_Master'[Grade_Category], 'Emp_Master'[Employee_ID], 'Emp_Master'[Manager_ID]),
            "Avg_Direct_Span", AVERAGEX(
              VALUES('Emp_Master'[Snap_Date]),
              CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
            )
          )
      EVALUATE
        SUMMARIZECOLUMNS(
          "Manager_Grade_Category", 
          "Average_Direct_Span", 
          "Count", 
          // Wait, to summarize an in-memory table variable, we can't use SUMMARIZECOLUMNS directly. 
          // We must use SUMMARIZE or SELECTCOLUMNS. Let's just return the manager spans so we can see what they look like.
          1
        )
    `;
    // Let's write a correct DAX to query manager grade categories:
    const q3Correct = `
      DEFINE
        VAR YearStart = DATE(2026, 1, 1)
        VAR YearEnd = DATE(2026, 12, 31)
        VAR ManagerSpans = 
          ADDCOLUMNS(
            FILTER(
              SUMMARIZECOLUMNS(
                'Emp_Master'[Manager_ID],
                'Emp_Master'[Manager_Full_Name],
                FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= YearStart && 'Emp_Master'[Snap_Date] <= YearEnd)
              ),
              NOT(ISBLANK('Emp_Master'[Manager_ID]))
            ),
            "Manager_Grade_Category", LOOKUPVALUE('Emp_Master'[Grade_Category], 'Emp_Master'[Employee_ID], 'Emp_Master'[Manager_ID]),
            "Avg_Direct_Span", AVERAGEX(
              VALUES('Emp_Master'[Snap_Date]),
              CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
            )
          )
      EVALUATE
        SUMMARIZE(
          ManagerSpans,
          [Manager_Grade_Category],
          "Average_Direct_Span_Headcount", AVERAGE([Avg_Direct_Span])
        )
    `;
    console.log(await postQuery(q3Correct).catch(e => `Error: ${e.message}`));

  } catch (err) {
    console.error("Error running experiments:", err);
  }
}

run();
