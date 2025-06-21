# In-memory AMM state for each market (MVP, not persistent)
# Key: market_id, Value: dict with 'knots' (list of (x, q)), 'bankroll', 'b', etc.

from threading import Lock
import math

AMM_STATE = {}
AMM_LOCK = Lock()

# Default bankroll for new markets
DEFAULT_BANKROLL = 5000.0

def get_amm_state(market_id, N, min_val, max_val):
    """
    Retrieve or initialize the sparse AMM state for a market.
    N: number of knots/segments (initial grid)
    """
    with AMM_LOCK:
        if market_id not in AMM_STATE:
            # Initialize with uniform q so p_k = 1/N
            knots = []
            log_min = math.log(min_val)
            log_max = math.log(max_val)
            b = DEFAULT_BANKROLL / math.log(N)
            q0 = b * math.log(1.0 / N)
            for i in range(N):
                x = math.exp(log_min + (log_max - log_min) * i / (N-1))
                knots.append({'x': x, 'q': q0})
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

# Additional helpers for cost, price, trading can be added as needed
