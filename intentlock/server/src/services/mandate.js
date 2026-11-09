import crypto from 'node:crypto';

// A "mandate" is a short-lived, HMAC-signed record of exactly what the user authorised:
// who, what, how much, to whom, until when. Any tampering (e.g. a changed amount) invalidates it.
const canon = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ((a[k] = o[k]), a), {}));

export const signMandate = (payload, secret) =>
  crypto.createHmac('sha256', secret).update(canon(payload)).digest('hex');

export function verifyMandate(payload, signature, secret) {
  const expected = Buffer.from(signMandate(payload, secret));
  const given = Buffer.from(String(signature || ''));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export const mandateExpired = (payload, now = Date.now()) => new Date(payload.expiresAt).getTime() < now;
