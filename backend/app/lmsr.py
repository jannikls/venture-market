import math
from typing import List, Dict, Any

# --- Log-decade bucket grid ---
LOG_BUCKET_PATTERN = [5, 10, 25, 50]
LOG_BUCKET_BASE = 1e6  # Start at $1M
LOG_BUCKET_MAX = 1e12  # $1T


def make_log_buckets(min_val=5e6, max_val=LOG_BUCKET_MAX):
    buckets = []
    val = min_val
    idx = 0
    decade = 0
    while val < max_val:
        for i in range(len(LOG_BUCKET_PATTERN)):
            mult = LOG_BUCKET_PATTERN[i] * (10 ** decade)
            low = mult * LOG_BUCKET_BASE
            high = (
                LOG_BUCKET_PATTERN[i + 1] * (10 ** decade) * LOG_BUCKET_BASE
                if i < len(LOG_BUCKET_PATTERN) - 1
                else LOG_BUCKET_PATTERN[0] * (10 ** (decade + 1)) * LOG_BUCKET_BASE
            )
            center = (low + high) / 2
            if low >= min_val and low < max_val:
                buckets.append({"low": low, "high": high, "center": center, "idx": idx})
                idx += 1
            val = high
            if val >= max_val:
                break
        decade += 1
    return buckets


def quote_bucket(val, buckets, max_val=LOG_BUCKET_MAX):
    last = buckets[-1]
    while val >= last["high"] and last["high"] < max_val:
        extended = make_log_buckets(last["high"], last["high"] * 10)
        buckets.extend(extended)
        last = buckets[-1]
    for i, bk in enumerate(buckets):
        if val >= bk["low"] and val < bk["high"]:
            return i
    return len(buckets) - 1  # fallback


def prior_lognormal(buckets, median=40_000_000, sigma=0.5):
    vals = [math.exp(-0.5 * (math.log(bk["center"] / median) / sigma) ** 2) for bk in buckets]
    total = sum(vals)
    return [v / total for v in vals]


def lmsr_cost(q: List[float], b: float) -> float:
    max_q = max(q)
    sum_exp = sum(math.exp((qk - max_q) / b) for qk in q)
    return b * (math.log(sum_exp) + max_q / b)


def lmsr_prices(q: List[float], b: float) -> List[float]:
    max_q = max(q)
    exp_q = [math.exp((qk - max_q) / b) for qk in q]
    sum_exp = sum(exp_q)
    return [e / sum_exp for e in exp_q]


def lmsr_trade(q: List[float], delta: List[float], b: float) -> Dict[str, Any]:
    q_before = list(q)
    q_after = [qk + (delta[i] if i < len(delta) else 0) for i, qk in enumerate(q)]
    payment = lmsr_cost(q_after, b) - lmsr_cost(q_before, b)
    return {"payment": payment, "q_after": q_after}


def bayesian_evidence_trade(p: List[float], p_yes: List[float], p_no: List[float], c: float, b: float, boost: float = 1.5) -> List[float]:
    # Boost p_yes for stronger evidence
    p_yes_boosted = [(boost * py) / (boost * py + (1 - py)) for py in p_yes]
    p_prime = [c * py + (1 - c) * pn for py, pn in zip(p_yes_boosted, p_no)]
    return [b * math.log((p_prime[i] + 1e-12) / (p[i] + 1e-12)) for i in range(len(p))]


def quote_api(val: float, q: List[float], b: float, buckets: List[Dict[str, Any]]):
    idx = quote_bucket(val, buckets)
    prices = lmsr_prices(q, b)
    pk = prices[idx]
    # Adjacent buckets
    low_idx = max(0, idx - 1)
    high_idx = min(len(buckets) - 1, idx + 1)
    payout_low = prices[low_idx]
    payout_high = prices[high_idx]
    return {
        "bucket": buckets[idx],
        "price": pk,
        "payouts": {
            "low": payout_low,
            "base": pk,
            "high": payout_high,
        },
    }
