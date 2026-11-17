// Dynamic API Gateway configuration
// Uses high-speed Cloudflare tunnel by default for zero-friction HTTPS connection
export const LIVE_TUNNEL_URL = 'https://oral-node-hitting-impaired.trycloudflare.com';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const saved = localStorage.getItem('powerbi_mcp_gateway_url');

    // When running locally at http://localhost:5173, always default to local bridge http://localhost:3001
    if (isLocalhost) {
      if (saved && (saved.includes('localhost:') || saved.includes('127.0.0.1:'))) {
        return saved;
      }
      return 'http://localhost:3001';
    }

    if (saved) return saved;
  }
  return import.meta.env.VITE_API_URL || LIVE_TUNNEL_URL;
}

export function setApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    localStorage.setItem('powerbi_mcp_gateway_url', clean);
  }
}

export function clearApiBaseUrl(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('powerbi_mcp_gateway_url');
  }
}
