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

export async function askLLM(optionsOrQuestion: string | AskLLMOptions): Promise<AskResponse> {
  const baseUrl = getApiBaseUrl();
  const body = typeof optionsOrQuestion === 'string'
    ? { question: optionsOrQuestion }
    : { question: optionsOrQuestion.question, customSchema: optionsOrQuestion.customSchema };

  const response = await fetch(`${baseUrl}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Bypass-Tunnel-Reminder': 'true',
      'ngrok-skip-browser-warning': 'true'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `Server error: ${response.status}`);
  }

  return response.json();
}

export function toDaxResult(askResponse: AskResponse): DaxResult {
  return {
    columns: askResponse.columns || [],
    rows: askResponse.rows || [],
    executionTimeMs: askResponse.executionTimeMs || 0
  };
}
