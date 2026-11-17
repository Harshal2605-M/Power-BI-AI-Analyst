// Dynamic API Gateway configuration
// Allows any user on the deployed Vercel site to connect to their own local bridge or tunnel
export function getApiBaseUrl(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('powerbi_mcp_gateway_url') : null;
  return saved || import.meta.env.VITE_API_URL || 'https://good-views-rule.loca.lt';
}

export function setApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    localStorage.setItem('powerbi_mcp_gateway_url', clean);
  }
}
