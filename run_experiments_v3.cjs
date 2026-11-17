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
    // 1. Average for the whole year of 2025
    console.log(`\n========================================`);
    console.log(`Average for Year 2025`);
    console.log(`========================================`);
    const q2025 = `
      DEFINE
        VAR YearStart = DATE(2025,1,1)
        VAR YearEnd = DATE(2025,12,31)
      EVALUATE
        FILTER(
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER(
              'Emp_Master',
              'Emp_Master'[Snap_Date] >= YearStart &&
              'Emp_Master'[Snap_Date] <= YearEnd
            ),
            "Average_Headcount_Direct_Reportee", [Average Headcount (Direct Reports)]
          ),
          NOT(ISBLANK([Average_Headcount_Direct_Reportee]))
        )
    `;
    console.log(await postQuery(q2025));

    // 2. Average for the whole model (all years)
    console.log(`\n========================================`);
    console.log(`Average for All Years`);
    console.log(`========================================`);
    const qAll = `
      EVALUATE
        FILTER(
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            "Average_Headcount_Direct_Reportee", [Average Headcount (Direct Reports)]
          ),
          NOT(ISBLANK([Average_Headcount_Direct_Reportee]))
        )
    `;
    console.log(await postQuery(qAll));

    // 3. Let's check monthly averages for 2025 - maybe one of the months matches
    const snapDates2025 = await postQuery(`
      EVALUATE
        SUMMARIZECOLUMNS(
          'Emp_Master'[Snap_Date],
          FILTER('Emp_Master', YEAR('Emp_Master'[Snap_Date]) = 2025),
          "Count", COUNT('Emp_Master'[Employee_ID])
        )
        ORDER BY 'Emp_Master'[Snap_Date]
    `);
    
    console.log(`\n========================================`);
    console.log(`Monthly values for late 2025 / early 2026`);
    console.log(`========================================`);
    for (const row of snapDates2025.slice(-3)) {
      const dateStr = row.Snap_Date;
      const dateParts = dateStr.split('T')[0].split('-');
      const y = parseInt(dateParts[0]);
      const m = parseInt(dateParts[1]);
      const d = parseInt(dateParts[2]);
      
      const qMonth = `
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(${y}, ${m}, ${d})),
            "Average_Headcount_Direct_Reportee", [Average Headcount (Direct Reports)]
          )
      `;
      console.log(`Date: ${dateStr}`);
      console.log(await postQuery(qMonth));
    }

  } catch (err) {
    console.error("Error running experiments v3:", err);
  }
}

run();
