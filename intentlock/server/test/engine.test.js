import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../src/services/policy.service.js';
import { assessRisk, detectInjection } from '../src/services/risk.service.js';
import { signMandate, verifyMandate, mandateExpired } from '../src/services/mandate.js';
import { hashEntry, verifyChain, GENESIS_HASH } from '../src/services/auditchain.js';
import { getProduct, listProducts, bumpPrice } from '../src/services/catalog.js';

const policy = { category: 'keyboard', maxBudget: 100, currency: 'USD', allowedMerchants: ['keyhaus'] };

test('safe purchase is allowed and always needs human approval', () => {
  const r = evaluatePolicy(policy, getProduct('kb-001'));
  assert.equal(r.decision, 'ALLOWED');
  assert.equal(r.remainingCents, 2001);
  assert.equal(r.needsHumanApproval, true);
});

test('over-budget purchase is blocked with exact overage', () => {
  const r = evaluatePolicy(policy, getProduct('kb-002'));
  assert.equal(r.decision, 'BLOCKED');
  assert.match(r.violations.find((v) => v.code === 'BUDGET').detail, /exceeds the \$100\.00 limit by \$49\.00/);
});

test('unverified merchant is blocked even if cheap and in budget', () => {
  const r = evaluatePolicy({ ...policy, allowedMerchants: [] }, getProduct('kb-003'));
  assert.equal(r.decision, 'BLOCKED');
  assert.ok(r.violations.some((v) => v.code === 'MERCHANT_VERIFIED'));
});

test('wrong category is blocked', () => {
  assert.equal(evaluatePolicy(policy, getProduct('hp-001')).decision, 'BLOCKED');
});

test('prompt injection in a verified merchant listing is hard-blocked', () => {
  const p = getProduct('kb-004');
  assert.equal(detectInjection(p.description), true);
  const risk = assessRisk(policy, p, listProducts());
  assert.deepEqual(risk.hardSignals, ['PROMPT_INJECTION']);
  const r = evaluatePolicy(policy, p, { signals: risk.hardSignals });
  assert.equal(r.decision, 'BLOCKED');
  assert.ok(r.violations.some((v) => v.code === 'LISTING_INTEGRITY'));
});

test('clean listing has no injection signal', () => {
  assert.equal(detectInjection(getProduct('kb-001').description), false);
});

test('cents arithmetic: price exactly at budget passes', () => {
  assert.equal(evaluatePolicy({ ...policy, maxBudget: 79.99 }, getProduct('kb-001')).decision, 'ALLOWED');
});

test('price drift is visible after a merchant raises the price', () => {
  assert.equal(evaluatePolicy(policy, getProduct('ms-001')).priceCents, 2999);
  bumpPrice('ms-001', 5);
  assert.equal(evaluatePolicy(policy, getProduct('ms-001')).priceCents, 3499);
  bumpPrice('ms-001', -5);
});

test('mandate: valid, tampered amount rejected, expiry detected', () => {
  const payload = { userId: 'u1', productId: 'kb-001', amountCents: 7999, currency: 'USD', expiresAt: new Date(Date.now() + 60000).toISOString() };
  const sig = signMandate(payload, 'secret-secret-secret');
  assert.equal(verifyMandate(payload, sig, 'secret-secret-secret'), true);
  assert.equal(verifyMandate({ ...payload, amountCents: 1 }, sig, 'secret-secret-secret'), false);
  assert.equal(verifyMandate(payload, sig, 'other-secret-secret!'), false);
  assert.equal(mandateExpired({ expiresAt: new Date(Date.now() - 1).toISOString() }), true);
});

test('audit chain detects tampering', () => {
  const mk = (prev, action, reason) => {
    const e = { userId: 'u1', purchaseId: 'p1', action, decision: 'ALLOWED', reason, createdAt: new Date() };
    return { ...e, prevHash: prev, hash: hashEntry(prev, e) };
  };
  const a = mk(GENESIS_HASH, 'POLICY_EVALUATION', 'ok');
  const b = mk(a.hash, 'USER_APPROVED', 'ok');
  const c = mk(b.hash, 'CAPTURED', 'ok');
  assert.equal(verifyChain([a, b, c]).valid, true);
  assert.deepEqual(verifyChain([a, { ...b, reason: 'edited' }, c]), { valid: false, brokenAt: 1 });
});
