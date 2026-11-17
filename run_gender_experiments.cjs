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
    // 1. Discover gender-related columns in Emp_Master
    const cols = await postQuery(`
      EVALUATE
        FILTER(
          SUMMARIZECOLUMNS('Emp_Master'[Gender]),
          1=1
        )
    `);
    console.log("Emp_Master[Gender] values:", cols);

    // Let's run a query to check if there is a 'Manager_Gender' or 'Manager Gender' column in 'Emp_Master'
    // We can do this by executing a simple query that lists distinct values of Manager_Gender if it exists,
    // or we can query the columns. Let's try to query 'Emp_Master'[Manager_Gender] first.
    let managerGenderColName = null;
    try {
      const mgQuery = await postQuery(`
        EVALUATE SUMMARIZECOLUMNS('Emp_Master'[Manager_Gender])
      `);
      console.log("Emp_Master[Manager_Gender] exists, values:", mgQuery);
      managerGenderColName = "Manager_Gender";
    } catch (e) {
      console.log("Emp_Master[Manager_Gender] does not exist. Error:", e.message);
    }

    if (!managerGenderColName) {
      try {
        const mgQuery = await postQuery(`
          EVALUATE SUMMARIZECOLUMNS('Emp_Master'[Manager Gender])
        `);
        console.log("Emp_Master[Manager Gender] exists, values:", mgQuery);
        managerGenderColName = "Manager Gender";
      } catch (e) {
        console.log("Emp_Master[Manager Gender] does not exist. Error:", e.message);
      }
    }

    // Let's try to query 'People Manager Complete Span'[Manager_Gender_CS]
    try {
      const mgQuery = await postQuery(`
        EVALUATE SUMMARIZECOLUMNS('People Manager Complete Span'[Manager_Gender_CS])
      `);
      console.log("People Manager Complete Span[Manager_Gender_CS] values:", mgQuery);
    } catch (e) {
      console.log("People Manager Complete Span[Manager_Gender_CS] error:", e.message);
    }

    // Let's run a query to calculate average headcount of direct reports in 2026 by Manager_Gender
    // If the dashboard says 3074.2 and 1228.6, could that be the SUM of direct reportees for all managers?
    // Let's calculate:
    // 1) Sum of direct reportees by manager gender in 2026.
    // 2) Average headcount of direct reportees per manager by manager gender in 2026.
    
    const YearStart = "DATE(2026, 1, 1)";
    const YearEnd = "DATE(2026, 12, 31)";

    // Let's query sum of active reportees grouped by Manager Gender in 2025
    console.log(`\n--- Sum of Active Reportees by Manager Gender in 2025 ---`);
    const qSum = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Manager_Gender],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= DATE(2025,1,1) && 'Emp_Master'[Snap_Date] <= DATE(2025,12,31)),
          "Average_Direct_Span_Headcount_2025", AVERAGEX(
            VALUES('Emp_Master'[Snap_Date]),
            CALCULATE(COUNT('Emp_Master'[Employee_ID]), 'Emp_Master'[Employee_Status] = "Active")
          )
        )
    `;
    console.log(await postQuery(qSum));

    // Wait, let's also compute the average headcount of direct reports (using the measure [Average Headcount (Direct Reports)]) by Manager's Gender
    console.log(`\n--- Average Headcount (Direct Reports) measure by Manager Gender in 2026 ---`);
    const qMeasure = `
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Manager_Gender],
          FILTER('Emp_Master', 'Emp_Master'[Snap_Date] >= DATE(2026,1,1) && 'Emp_Master'[Snap_Date] <= DATE(2026,12,31)),
          "Avg_Headcount_Direct_Reports", [Average Headcount (Direct Reports)]
        )
    `;
    console.log(await postQuery(qMeasure));

    // Let's check if there is an alternative query where the headcount is calculated by manager gender (i.e. SUM of all employees grouped by their manager's gender)
    // Wait, in `qSum`, `COUNT(Employee_ID)` counts the employees. Grouping by `Manager_Gender` means we group the employees by their manager's gender,
    // and then we calculate the average count of active employees per month of 2026.
    // This is exactly:
    // - For Male managers, how many active employees report to them in 2026 (average per month)?
    // - For Female managers, how many active employees report to them in 2026 (average per month)?
    // Let's see what values `qSum` returns!

  } catch (err) {
    console.error("Error running gender experiments:", err);
  }
}

run();
