import math
from app.amm_state import get_amm_state

def test_phantom_share_seeding_uniform():
    N = 5
    min_val = 1
    max_val = 100
    state = get_amm_state('test_market', N, min_val, max_val, prior=None)
    b = state['b']
    q = [k['q'] for k in state['knots']]
    # Uniform prior: p_k0 = 1/N, so q_k = b*ln(1/N)
    expected_q = b * math.log(1.0 / N)
    assert all(abs(qk - expected_q) < 1e-8 for qk in q)
    # Initial prices should be uniform
    expq = [math.exp(qk / b) for qk in q]
    prices = [e / sum(expq) for e in expq]
    for p in prices:
        assert abs(p - 1.0/N) < 1e-8

def test_phantom_share_seeding_custom_prior():
    N = 4
    min_val = 1
    max_val = 10
    # Prior: p_k0 = [0.1, 0.2, 0.3, 0.4]
    prior = [0.1, 0.2, 0.3, 0.4]
    state = get_amm_state('test_market2', N, min_val, max_val, prior=prior)
    b = state['b']
    q = [k['q'] for k in state['knots']]
    expq = [math.exp(qk / b) for qk in q]
    prices = [e / sum(expq) for e in expq]
    for p, pk0 in zip(prices, [0.1, 0.2, 0.3, 0.4]):
        assert abs(p - pk0) < 1e-8
