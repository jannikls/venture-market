# Venture Outcome Prediction Market Backend

- **Framework:** FastAPI
- **Database:** PostgreSQL
- **ORM:** SQLAlchemy

## Setup
1. `python -m venv venv && source venv/bin/activate`
2. `pip install -r requirements.txt`
3. `uvicorn app.main:app --reload`

## AMM Phantom Share Seeding

- Each market is initialized with "phantom shares" in each valuation bucket: qₖ = b · ln(pₖ₀).
- The prior pₖ₀ should reflect conservative, data-driven beliefs (not arbitrary guesses). Uniform is only for testing; production should scrape comps or use an LLM for prior estimation.
- The initial AMM price for each bucket is exactly pₖ₀, and phantom shares are treated as real liability.
- The liquidity parameter b controls depth and slippage. Track P&L on seed capital; if losses exceed a threshold, automatically reduce b or pause trading.

## Price Smoothing

- The frontend displays λ-smoothed mid prices: p_display = λ·p_old + (1–λ)·p_new (default λ=0.8).
- This prevents wild swings in thin/ghost markets and provides stable quotes for users.

## Wallet & Risk Controls

- Wallet endpoints: `/wallet/balance`, `/faucet`, `/depositIntent`, `/withdraw`.
- Trades are only allowed if user has sufficient play-money balance.
- Per-trade exposure is capped (Δq_max, e.g. 0.2 share per order).
- User position limits and margin requirements are enforced.
- Circuit breakers: If LMSR price moves >20% in an hour, spreads widen and/or b is increased temporarily. Volatility tax fees may apply.

## Prior Calibration & Continuous Update

- Operators should recalibrate p₀ regularly (e.g. daily or every N trades) using new data and LLM/oracle estimates.
- When recalibrating, shift AMM q vector toward new p₀ with low weight (e.g. 10%) to avoid whipsawing.
- Never treat phantom shares as free money: if your prior is wrong, the system will lose until it is updated.

## Developer/Operator Notes

- Never use arbitrary or uniform priors in production. Always justify your p₀.
- Monitor AMM P&L and adjust b, p₀, or halt trading as needed.
- See `app/amm_state.py` and `app/api.py` for AMM logic and seeding.
- See `frontend/src/components/market/MarketDetail.js` for price smoothing logic.
- Run unit tests for all wallet and AMM operations before deploying changes.

## Structure
- `app/` — FastAPI app code
- `models.py` — SQLAlchemy models (no migrations unless requested)
- `schemas.py` — Pydantic schemas
- `main.py` — FastAPI entrypoint
