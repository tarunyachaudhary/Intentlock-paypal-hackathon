import { toCents, fromCents } from '../utils/money.js';

/**
 * Deterministic policy engine. No AI, no network, no randomness.
 * This is the ONLY thing that decides whether a purchase is eligible.
 *
 * policy:  { category, maxBudget, currency, allowedMerchants[] }
 * product: { id, name, category, price, currency, merchant: {id, name, verified} }
 * signals: hard-block signals from risk analysis (e.g. 'PROMPT_INJECTION')
 */
export function evaluatePolicy(policy, product, { signals = [] } = {}) {
  const priceC = toCents(product.price);
  const budgetC = toCents(policy.maxBudget);
  const checks = [];
  const add = (code, passed, ok, bad) => checks.push({ code, passed, detail: passed ? ok : bad });

  const catOk = !policy.category || policy.category === product.category;
  add('CATEGORY', catOk, `Category matches "${policy.category || 'any'}".`,
    `Policy allows "${policy.category}" but this is "${product.category}".`);

  const curOk = policy.currency === product.currency;
  add('CURRENCY', curOk, `Priced in ${product.currency}.`,
    `Policy is in ${policy.currency} but product is priced in ${product.currency}.`);

  const budgetOk = priceC <= budgetC;
  add('BUDGET', budgetOk, `$${fromCents(priceC)} is within the $${fromCents(budgetC)} limit.`,
    `$${fromCents(priceC)} exceeds the $${fromCents(budgetC)} limit by $${fromCents(priceC - budgetC)}.`);

  const verified = !!product.merchant?.verified;
  add('MERCHANT_VERIFIED', verified, `${product.merchant?.name} is a verified (demo) merchant.`,
    `${product.merchant?.name || 'Seller'} is not a verified merchant.`);

  const allow = policy.allowedMerchants || [];
  const onList = allow.length === 0 || allow.includes(product.merchant?.id);
  add('MERCHANT_ALLOWLIST', onList,
    allow.length ? `${product.merchant?.name} is on your allowed list.` : 'No seller restriction set.',
    `${product.merchant?.name} is not on your allowed seller list.`);

  const clean = !signals.includes('PROMPT_INJECTION');
  add('LISTING_INTEGRITY', clean, 'Listing text contains no instructions aimed at AI agents.',
    'Listing text tries to give instructions to AI agents. Ignored and blocked.');

  const violations = checks.filter((c) => !c.passed);
  return {
    decision: violations.length ? 'BLOCKED' : 'ALLOWED',
    allowed: violations.length === 0,
    checks,
    violations,
    priceCents: priceC,
    budgetCents: budgetC,
    remainingCents: budgetC - priceC,
    needsHumanApproval: true, // always: the agent can never self-authorise
  };
}
