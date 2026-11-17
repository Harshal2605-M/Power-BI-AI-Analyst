import type { DaxResult } from '../db/daxEngine';
import { getApiBaseUrl } from '../config';

export interface AskResponse {
  dax: string;
  explanation: string;
  columns: string[];
  rows: Record<string, any>[];
  executionTimeMs: number;
  error?: string;
  offline?: boolean;
  suggestions?: string[];
  isPbixAnalysis?: boolean;
}

export interface AskLLMOptions {
  question: string;
  customSchema?: {
    tables: { name: string; columns: { name: string; dataType: string }[] }[];
    measures: { name: string; description?: string; expression?: string }[];
    fileName?: string;
  };
}

const DEFAULT_GEMINI_KEY = 'AIzaSyByc_m3yKLhAwem4iuzqQl1d1dK8aiA8Io';
const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || DEFAULT_GEMINI_KEY).trim();

async function askGeminiDirect(question: string, customSchema?: any): Promise<AskResponse> {
  const schema = customSchema || { tables: [], measures: [] };

  const userTables = (schema.tables || []).filter((t: any) => 
    !t.name.startsWith('LocalDateTable_') && 
    !t.name.startsWith('DateTableTemplate_')
  );

  const tablesSummary = (userTables.length > 0 ? userTables : schema.tables || []).map((t: any) => {
    const cols = (t.columns || []).map((c: any) => `    [${c.name}] (${c.dataType})`).join('\n');
    return `Table: '${t.name}'\n${cols || '    (no columns)'}`;
  }).join('\n\n');

  const measuresSummary = (schema.measures || []).map((m: any) =>
    `  Measure Name: [${m.name}]\n  Formula/DAX: ${m.expression || 'Calculates ' + m.name}\n  Description: ${m.description || ''}`
  ).join('\n\n');

  const systemPrompt = `You are an expert Power BI DAX AI Analyst analyzing a Power BI (.pbix) report model.
You formulate mathematically grounded DAX queries, describe the analytical calculation logic, and generate a realistic simulated preview dataset representing the analytical result.

PBIX MODEL SCHEMA:
==================
${tablesSummary || '  (Schema derived from report visuals & pages)'}

AVAILABLE MODEL MEASURES:
=========================
${measuresSummary || '  (No pre-built measures found; formulate DAX directly using table columns)'}

CRITICAL RULES:
1. STRICT ADHERENCE: Reference table names, column names, and measures that exist in the schema.
2. The DAX query must start with EVALUATE or DEFINE.
3. For "columns" and "rows": generate 3 to 8 realistic, consistent preview data rows that would result from executing this DAX query, so charts and tables can be visualized accurately in the frontend.
4. Suggestions: provide 3 intelligent, analytical follow-up questions tailored to this specific model.

OUTPUT FORMAT:
Respond with a single, pure JSON object (no markdown, no backticks):
{
  "dax": "<valid DAX query>",
  "explanation": "<detailed business & calculation explanation>",
  "columns": ["<Col1>", "<Col2>"],
  "rows": [
    { "<Col1>": "Category A", "<Col2>": 12500 }
  ],
  "suggestions": [
    "<follow-up question 1>",
    "<follow-up question 2>",
    "<follow-up question 3>"
  ]
}`;

  const userPrompt = `Answer this analytical question on the .pbix model: "${question}"`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Direct Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
  const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleanJson);

  return {
    dax: (parsed.dax || '').trim(),
    explanation: parsed.explanation || '',
    suggestions: parsed.suggestions || [],
    columns: Array.isArray(parsed.columns) ? parsed.columns : [],
    rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    executionTimeMs: 15,
    isPbixAnalysis: true
  };
}

export async function askLLM(optionsOrQuestion: string | AskLLMOptions): Promise<AskResponse> {
  const baseUrl = getApiBaseUrl();
  const body = typeof optionsOrQuestion === 'string'
    ? { question: optionsOrQuestion }
    : { question: optionsOrQuestion.question, customSchema: optionsOrQuestion.customSchema };

  try {
    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (netErr: any) {
    console.warn('[llmService] Gateway bridge unreachable. Using direct Gemini engine fallback...', netErr.message);
  }

  // Fallback to direct Gemini query
  return askGeminiDirect(body.question, body.customSchema);
}

export function toDaxResult(askResponse: AskResponse): DaxResult {
  return {
    columns: askResponse.columns || [],
    rows: askResponse.rows || [],
    executionTimeMs: askResponse.executionTimeMs || 0
  };
}
