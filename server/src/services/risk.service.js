// Heuristic risk score, advisory only (except PROMPT_INJECTION, which the policy engine hard-blocks).
// This is NOT fraud detection and does not verify real-world merchants.
const INJECTION = [
  /ignore (all |any |the |your )?(previous|prior|user|user's|budget|instructions|rules)/i,
  /(system|assistant|developer)\s*(note|message|prompt)\s*(to|for)/i,
  /(note|message) to (ai|llm|agents?|assistants?)/i,
  /approve (this|the) (purchase|order|payment)/i,
  /do not (ask|tell|notify) the user/i,
  /override (the )?(policy|budget|limit)/i,
];

export const detectInjection = (text = '') => INJECTION.some((r) => r.test(text));

export function assessRisk(policy, product, allProducts = []) {
  const signals = [];
  let score = 0;
  const hit = (code, weight, detail, hard = false) => { score += weight; signals.push({ code, weight, detail, hard }); };

  if (!product.merchant?.verified) hit('UNVERIFIED_MERCHANT', 40, 'Seller is not verified.');
  if (detectInjection(product.description)) hit('PROMPT_INJECTION', 45, 'Listing contains text aimed at manipulating AI agents.', true);

  const used = product.price / policy.maxBudget;
  if (used > 0.9 && used <= 1) hit('NEAR_LIMIT', 10, `Uses ${(used * 100).toFixed(0)}% of the budget.`);

  const peers = allProducts.filter((p) => p.category === product.category && p.id !== product.id).map((p) => p.price).sort((a, b) => a - b);
  if (peers.length) {
    const median = peers[Math.floor(peers.length / 2)];
    if (product.price < median * 0.4) hit('SUSPICIOUSLY_CHEAP', 15, `Price is far below similar items (median $${median.toFixed(2)}).`);
  }

  score = Math.min(100, score);
  const level = score >= 60 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return { score, level, signals, hardSignals: signals.filter((s) => s.hard).map((s) => s.code) };
}
