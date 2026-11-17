import { getApiBaseUrl } from '../config';

export interface DaxResult {
  columns: string[];
  rows: Record<string, any>[];
  executionTimeMs: number;
}

export class DaxEngine {
  public isLiveConnected: boolean = false;
  public activeConnectionName: string = 'No Model Connected';

  public getJoinedRecords(): any[] {
    return [];
  }

  public async syncLiveStatus(): Promise<boolean> {
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/status`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Bypass-Tunnel-Reminder': 'true',
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (res.ok) {
        const data = await res.json();
        this.isLiveConnected = !!data.activeConnection;
        this.activeConnectionName = data.activeConnection || 'No Model Connected';
        return true;
      }
    } catch {
      this.isLiveConnected = false;
      this.activeConnectionName = 'No Model Connected';
    }
    return false;
  }

  public async evaluate(dax: string): Promise<DaxResult> {
    const startTime = performance.now();
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Bypass-Tunnel-Reminder': 'true',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ query: dax })
      });
      if (res.ok) {
        const data = await res.json();
        const rows = data.content?.[0]?.text ? JSON.parse(data.content[0].text)?.data || [] : [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return {
          columns,
          rows,
          executionTimeMs: Math.round(performance.now() - startTime)
        };
      }
    } catch {
      // ignore
    }
    return {
      columns: ['Message'],
      rows: [{ Message: 'Connect to a Power BI model to run DAX queries.' }],
      executionTimeMs: Math.round(performance.now() - startTime)
    };
  }
}

export const daxEngine = new DaxEngine();
