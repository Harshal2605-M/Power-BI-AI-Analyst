// API Gateway Base URL
// In development: defaults to local proxy backend at http://localhost:3001
// In production: can be configured via VITE_API_URL environment variable
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
