import crypto from 'node:crypto';

// Tamper-evident audit trail: each entry's hash covers the previous entry's hash.
// Editing or deleting any historical row breaks every hash after it.
export const GENESIS_HASH = '0'.repeat(64);

export const hashEntry = (prevHash, e) =>
  crypto.createHash('sha256')
    .update(prevHash + JSON.stringify([String(e.userId), e.purchaseId ? String(e.purchaseId) : null, e.action, e.decision ?? null, e.reason ?? null, new Date(e.createdAt).toISOString()]))
    .digest('hex');

export function verifyChain(entries) {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== prev || e.hash !== hashEntry(prev, e)) return { valid: false, brokenAt: i };
    prev = e.hash;
  }
  return { valid: true, brokenAt: null };
}
