import { env } from '../config/env.js';

let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 30_000) return cached.token;
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw Object.assign(new Error('PayPal authentication failed'), { status: 502 });
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function paypal(path, { method = 'GET', body, requestId } = {}) {
  const res = await fetch(`${env.PAYPAL_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}), // idempotency key
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('PayPal error', res.status, JSON.stringify(data));
    throw Object.assign(new Error(data.message || 'PayPal request failed'), { status: 502, paypal: data });
  }
  return data;
}

export const createOrder = ({ purchaseId, amount, currency, description }) =>
  paypal('/v2/checkout/orders', {
    method: 'POST',
    requestId: `intentlock-create-${purchaseId}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: String(purchaseId), custom_id: String(purchaseId), description, amount: { currency_code: currency, value: amount } }],
    },
  });

export const captureOrder = (orderId, purchaseId) =>
  paypal(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', requestId: `intentlock-capture-${purchaseId}`, body: {} });

export const getOrder = (orderId) => paypal(`/v2/checkout/orders/${orderId}`);
