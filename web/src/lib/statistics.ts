/**
 * Regularized incomplete beta and inverse-beta helpers.
 *
 * All inputs are validated before any numerical work. Invalid or non-finite
 * arguments return NaN; valid probabilities and shape parameters use the
 * domain [0, 1] and positive, finite Beta shapes respectively.
 */

const BETA_EPS = 3e-14;
const BETA_FPMIN = 1e-300;
const BETA_MAX_ITER = 300;
const MAX_SAFE_BETA_SHAPE = 1e300;

function lnGamma(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;

  if (value < 0.5) {
    const sine = Math.sin(Math.PI * value);
    if (sine === 0) return Number.NaN;
    return Math.log(Math.PI / sine) - lnGamma(1 - value);
  }

  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  const shifted = value - 1;
  let series = 0.99999999999980993;
  const t = shifted + 7.5;
  for (let i = 0; i < coefficients.length; i++) {
    series += coefficients[i]! / (shifted + i + 1);
  }
  return 0.5 * Math.log(2 * Math.PI)
    + (shifted + 0.5) * Math.log(t)
    - t
    + Math.log(series);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < BETA_FPMIN) d = d < 0 ? -BETA_FPMIN : BETA_FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= BETA_MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < BETA_FPMIN) d = d < 0 ? -BETA_FPMIN : BETA_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < BETA_FPMIN) c = c < 0 ? -BETA_FPMIN : BETA_FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < BETA_FPMIN) d = d < 0 ? -BETA_FPMIN : BETA_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < BETA_FPMIN) c = c < 0 ? -BETA_FPMIN : BETA_FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < BETA_EPS) break;
  }
  return h;
}

function validFinite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The Beta(a,b) CDF at x, I_x(a,b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!validFinite(x) || !validFinite(a) || !validFinite(b)) return Number.NaN;
  if (x < 0 || x > 1 || a <= 0 || b <= 0) return Number.NaN;
  if (a > MAX_SAFE_BETA_SHAPE || b > MAX_SAFE_BETA_SHAPE) return Number.NaN;
  if (!Number.isFinite(a + b)) return Number.NaN;

  if (x === 0) return 0;
  if (x === 1) return 1;

  if (a === 1) return 1 - Math.pow(1 - x, b);
  if (b === 1) return Math.pow(x, a);

  const logFactor = lnGamma(a + b) - lnGamma(a) - lnGamma(b)
    + a * Math.log(x)
    + b * Math.log1p(-x);
  if (!Number.isFinite(logFactor)) return Number.NaN;
  const factor = Math.exp(logFactor);

  let result: number;
  if (x < (a + 1) / (a + b + 2)) {
    result = (factor * betaContinuedFraction(a, b, x)) / a;
  } else {
    result = 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
  }

  if (!Number.isFinite(result)) return Number.NaN;
  return Math.min(1, Math.max(0, result));
}

/** The quantile Q(p) of a Beta(a,b) distribution. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!validFinite(p) || !validFinite(a) || !validFinite(b)) return Number.NaN;
  if (p < 0 || p > 1 || a <= 0 || b <= 0) return Number.NaN;
  if (a > MAX_SAFE_BETA_SHAPE || b > MAX_SAFE_BETA_SHAPE) return Number.NaN;
  if (!Number.isFinite(a + b)) return Number.NaN;

  if (p === 0) return 0;
  if (p === 1) return 1;
  if (p === 0.5 && a === b) return 0.5;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const mid = low + (high - low) * 0.5;
    if (mid === low || mid === high) break;
    const cdf = regularizedIncompleteBeta(mid, a, b);
    if (Number.isNaN(cdf)) return Number.NaN;
    if (cdf < p) low = mid;
    else high = mid;
  }
  return low + (high - low) * 0.5;
}
