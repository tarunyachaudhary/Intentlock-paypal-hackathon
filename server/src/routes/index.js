import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { User, Policy, Purchase, AuditLog } from '../models.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { ah, HttpError } from '../middleware/error.middleware.js';
import { audit } from '../utils/audit.js';
import { fromCents, toCents } from '../utils/money.js';
import { listProducts, getProduct, bumpPrice } from '../services/catalog.js';
import { evaluatePolicy } from '../services/policy.service.js';
import { assessRisk } from '../services/risk.service.js';
import { parsePolicy, explainDecision } from '../services/ai.service.js';
import { signMandate, verifyMandate, mandateExpired } from '../services/mandate.js';
import { verifyChain } from '../services/auditchain.js';
import * as paypal from '../services/paypal.service.js';

const r = Router();
const MANDATE_TTL_MS = 10 * 60 * 1000;
const token = (u) => jwt.sign({ sub: String(u._id) }, env.JWT_SECRET, { expiresIn: '12h' });

/* ---------- auth ---------- */
const creds = z.object({ email: z.string().email(), password: z.string().min(8).max(100) });

r.post('/auth/register', ah(async (req, res) => {
  const { email, password } = creds.parse(req.body);
  if (await User.exists({ email })) throw new HttpError(409, 'Email already registered');
  const u = await User.create({ email, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: token(u), email: u.email });
}));

r.post('/auth/login', ah(async (req, res) => {
  const { email, password } = creds.parse(req.body);
  const u = await User.findOne({ email });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: token(u), email: u.email });
}));

/* ---------- catalogue ---------- */

/* ---------- catalogue: show only policy-eligible products ---------- */
r.get('/products', requireAuth, ah(async (req, res) => {
  const policy = await Policy.findOne({
    userId: req.userId,
    active: true,
  }).sort({ createdAt: -1 });

  // No active policy means no products are eligible for discovery.
  if (!policy) {
    return res.json([]);
  }

  const pol = policy.toObject();
  const catalogue = listProducts();

  const eligibleProducts = catalogue.filter((product) => {
    const risk = assessRisk(pol, product, catalogue);

    const result = evaluatePolicy(pol, product, {
      signals: risk.hardSignals,
    });

    return result.allowed;
  });

  res.json(eligibleProducts);
}));


/* ---------- policies: natural language -> structured permissions ---------- */
r.post('/policies', requireAuth, ah(async (req, res) => {
  const { instruction } = z.object({ instruction: z.string().min(5).max(500) }).parse(req.body);
  const p = await parsePolicy(instruction);
  await Policy.updateMany({ userId: req.userId, active: true }, { active: false });
  const policy = await Policy.create({ ...p, userId: req.userId, instruction, parsedBy: p.source });
  await audit({ userId: req.userId, action: 'POLICY_CREATED', decision: 'OK', reason: `$${p.maxBudget} ${p.category ?? 'any'} (parsed by ${p.source})` });
  res.status(201).json(policy);
}));

r.get('/policies/active', requireAuth, ah(async (req, res) => {
  res.json(await Policy.findOne({ userId: req.userId, active: true }).sort({ createdAt: -1 }));
}));

/* ---------- agent: propose a purchase, IntentLock decides ---------- */
r.post('/agent/evaluate', requireAuth, ah(async (req, res) => {
  const { productId } = z.object({ productId: z.string() }).parse(req.body);
  const policy = await Policy.findOne({ userId: req.userId, active: true }).sort({ createdAt: -1 });
  if (!policy) throw new HttpError(400, 'Set a spending policy first');
  const product = getProduct(productId); // price comes from the server catalogue, never the client
  if (!product) throw new HttpError(404, 'Unknown product');

  const pol = policy.toObject();
  const risk = assessRisk(pol, product, listProducts());
  const result = evaluatePolicy(pol, product, { signals: risk.hardSignals });
  const price = fromCents(result.priceCents);

  const explanation = await explainDecision({
    decision: result.decision, product: product.name, price, budget: fromCents(result.budgetCents),
    remaining: fromCents(Math.max(0, result.remainingCents)), violations: result.violations.map((v) => v.detail),
  });

  let mandate;
  if (result.allowed) {
    const payload = {
      userId: String(req.userId), policyId: String(policy._id), productId: product.id, merchantId: product.merchant.id,
      amountCents: result.priceCents, currency: product.currency, expiresAt: new Date(Date.now() + MANDATE_TTL_MS).toISOString(),
    };
    mandate = { payload, signature: signMandate(payload, env.MANDATE_SECRET) };
  }

  const purchase = await Purchase.create({
    userId: req.userId, policyId: policy._id, policySnapshot: pol, productSnapshot: product,
    amount: result.priceCents / 100, currency: product.currency, policyDecision: result.decision,
    checks: result.checks, risk, explanation, mandate,
    status: result.allowed ? 'PENDING_APPROVAL' : 'BLOCKED',
    blockReason: result.allowed ? undefined : result.violations.map((v) => v.detail).join(' '),
  });
  await audit({ userId: req.userId, purchaseId: purchase._id, action: 'POLICY_EVALUATION', decision: result.decision,
    reason: result.allowed ? `${product.name} $${price} within policy` : purchase.blockReason });
  res.status(201).json(purchase);
}));

