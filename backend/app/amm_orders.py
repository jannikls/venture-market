import math
from .lmsr_bid_ask import lmsr_cost_sparse

ORDER_BOOK = {}
DELTA_Q_MAX = 10.0  # max shares per fill

def place_order(market_id, bucket_idx, side, size, order_type, limit_price=None):
    """
    Place an order into the AMM-CLOB hybrid. Supports:
    - market: fill at next available ask (buy) or bid (sell)
    - limit: fill if price meets/exceeds limit, else queue (not implemented: persistent queue)
    Returns: {'filled': qty, 'avg_price': price, 'remaining': qty, 'status': ...}
    """
    # For MVP, only immediate-or-cancel logic (no persistent queue)
    state = ORDER_BOOK.get(market_id)
    if not state:
        return {'status': 'error', 'detail': 'No AMM state for market'}
    q = state['q']
    b = state['b']
    n = len(q)
    idx = bucket_idx
    filled = 0.0
    total_paid = 0.0
    size_left = size
    while size_left > 0:
        # Compute price for 1 share
        q_before = q[:]
        dq = min(size_left, DELTA_Q_MAX)
        if side == 'buy':
            q[idx] += dq
            price = lmsr_cost_sparse(q, b) - lmsr_cost_sparse(q_before, b)
        else:
            q[idx] -= dq
            price = lmsr_cost_sparse(q_before, b) - lmsr_cost_sparse(q, b)
        # Limit order logic
        if order_type == 'limit':
            if (side == 'buy' and price > limit_price) or (side == 'sell' and price < limit_price):
                break  # do not fill at worse price
        filled += dq
        total_paid += price
        size_left -= dq
    # Update state
    state['q'] = q
    return {
        'filled': filled,
        'avg_price': total_paid / filled if filled else 0.0,
        'remaining': size - filled,
        'status': 'filled' if filled == size else 'partial',
        'side': side,
        'bucket_idx': idx
    }

def set_amm_state(market_id, q, b):
    ORDER_BOOK[market_id] = {'q': q[:], 'b': b}

def get_amm_state(market_id):
    return ORDER_BOOK.get(market_id)
