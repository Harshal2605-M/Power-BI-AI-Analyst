import type { DaxResult } from '../db/daxEngine';
import { API_BASE_URL } from '../config';

export interface AskResponse {
  dax: string;
  explanation: string;
  columns: string[];
  rows: Record<string, any>[];
  executionTimeMs: number;
  error?: string;
  offline?: boolean;
  suggestions?: string[];
}

/**
 * Call the LLM-powered /api/ask endpoint.
 * The server reads the live schema, feeds it to Google Gemini,
 * gets back a valid DAX query, executes it, and returns the results.
 */
export async function askLLM(question: string): Promise<AskResponse> {
  const response = await fetch(`${API_BASE_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `Server error: ${response.status}`);
  }

  return response.json();
}

/**
 * Convert an AskResponse to a DaxResult shape for compatibility
 * with existing chart/table rendering code.
 */
export function toDaxResult(askResponse: AskResponse): DaxResult {
  return {
    columns: askResponse.columns || [],
    rows: askResponse.rows || [],
    executionTimeMs: askResponse.executionTimeMs || 0
  };
}