/* ---------- human approval: the only way a purchase becomes payable ---------- */
async function loadOwned(req) {
  const p = await Purchase.findOne({ _id: req.params.id ?? req.body.purchaseId, userId: req.userId });
  if (!p) throw new HttpError(404, 'Purchase not found');
  return p;
}


async function assertMandateValid(p) {
  const payload = p.mandate?.payload;

  // Compare the signed authorization against the actual purchase record.
  const bindingsMatch = Boolean(
    payload &&
    payload.userId === String(p.userId) &&
    payload.policyId === String(p.policyId) &&
    payload.productId === p.productSnapshot?.id &&
    payload.merchantId === p.productSnapshot?.merchant?.id &&
    payload.currency === p.currency &&
    payload.currency === p.productSnapshot?.currency &&
    Number.isSafeInteger(payload.amountCents) &&
    payload.amountCents > 0 &&
    payload.amountCents === toCents(p.amount) &&
    p.policyDecision === 'ALLOWED'
  );

  const signatureValid = Boolean(
    payload &&
    p.mandate?.signature &&
    verifyMandate(payload, p.mandate.signature, env.MANDATE_SECRET)
  );

  if (!bindingsMatch || !signatureValid) {
    await Purchase.updateOne(
      { _id: p._id },
      {
        status: 'FAILED',
        blockReason: 'Mandate verification failed',
      }
    );

    await audit({
      userId: p.userId,
      purchaseId: p._id,
      action: 'MANDATE_INVALID',
      decision: 'BLOCKED',
      reason: 'Mandate signature or purchase binding verification failed',
    });

    throw new HttpError(
      409,
      'Authorization record failed verification'
    );
  }

  // Check expiration after signature and purchase binding verification.
  if (mandateExpired(payload)) {
    await Purchase.updateOne(
      { _id: p._id },
      {
        status: 'EXPIRED',
        blockReason: 'Authorization expired',
      }
    );

    await audit({
      userId: p.userId,
      purchaseId: p._id,
      action: 'MANDATE_EXPIRED',
      decision: 'BLOCKED',
      reason: 'Approval window passed',
    });

    throw new HttpError(
      409,
      'Approval window expired. Ask the agent again.'
    );
  }
}


r.post('/purchases/:id/approve', requireAuth, ah(async (req, res) => {
  const p = await loadOwned(req);
  if (p.status !== 'PENDING_APPROVAL') throw new HttpError(409, `Cannot approve a purchase that is ${p.status}`);
  await assertMandateValid(p);
  const upd = await Purchase.findOneAndUpdate({ _id: p._id, userId: req.userId, status: 'PENDING_APPROVAL' },
    { status: 'APPROVED', approvedAt: new Date() }, { new: true });
  if (!upd) throw new HttpError(409, 'Purchase already handled');
  await audit({ userId: req.userId, purchaseId: p._id, action: 'USER_APPROVED', decision: 'APPROVED', reason: `Human approved $${upd.amount.toFixed(2)}` });
  res.json(upd);
}));

r.post('/purchases/:id/reject', requireAuth, ah(async (req, res) => {
  const p = await loadOwned(req);
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(p.status)) throw new HttpError(409, `Cannot reject a purchase that is ${p.status}`);
  p.status = 'FAILED'; p.blockReason = 'Rejected by user'; await p.save();
  await audit({ userId: req.userId, purchaseId: p._id, action: 'USER_REJECTED', decision: 'REJECTED', reason: 'Human declined' });
  res.json(p);
}));

