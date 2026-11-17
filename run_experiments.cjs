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
    // Experiment 1: Get the latest snap date in the entire model
    const maxDateRows = await postQuery(`
      EVALUATE
        ROW("MaxDate", CALCULATE(MAX('Emp_Master'[Snap_Date]), ALL('Emp_Master')))
    `);
    console.log("Max Date in Model:", maxDateRows);
    const maxDate = maxDateRows[0]?.MaxDate;

    // Experiment 2: Check snap dates in 2026 and their headcount
    const snapDates2026 = await postQuery(`
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Snap_Date],
          FILTER('Emp_Master', YEAR('Emp_Master'[Snap_Date]) = 2026),
          "Count", COUNT('Emp_Master'[Employee_ID])
        )
        ORDER BY 'Emp_Master'[Snap_Date]
    `);
    console.log("Snap dates in 2026:", snapDates2026);

    // Experiment 3: Get Average Headcount (Direct Reports) by Grade Level for the latest snap date of 2026
    if (maxDate) {
      console.log(`\n--- Querying Headcount at latest snap date: ${maxDate} ---`);
      const resLatestDate = await postQuery(`
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATEVALUE("${maxDate}")),
            "Average_Headcount_Direct_Reportee", [Average Headcount (Direct Reports)]
          )
      `);
      console.log(resLatestDate);

      console.log(`\n--- Querying RAW Headcount (Direct Reports) at latest snap date: ${maxDate} ---`);
      const resRawLatestDate = await postQuery(`
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATEVALUE("${maxDate}")),
            "Headcount_Direct_Reportee", CALCULATE(
              COUNT(Emp_Master[Employee_ID]),
              Emp_Master[IS_ACTIVE]=1,
              Emp_Master[Employment_Type] IN {"Full Time","Direct Consultant"},
              REMOVEFILTERS(Emp_Master[Exit_Type])
            )
          )
      `);
      console.log(resRawLatestDate);
    }

    // Let's run a query for each month of 2026 to see if any specific month's headcount matches the screenshot values
    // Screenshot values: IC=1551, Leadership=48, Lower Mgmt=230, Middle Mgmt=370, Workforce=292
    console.log(`\n--- Querying Monthly Headcounts for 2026 ---`);
    for (const row of snapDates2026) {
      const dateStr = row["Snap_Date"];
      const monthlyRes = await postQuery(`
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATEVALUE("${dateStr}")),
            "Headcount", [Average Headcount (Direct Reports)]
          )
      `);
      console.log(`Date: ${dateStr}`);
      console.log(monthlyRes);
    }

  } catch (err) {
    console.error("Error running experiments:", err);
  }
}

run();
