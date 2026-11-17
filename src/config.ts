// Dynamic API Gateway configuration
// Uses high-speed Cloudflare tunnel by default for zero-friction HTTPS connection
export const LIVE_TUNNEL_URL = 'https://mag-conditional-declared-hepatitis.trycloudflare.com';

export function getApiBaseUrl(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('powerbi_mcp_gateway_url') : null;
  return saved || import.meta.env.VITE_API_URL || LIVE_TUNNEL_URL;
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
