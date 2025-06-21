// LMSR Automated Market Maker for log-bucketed outcomes
// See: https://en.wikipedia.org/wiki/Market_scoring_rule#Logarithmic_market_scoring_rule

/**
 * Create log-10 buckets for valuation outcomes.
 * @param {number} min - Minimum valuation (e.g. 1e7 for $10m)
 * @param {number} max - Maximum valuation (e.g. 1e12 for $1T)
 * @param {number} bucketWidth - Width of each bucket in log10 space (e.g. 0.7)
 * @returns {Array<{low: number, high: number, center: number, idx: number}>}
 */
// Use fixed bucket size (e.g. $5M)
export const BUCKET_SIZE = 5_000_000; // Change this value to adjust bucket size

/**
 * Generate a realistic prior probability distribution (log-normal-like, peaked around median)
 * @param {Array} buckets - Output of makeBuckets
 * @param {number} median - The median valuation (e.g., 40_000_000)
 * @param {number} sigma - Controls spread (higher = wider)
 * @returns {number[]} Normalized probability vector (sums to 1)
 */
export function priorLogNormal(buckets, median = 40_000_000, sigma = 0.5) {
  const vals = buckets.map(bk => Math.exp(-0.5 * (Math.log(bk.center/median)/sigma)**2));
  const total = vals.reduce((a, b) => a + b, 0);
  return vals.map(v => v / total);
}

/**
 * Compute Bayesian evidence trade for LMSR AMM
 * @param {number[]} p - Current probability vector (normalized)
 * @param {number[]} p_yes - Conditional prob if news is true (normalized)
 * @param {number[]} p_no - Conditional prob if news is false (normalized)
 * @param {number} c - Confidence in news (0-1)
 * @param {number} b - LMSR liquidity parameter
 * @returns {number[]} delta_q vector to buy (same length as p)
 */
export function bayesianEvidenceTrade(p, p_yes, p_no, c, b) {
  // Compute target distribution
  const p_prime = p_yes.map((py, i) => c*py + (1-c)*p_no[i]);
  // Avoid division by zero
  return p.map((pi, i) => b * Math.log((p_prime[i] + 1e-12) / (pi + 1e-12)));
}

export function makeBuckets(min, max, bucketSize = BUCKET_SIZE) {
  // Round min and max to nearest bucket edges
  const start = Math.floor(min / bucketSize) * bucketSize;
  const end = Math.ceil(max / bucketSize) * bucketSize;
  const buckets = [];
  for (let low = start, i = 0; low < end; low += bucketSize, i++) {
    const high = low + bucketSize;
    const center = low + bucketSize / 2;
    buckets.push({ low, high, center, idx: i });
  }
  return buckets;
}


/**
 * LMSR cost function: C(q) = b * ln(sum_k exp(q_k / b))
 * @param {number[]} q - Outstanding shares vector (length N)
 * @param {number} b - Liquidity parameter
 * @returns {number}
 */
export function lmsrCost(q, b) {
  const maxQ = Math.max(...q);
  // For numerical stability, subtract maxQ
  const sumExp = q.reduce((sum, qk) => sum + Math.exp((qk - maxQ) / b), 0);
  return b * (Math.log(sumExp) + maxQ / b);
}

/**
 * LMSR price vector: p_k = exp(q_k/b) / sum_j exp(q_j/b)
 * @param {number[]} q - Outstanding shares vector (length N)
 * @param {number} b - Liquidity parameter
 * @returns {number[]} - Probabilities for each bucket
 */
export function lmsrPrices(q, b) {
  const maxQ = Math.max(...q);
  const expQ = q.map(qk => Math.exp((qk - maxQ) / b));
  const sumExp = expQ.reduce((a, b) => a + b, 0);
  return expQ.map(e => e / sumExp);
}

/**
 * Execute a trade: delta is a vector of shares to buy/sell in each bucket
 * Returns the payment required for the trade (cost(q+delta) - cost(q))
 * @param {number[]} q - Current outstanding shares
 * @param {number[]} delta - Shares to buy/sell (same length as q)
 * @param {number} b - Liquidity parameter
 * @returns {number}
 */
export function lmsrTrade(q, delta, b) {
  const qBefore = q.slice();
  const qAfter = q.map((qk, i) => qk + (delta[i] || 0));
  const payment = lmsrCost(qAfter, b) - lmsrCost(qBefore, b);
  return { payment, qAfter };
}

/**
 * Price a binary option (e.g., V > K): sum p_k for all buckets where bucket.low >= K
 * @param {number[]} prices - LMSR price vector
 * @param {Array<{low:number,high:number}>} buckets - Buckets as from makeBuckets
 * @param {number} K - Strike value (threshold)
 * @returns {number}
 */
export function priceBinary(prices, buckets, K) {
  return prices.reduce((sum, p, i) => sum + (buckets[i].low >= K ? p : 0), 0);
}

/**
 * Price a call option (V-K)^+: sum p_k * max(center-K,0)
 * @param {number[]} prices - LMSR price vector
 * @param {Array<{center:number}>} buckets - Buckets as from makeBuckets
 * @param {number} K - Strike value
 * @returns {number}
 */
export function priceCall(prices, buckets, K) {
  return prices.reduce((sum, p, i) => sum + p * Math.max(buckets[i].center - K, 0), 0);
}
