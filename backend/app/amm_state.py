# In-memory AMM state for each market (MVP, not persistent)
# Key: market_id, Value: dict with 'knots' (list of (x, q)), 'bankroll', 'b', etc.

from threading import Lock
import math

AMM_STATE = {}
AMM_LOCK = Lock()

# Default bankroll for new markets
DEFAULT_BANKROLL = 5000.0

def get_amm_state(market_id, N, min_val, max_val, prior=None):
    """
    Retrieve or initialize the sparse AMM state for a market.
    N: number of knots/segments (initial grid)
    prior: list or function returning prior probability p_k0 for each bucket (should sum to 1)
    """
    with AMM_LOCK:
        if market_id not in AMM_STATE:
            knots = []
            log_min = math.log(min_val)
            log_max = math.log(max_val)
            b = DEFAULT_BANKROLL / math.log(N)
            # Default prior: uniform
            if prior is None:
                p_k0 = [1.0/N] * N
            elif callable(prior):
                p_k0 = [prior(i, N, min_val, max_val) for i in range(N)]
                S = sum(p_k0)
                p_k0 = [pk/S for pk in p_k0]
            else:
                p_k0 = prior
                S = sum(p_k0)
                p_k0 = [pk/S for pk in p_k0]
            for i in range(N):
                x = math.exp(log_min + (log_max - log_min) * i / (N-1))
                qk = b * math.log(p_k0[i])
                knots.append({'x': x, 'q': qk})
            AMM_STATE[market_id] = {
                'knots': knots,
                'bankroll': DEFAULT_BANKROLL,
                'b': b,
                'min_val': min_val,
                'max_val': max_val
            }
        return AMM_STATE[market_id]

def insert_knot(state, x):
    """
    Insert a knot at x if not present, preserving order.
    """
    for knot in state['knots']:
        if abs(knot['x'] - x) < 1e-6:
            return  # Already present
    state['knots'].append({'x': x, 'q': 0.0})
    state['knots'].sort(key=lambda k: k['x'])
    # Recompute b
    N = len(state['knots'])
    state['b'] = state['bankroll'] / math.log(N)

# --- AMM Trading Math Helpers ---
def Z(q, b):
    try:
        exps = [math.exp(qk / b) for qk in q]
        z = sum(exps)
        if not math.isfinite(z) or z == 0:
            return float('inf')
        return z
    except OverflowError:
        return float('inf')

def C(q, b):
    z = Z(q, b)
    if z == float('inf') or z <= 0:
        return float('nan')
    return b * math.log(z)

def px(q, b):
    z = Z(q, b)
    if z == float('inf') or z == 0:
        return [0.0 for _ in q]
    return [math.exp(qk / b) / z for qk in q]

def ask(q, b, k, s):
    q_new = [qk + s if i == k else qk for i, qk in enumerate(q)]
    c_new = C(q_new, b)
    c_old = C(q, b)
    if math.isnan(c_new) or math.isnan(c_old):
        return float('nan')
    return c_new - c_old

def bid(q, b, k, s):
    q_new = [qk - s if i == k else qk for i, qk in enumerate(q)]
    c_new = C(q_new, b)
    c_old = C(q, b)
    if math.isnan(c_new) or math.isnan(c_old):
        return float('nan')
    return c_old - c_new

def get_quotes_for_bucket(state, k, size=1.0):
    q = [knot['q'] for knot in state['knots']]
    b = state['b']
    N = len(q)
    liquidity = b * math.log(N)
    try:
        mid = px(q, b)[k]
        ask_price = ask(q, b, k, size)
        bid_price = bid(q, b, k, size)
        # Guard against NaN/inf
        if not all(map(math.isfinite, [mid, ask_price, bid_price, liquidity])):
            return {'error': 'Bankroll exhausted or math error', 'bid': 0, 'mid': 0, 'ask': 0, 'liquidity': 0}
        return {
            'bid': round(bid_price, 6),
            'mid': round(mid, 6),
            'ask': round(ask_price, 6),
            'liquidity': round(liquidity, 2)
        }
    except Exception:
        return {'error': 'Bankroll exhausted or math error', 'bid': 0, 'mid': 0, 'ask': 0, 'liquidity': 0}
