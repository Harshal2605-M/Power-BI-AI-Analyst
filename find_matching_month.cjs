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

const target = {
  "Workforce": 292,
  "Leadership": 48,
  "Lower Management": 230,
  "Middle Management": 370,
  "Individual Contributor": 1551
};

async function run() {
  try {
    // 1. Get all unique snap dates
    const allDates = await postQuery(`
      EVALUATE
        SUMMARIZECOLUMNS('Emp_Master'[Snap_Date])
        ORDER BY 'Emp_Master'[Snap_Date]
    `);

    console.log(`Searching through ${allDates.length} snapshot dates...`);

    let bestMatch = null;
    let minDiff = Infinity;

    for (const row of allDates) {
      const dateStr = row["Snap_Date"] || row["Emp_Master[Snap_Date]"] || Object.values(row)[0];
      if (!dateStr) continue;
      const dateParts = dateStr.split('T')[0].split('-');
      const y = parseInt(dateParts[0]);
      const m = parseInt(dateParts[1]);
      const d = parseInt(dateParts[2]);

      const monthlyRes = await postQuery(`
        EVALUATE
          SUMMARIZECOLUMNS(
            'Emp_Master'[Grade_Level],
            FILTER('Emp_Master', 'Emp_Master'[Snap_Date] = DATE(${y}, ${m}, ${d})),
            "Average_Headcount_Direct_Reportee", [Average Headcount (Direct Reports)]
          )
      `);

      // Calculate total absolute difference from target
      let diff = 0;
      let matchedCount = 0;
      const results = {};
      
      for (const item of monthlyRes) {
        if (item.Grade_Level) {
          results[item.Grade_Level] = Math.round(item.Average_Headcount_Direct_Reportee);
        }
      }

      for (const [grade, targetVal] of Object.entries(target)) {
        const val = results[grade] || 0;
        diff += Math.abs(val - targetVal);
        if (val === targetVal) matchedCount++;
      }

      if (diff < minDiff) {
        minDiff = diff;
        bestMatch = { dateStr, results, diff, matchedCount };
      }

      if (diff === 0) {
        console.log(`EXACT MATCH FOUND at date: ${dateStr}`);
        console.log(results);
      }
    }

    console.log("\n--- BEST MATCH ---");
    console.log("Date:", bestMatch.dateStr);
    console.log("Results:", bestMatch.results);
    console.log("Total Difference:", bestMatch.diff);
    console.log("Exactly Matched Grades:", bestMatch.matchedCount);

  } catch (err) {
    console.error("Error in matching script:", err);
  }
}

run();
