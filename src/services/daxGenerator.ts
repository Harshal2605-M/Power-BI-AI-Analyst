import type { DaxResult } from '../db/daxEngine';

export interface GroundedQuery {
  question: string;
  dax: string;
  category: 'general' | 'trend' | 'ranking' | 'distribution' | 'comparison' | 'summary';
  chartType: 'bar' | 'line' | 'donut' | 'table' | 'decomposition' | 'comparison';
  description: string;
}

// Generic starter repository - queries can also be generated dynamically
export const groundedRepository: GroundedQuery[] = [
  {
    question: "List all tables and summaries",
    dax: "",
    category: "summary",
    chartType: "table",
    description: "Display summary of tables in the active semantic model"
  },
  {
    question: "Top 10 records by primary metric",
    dax: "",
    category: "ranking",
    chartType: "bar",
    description: "Highest ranking values"
  },
  {
    question: "Monthly trend analysis",
    dax: "",
    category: "trend",
    chartType: "line",
    description: "Chronological metric movement"
  },
  {
    question: "Distribution breakdown",
    dax: "",
    category: "distribution",
    chartType: "donut",
    description: "Category share and composition"
  }
];

export function parseFuzzyQuestion(question: string): GroundedQuery {
  const lower = question.toLowerCase();
  let chartType: GroundedQuery['chartType'] = 'bar';
  let category: GroundedQuery['category'] = 'general';

  if (lower.includes('trend') || lower.includes('over time') || lower.includes('month') || lower.includes('year') || lower.includes('date')) {
    chartType = 'line';
    category = 'trend';
  } else if (lower.includes('distribution') || lower.includes('breakdown') || lower.includes('share') || lower.includes('split') || lower.includes('percentage')) {
    chartType = 'donut';
    category = 'distribution';
  } else if (lower.includes('top') || lower.includes('bottom') || lower.includes('highest') || lower.includes('lowest') || lower.includes('rank')) {
    chartType = 'bar';
    category = 'ranking';
  } else if (lower.includes('compare') || lower.includes('vs') || lower.includes('versus')) {
    chartType = 'comparison';
    category = 'comparison';
  } else if (lower.includes('detail') || lower.includes('list') || lower.includes('show all') || lower.includes('table')) {
    chartType = 'table';
    category = 'summary';
  }

  return {
    question,
    dax: '',
    category,
    chartType,
    description: `Analysis: ${question}`
  };
}

export function generateInsights(question: string, result: DaxResult): { summary: string; bullets: string[]; recommendations: string[] } {
  if (!result || !result.rows || result.rows.length === 0) {
    return {
      summary: 'No data returned for this query.',
      bullets: ['Ensure your Power BI model is connected and loaded.'],
      recommendations: ['Ask a question referencing table or column names from your model schema.']
    };
  }

  const cols = result.columns;
  const rows = result.rows;
  const numericCols = cols.filter(c => rows[0] && typeof rows[0][c] === 'number');
  const dimCol = cols.find(c => !numericCols.includes(c)) || cols[0] || 'Category';
  const metricCol = numericCols[0] || cols[0] || 'Value';

  const values = rows.map(r => Number(r[metricCol]) || 0);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const avgVal = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const sumVal = values.reduce((a, b) => a + b, 0);

  const maxRow = rows[values.indexOf(maxVal)];
  const minRow = rows[values.indexOf(minVal)];
  const maxLabel = maxRow ? String(maxRow[dimCol] ?? 'N/A') : 'N/A';
  const minLabel = minRow ? String(minRow[dimCol] ?? 'N/A') : 'N/A';

  const fmt = (v: number) => isNaN(v) ? '0' : v % 1 !== 0 ? v.toFixed(2) : String(Math.round(v));

  return {
    summary: `Analysis of "${question}" returned ${rows.length} records. For metric "${metricCol}", values range from ${fmt(minVal)} (${minLabel}) to ${fmt(maxVal)} (${maxLabel}) with an overall average of ${fmt(avgVal)}.`,
    bullets: [
      `Peak segment: ${maxLabel} leads with ${fmt(maxVal)}.`,
      `Lowest segment: ${minLabel} records ${fmt(minVal)}.`,
      `Combined metric total across all ${rows.length} categories is ${fmt(sumVal)}.`
    ],
    recommendations: [
      `Examine performance drivers in leading segment (${maxLabel}).`,
      `Evaluate variance between segments to identify opportunities.`,
      `Filter by additional dimensions or time slices for deeper granularity.`
    ]
  };
}
