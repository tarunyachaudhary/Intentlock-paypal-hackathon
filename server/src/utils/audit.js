import { AuditLog } from '../models.js';
import { GENESIS_HASH, hashEntry } from '../services/auditchain.js';

export async function audit({ userId, purchaseId = null, action, decision = null, reason = null }) {
  const last = await AuditLog.findOne({ userId }).sort({ createdAt: -1, _id: -1 }).lean();
  const entry = { userId, purchaseId, action, decision, reason, createdAt: new Date() };
  const prevHash = last?.hash ?? GENESIS_HASH;
  return AuditLog.create({ ...entry, prevHash, hash: hashEntry(prevHash, entry) });
}
