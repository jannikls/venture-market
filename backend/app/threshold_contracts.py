# Utilities for threshold (above/below) contracts on continuous AMM
import math

def payoff_vector(knots, val, direction):
    """
    Construct payoff vector w: w_k = 1 for knots >= val (long/above), <= val (short/below), else 0.
    direction: 'long' or 'short'
    """
    x_list = [k['x'] for k in knots]
    if direction == 'long':
        return [1.0 if x >= val else 0.0 for x in x_list]
    else:
        return [1.0 if x <= val else 0.0 for x in x_list]

def price_per_contract(prices, w):
    """
    Instantaneous price per contract: p = sum(w_k * p_k)
    """
    return sum(wk * pk for wk, pk in zip(w, prices))
