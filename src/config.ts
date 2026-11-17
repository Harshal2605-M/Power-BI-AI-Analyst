// Dynamic API Gateway configuration
// Uses high-speed Cloudflare tunnel by default for zero-friction HTTPS connection
export function getApiBaseUrl(): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('powerbi_mcp_gateway_url') : null;
  return saved || import.meta.env.VITE_API_URL || 'https://oven-prototype-earl-welfare.trycloudflare.com';
}

export function setApiBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    localStorage.setItem('powerbi_mcp_gateway_url', clean);
  }
}
