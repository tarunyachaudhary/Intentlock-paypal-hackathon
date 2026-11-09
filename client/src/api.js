const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050/api';
let token = localStorage.getItem('il_token');

export const session = {
  get token() { return token; },
  set(t) { token = t; t ? localStorage.setItem('il_token', t) : localStorage.removeItem('il_token'); },
};

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, code: data.code });
  return data;
}

export const api = {
  register: (email, password) => call('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email, password) => call('/auth/login', { method: 'POST', body: { email, password } }),
  products: () => call('/products'),
  setPolicy: (instruction) => call('/policies', { method: 'POST', body: { instruction } }),
  activePolicy: () => call('/policies/active'),
  evaluate: (productId) => call('/agent/evaluate', { method: 'POST', body: { productId } }),
  approve: (id) => call(`/purchases/${id}/approve`, { method: 'POST' }),
  reject: (id) => call(`/purchases/${id}/reject`, { method: 'POST' }),
  createOrder: (purchaseId) => call('/payments/create-order', { method: 'POST', body: { purchaseId } }),
  captureOrder: (purchaseId, orderId) => call('/payments/capture-order', { method: 'POST', body: { purchaseId, orderId } }),
  history: () => call('/payments/history'),
  audit: () => call('/audit'),
  bumpPrice: (productId, delta) => call('/demo/bump-price', { method: 'POST', body: { productId, delta } }),
};
