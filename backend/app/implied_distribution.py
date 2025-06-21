import math
from scipy.stats import norm

def lmsr_lognormal_pareto(p, knots, K, delta=0.3):
    """
    Given LMSR probabilities p and knot values knots (dicts with 'x'), fit log-normal to body and Pareto to tail.
    Returns dict with: base, low, high scenario probabilities for threshold K (P(V≥K)).
    Implements correct hybrid CDF per user spec.
    """
    x = [math.log10(k['x']) for k in knots]
    cdf = []
    s = 0.0
    for pk in p:
        s += pk
        cdf.append(s)
    # Find tau: smallest idx where tail mass < 10%
    tail_mass = 0.0
    tau = len(p) - 1
    for i in reversed(range(len(p))):
        tail_mass += p[i]
        if tail_mass > 0.10:
            tau = i
            break
    # Log-normal fit to body (x < x_tau)
    p_body = p[:tau+1]
    x_body = x[:tau+1]
    Z = sum(p_body)
    mu = sum(pk * xk for pk, xk in zip(p_body, x_body)) / Z
    mu2 = sum(pk * xk**2 for pk, xk in zip(p_body, x_body)) / Z
    sigma2 = mu2 - mu**2
    sigma = math.sqrt(max(sigma2, 1e-8))
    # Pareto fit to tail (x >= x_tau)
    p_tail = p[tau:]
    x_tail = x[tau:]
    Z_tail = sum(p_tail)
    x_tau = x[tau] if len(x) > tau else x[-1]
    if Z_tail > 0 and len(x_tail) > 1:
        denom = sum(pk * (xk - x_tau) for pk, xk in zip(p_tail, x_tail) if xk > x_tau)
        alpha_base = Z_tail / denom if denom > 0 else 2.0
    else:
        alpha_base = 2.0
    S_tau = 1.0 - cdf[tau]
    # Normalized log-normal CDF over body
    def F_LN(xK):
        if sigma < 1e-8:
            return 1.0 if xK > mu else 0.0
        # CDF of log-normal body, normalized to [0, x_tau]
        raw = norm.cdf((xK - mu) / sigma)
        norm_factor = norm.cdf((x_tau - mu) / sigma)
        return min(max(raw / (norm_factor if norm_factor > 0 else 1.0), 0.0), 1.0)
    def hybrid_prob(xK, alpha):
        if xK < x_tau:
            return 1.0 - F_LN(xK) * (1 - S_tau) + S_tau
        else:
            return S_tau * 10 ** (-alpha * (xK - x_tau))
    xK = math.log10(K)
    # Scenario probabilities
    base = hybrid_prob(xK, alpha_base)
    low = hybrid_prob(xK, alpha_base - delta)
    high = hybrid_prob(xK, alpha_base + delta)
    return {'base': base, 'low': low, 'high': high, 'mu': mu, 'sigma': sigma, 'alpha_base': alpha_base, 'tau': x_tau}
