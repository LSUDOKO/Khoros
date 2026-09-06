/**
 * Beta distribution helpers.
 *
 * docs/04-TRUST_SCORING.md asks for CI95 = [BetaInv(0.025, a, b), BetaInv(0.975, a, b)].
 * There is no incomplete-beta inverse in the JS standard library, so it is
 * implemented here: a continued-fraction evaluation of the regularised
 * incomplete beta, then a bisection inverse over it.
 *
 * Bisection rather than Newton on purpose. It is a handful of microseconds
 * either way at our scale, it cannot diverge, and the alternative — shipping an
 * approximation that quietly misreports uncertainty — would undermine the one
 * thing this interval exists to communicate honestly.
 */

/** Log-gamma via the Lanczos approximation. */
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    // Reflection formula.
    return (
      Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
    );
  }

  const z = x - 1;
  let a = c[0] as number;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += (c[i] as number) / (z + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Continued fraction for the incomplete beta, by the modified Lentz method.
 * Numerical Recipes' `betacf`.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITER = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;

    // Even step.
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    // Odd step.
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }

  return h;
}

/**
 * Regularised incomplete beta I_x(a, b) — the Beta CDF.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );

  // The continued fraction converges quickly only on one side of the mean;
  // use the symmetry relation on the other.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Inverse Beta CDF by bisection: the p-th quantile of Beta(a, b).
 */
export function betaInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;

  let lo = 0;
  let hi = 1;
  // 60 halvings takes the bracket well below double precision on [0,1].
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The 95% credible interval of Beta(alpha, beta). */
export function betaInterval95(
  alpha: number,
  beta: number,
): [number, number] {
  return [betaInv(0.025, alpha, beta), betaInv(0.975, alpha, beta)];
}
