import math

def lmsr_cost_sparse(q, b):
    max_q = max(q)
    sum_exp = sum(math.exp((qk - max_q) / b) for qk in q)
    return b * (math.log(sum_exp) + max_q / b)

def lmsr_prices_sparse(q, b):
    max_q = max(q)
    exp_q = [math.exp((qk - max_q) / b) for qk in q]
    sum_exp = sum(exp_q)
    return [e / sum_exp for e in exp_q]

def lmsr_bid_ask(q, b):
    """
    For each bucket k, compute mid, bid, ask prices.
    mid_k = p_k(q)
    ask_k = C(q + e_k) - C(q)
    bid_k = C(q) - C(q - e_k)
    Returns list of dicts: [{mid, bid, ask}, ...]
    """
    n = len(q)
    mids = lmsr_prices_sparse(q, b)
    bids = []
    asks = []
    for k in range(n):
        q_plus = q[:]
        q_plus[k] += 1.0
        q_minus = q[:]
        q_minus[k] -= 1.0
        ask = lmsr_cost_sparse(q_plus, b) - lmsr_cost_sparse(q, b)
        bid = lmsr_cost_sparse(q, b) - lmsr_cost_sparse(q_minus, b)
        asks.append(ask)
        bids.append(bid)
    return [{'mid': mids[k], 'bid': bids[k], 'ask': asks[k]} for k in range(n)]
