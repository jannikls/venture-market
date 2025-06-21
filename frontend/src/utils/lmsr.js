// LMSR Automated Market Maker for log-bucketed outcomes
// See: https://en.wikipedia.org/wiki/Market_scoring_rule#Logarithmic_market_scoring_rule

/**
 * Create log-10 buckets for valuation outcomes.
 * @param {number} min - Minimum valuation (e.g. 1e7 for $10m)
 * @param {number} max - Maximum valuation (e.g. 1e12 for $1T)
 * @param {number} bucketWidth - Width of each bucket in log10 space (e.g. 0.7)
 * @returns {Array<{low: number, high: number, center: number, idx: number}>}
 */
// Repeating log-decade sequence: 5, 10, 25, 50 (millions, billions, etc.)
export const LOG_BUCKET_PATTERN = [5, 10, 25, 50];
export const LOG_BUCKET_BASE = 1e6; // Start at $1M
export const LOG_BUCKET_MAX = 1e12; // $1T

/**
 * Format a value as a compact currency string (e.g., 1.5M, 2.3B)
 * @param {number} value - The value to format
 * @returns {string} Formatted string
 */
export function formatCurrency(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Get plain-language description for a bucket
 * @param {{low: number, high: number}} bucket - The bucket to describe
 * @returns {string} Human-readable description
 */
export function getBucketDescription(bucket) {
  if (!bucket) return '';
  if (bucket.high === Infinity) return `Pays $1 if valuation ≥ ${formatCurrency(bucket.low)}`;
  return `Pays $1 if valuation in ${formatCurrency(bucket.low)}–${formatCurrency(bucket.high)} range`;
}

/**
 * Find or create a bucket for a given value
 * @param {number} value - The value to find a bucket for
 * @param {Array} buckets - Current buckets array
 * @returns {{bucket: Object, index: number, isNew: boolean}} - The bucket and its index
 */
export function findOrCreateBucket(value, buckets) {
  // First try to find an existing bucket
  const exactMatch = buckets.find(b => Math.abs(b.center - value) < 1e-6);
  if (exactMatch) {
    return { bucket: exactMatch, index: buckets.indexOf(exactMatch), isNew: false };
  }
  
  // If no exact match, create a new bucket
  const newBucket = {
    low: value,
    high: value * 1.1, // Default 10% range for single-point buckets
    center: value,
    idx: buckets.length,
    isCustom: true
  };
  
  // Insert in sorted order
  let insertIndex = 0;
  while (insertIndex < buckets.length && buckets[insertIndex].center < value) {
    insertIndex++;
  }
  
  // Add to buckets array
  buckets.splice(insertIndex, 0, newBucket);
  
  // Update indices
  buckets.forEach((b, i) => { b.idx = i; });
  
  return { bucket: newBucket, index: insertIndex, isNew: true };
}

/**
 * Generate repeating log-decade bucket grid: 5, 10, 25, 50 x 10^n, up to $1T
 * @returns {Array<{low: number, high: number, center: number, idx: number}>}
 */
export function makeLogBuckets(min = 5e6, max = LOG_BUCKET_MAX) {
  const buckets = [];
  let val = min;
  let idx = 0;
  let decade = 0;
  while (val < max) {
    for (let i = 0; i < LOG_BUCKET_PATTERN.length; i++) {
      const mult = LOG_BUCKET_PATTERN[i] * Math.pow(10, decade);
      const low = mult * LOG_BUCKET_BASE;
      const high = (i < LOG_BUCKET_PATTERN.length - 1)
        ? LOG_BUCKET_PATTERN[i + 1] * Math.pow(10, decade) * LOG_BUCKET_BASE
        : LOG_BUCKET_PATTERN[0] * Math.pow(10, decade + 1) * LOG_BUCKET_BASE;
      const center = (low + high) / 2;
      if (low >= min && low < max) {
        buckets.push({ low, high, center, idx });
        idx++;
      }
      val = high;
      if (val >= max) break;
    }
    decade++;
  }
  return buckets;
}

/**
 * Find the bucket index for a given value, auto-extend if needed
 * @param {number} val - Valuation
 * @param {Array} buckets - Current bucket grid
 * @param {number} max - Upper bound for extension (default $1T)
 * @returns {number} idx
 */
export function quoteBucket(val, buckets, max = LOG_BUCKET_MAX) {
  // Extend buckets if val > current max
  let last = buckets[buckets.length - 1];
  while (val >= last.high && last.high < max) {
    const extended = makeLogBuckets(last.high, last.high * 10);
    buckets.push(...extended);
    last = buckets[buckets.length - 1];
  }
  return buckets.findIndex(bk => val >= bk.low && val < bk.high);
}


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