/* ---------- payments ---------- */
r.post('/payments/create-order', requireAuth, ah(async (req, res) => {
  const { purchaseId } = z.object({ purchaseId: z.string() }).parse(req.body);
  const p = await Purchase.findOne({ _id: purchaseId, userId: req.userId });
  if (!p) throw new HttpError(404, 'Purchase not found');
  if (p.status === 'ORDER_CREATED' && p.paypalOrderId) return res.json({ orderId: p.paypalOrderId }); // idempotent
  if (p.status !== 'APPROVED') throw new HttpError(409, 'Purchase has not been approved by you');
  await assertMandateValid(p);

  // Re-check against the CURRENT catalogue right before money moves.
  const current = getProduct(p.productSnapshot.id);
  const risk = assessRisk(p.policySnapshot, current, listProducts());
  const recheck = evaluatePolicy(p.policySnapshot, current, { signals: risk.hardSignals });
  if (!recheck.allowed || recheck.priceCents !== toCents(p.amount)) {
    const reason = recheck.priceCents !== toCents(p.amount)
      ? `Price changed from $${p.amount.toFixed(2)} to $${fromCents(recheck.priceCents)} after you approved.`
      : recheck.violations.map((v) => v.detail).join(' ');
    await Purchase.updateOne({ _id: p._id }, { status: 'BLOCKED', blockReason: reason });
    await audit({ userId: req.userId, purchaseId: p._id, action: 'RECHECK_BLOCKED', decision: 'BLOCKED', reason });
    throw new HttpError(409, `Blocked before payment: ${reason}`, { code: 'PRICE_DRIFT' });
  }

  const locked = await Purchase.findOneAndUpdate({ _id: p._id, userId: req.userId, status: 'APPROVED' }, { status: 'ORDER_CREATING' }, { new: true });
  if (!locked) throw new HttpError(409, 'Order is already being created');
  try {
    const order = await paypal.createOrder({ purchaseId: p._id, amount: p.amount.toFixed(2), currency: p.currency, description: p.productSnapshot.name.slice(0, 120) });
    await Purchase.updateOne({ _id: p._id }, { status: 'ORDER_CREATED', paypalOrderId: order.id });
    await audit({ userId: req.userId, purchaseId: p._id, action: 'PAYPAL_ORDER_CREATED', decision: 'OK', reason: `Order ${order.id} for $${p.amount.toFixed(2)}` });
    res.json({ orderId: order.id });
  } catch (e) {
    await Purchase.updateOne({ _id: p._id, status: 'ORDER_CREATING' }, { status: 'APPROVED' });
    throw e;
  }
}));

r.post('/payments/capture-order', requireAuth, ah(async (req, res) => {
  const { purchaseId, orderId } = z.object({ purchaseId: z.string(), orderId: z.string() }).parse(req.body);
  const p = await Purchase.findOne({ _id: purchaseId, userId: req.userId });
  if (!p) throw new HttpError(404, 'Purchase not found');
  if (p.status === 'CAPTURED') return res.json(p); // duplicate request, same result

  if (p.status !== 'ORDER_CREATED' || p.paypalOrderId !== orderId) {
    await audit({
      userId: req.userId,
      purchaseId: p._id,
      action: 'CAPTURE_REJECTED',
      decision: 'BLOCKED',
      reason: 'Order does not match this approved purchase',
    });

    throw new HttpError(
      409,
      'This order does not belong to an approved purchase'
    );
  }

  // Verify mandate only after the order matches.
  await assertMandateValid(p);

  const locked = await Purchase.findOneAndUpdate({ _id: p._id, userId: req.userId, status: 'ORDER_CREATED', paypalOrderId: orderId }, { status: 'CAPTURING' }, { new: true });
  if (!locked) throw new HttpError(409, 'Capture already in progress');
  try {
    const cap = await paypal.captureOrder(orderId, p._id);
    const capture = cap.purchase_units?.[0]?.payments?.captures?.[0];
    const ok = cap.status === 'COMPLETED' && capture?.status === 'COMPLETED'
      && capture.amount?.value === p.amount.toFixed(2) && capture.amount?.currency_code === p.currency;
    if (!ok) {
      await Purchase.updateOne({ _id: p._id }, { status: 'FAILED', blockReason: 'Captured amount or status did not match approval' });
      await audit({ userId: req.userId, purchaseId: p._id, action: 'CAPTURE_MISMATCH', decision: 'FAILED', reason: `PayPal returned ${cap.status} ${capture?.amount?.value ?? '?'}` });
      throw new HttpError(502, 'Payment result did not match what you approved');
    }
    const done = await Purchase.findByIdAndUpdate(p._id, { status: 'CAPTURED', paypalCaptureId: capture.id, capturedAt: new Date() }, { new: true });
    await audit({ userId: req.userId, purchaseId: p._id, action: 'PAYMENT_CAPTURED', decision: 'CAPTURED', reason: `Capture ${capture.id} $${capture.amount.value}` });
    res.json(done);
  } catch (e) {
    await Purchase.updateOne({ _id: p._id, status: 'CAPTURING' }, { status: 'ORDER_CREATED' }); // PayPal may allow retry
    throw e;
  }
}));

r.get('/payments/history', requireAuth, ah(async (req, res) => {
  res.json(await Purchase.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).select('-policySnapshot'));
}));

/* ---------- audit ---------- */
r.get('/audit', requireAuth, ah(async (req, res) => {
  const all = await AuditLog.find({ userId: req.userId }).sort({ createdAt: 1, _id: 1 }).lean();
  res.json({ chain: verifyChain(all), entries: all.slice(-100).reverse() });
}));

/* ---------- demo helpers (disabled when DEMO_MODE=false) ---------- */
r.post('/demo/bump-price', requireAuth, ah(async (req, res) => {
  if (!env.demo) throw new HttpError(404, 'Not found');
  const { productId, delta } = z.object({ productId: z.string(), delta: z.number().min(-1000).max(1000) }).parse(req.body);
  const p = bumpPrice(productId, delta);
  if (!p) throw new HttpError(404, 'Unknown product');
  res.json(p);
}));

export default r;
