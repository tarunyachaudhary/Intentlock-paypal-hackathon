// All money comparisons use integer cents. Floats never decide a payment.
export const toCents = (v) => Math.round(Number(v) * 100);
export const fromCents = (c) => (c / 100).toFixed(2);
