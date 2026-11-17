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
}

export async function askLLM(question: string): Promise<AskResponse> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Bypass-Tunnel-Reminder': 'true',
      'ngrok-skip-browser-warning': 'true'
    },
    body: JSON.stringify({ question })
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
