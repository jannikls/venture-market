from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from . import models, schemas
from .db import get_db

# Security configuration
SECRET_KEY = "your-secret-key-here"  # In production, use environment variables
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def get_user(db, username: str):
    return db.query(models.User).filter(models.User.username == username).first()

def authenticate_user(db, username: str, password: str):
    user = get_user(db, username)
    if not user or not verify_password(password, user.hashed_password):
        return False
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = schemas.TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(db, username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

router = APIRouter()

# Auth endpoints
@router.post("/token", response_model=schemas.Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# Users
@router.post("/users/", response_model=schemas.UserRead)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        username=user.username,
        display_name=user.display_name or user.username,
        hashed_password=hashed_password,
        balance=1000  # Starting balance in fake money
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.get("/users/me", response_model=schemas.UserRead)
async def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user

# Markets
@router.post("/markets/", response_model=schemas.MarketRead)
def create_market(
    market: schemas.MarketCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_market = models.Market(
        title=market.title,
        description=market.description,
        outcome_type=market.outcome_type,
        outcome_min=market.outcome_min,
        outcome_max=market.outcome_max,
        outcome_categories=market.outcome_categories,
        creator_id=current_user.id
    )
    db.add(db_market)
    db.commit()
    db.refresh(db_market)
    return db_market

@router.get("/markets/", response_model=list[schemas.MarketRead])
def list_markets(db: Session = Depends(get_db)):
    return db.query(models.Market).all()

@router.get("/markets/{market_id}")
def get_market_detail(market_id: int, db: Session = Depends(get_db)):
    market = db.query(models.Market).filter(models.Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    
    # Ensure required fields have defaults
    if market.outcome_min is None:
        market.outcome_min = 5e6
    if market.outcome_max is None:
        market.outcome_max = 1e12
    if not getattr(market, "status", None):
        market.status = "open"
    if not getattr(market, "created_at", None):
        from datetime import datetime
        market.created_at = datetime.utcnow()
    
    # Initialize AMM state if it doesn't exist
    try:
        from .amm_state import get_amm_state
        min_val = market.outcome_min or 5e6
        max_val = market.outcome_max or 1e12
        get_amm_state(market_id, N=21, min_val=min_val, max_val=max_val, prior=None)
    except Exception as e:
        print(f"Warning: Could not initialize AMM state: {e}")
    
    # Calculate liquidity and traders
    bets = db.query(models.Bet).filter(models.Bet.market_id == market_id).all()
    liquidity = sum(bet.amount for bet in bets)
    traders = len(set(bet.user_id for bet in bets))
    
    # Return market fields plus liquidity and traders
    market_data = {
        **schemas.MarketRead.from_orm(market).dict(),
        "liquidity": liquidity,
        "traders": traders
    }
    return market_data

# --- QUOTE API ---
from . import lmsr
from .amm_state import get_amm_state, insert_knot, get_quotes_for_bucket, px
from .threshold_contracts import payoff_vector, price_per_contract
from .implied_distribution import lmsr_lognormal_pareto
from .lmsr_bid_ask import lmsr_bid_ask
from .amm_orders import place_order, set_amm_state
import math

@router.get("/markets/{market_id}/bid_ask")
def get_market_bid_ask(market_id: int, db: Session = Depends(get_db)):
    """
    Returns for each knot: value, mid, bid, ask, liquidity using AMM helpers. Robust to overflow/NaN.
    """
    market = db.query(models.Market).filter(models.Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    min_val = market.outcome_min or 5e6
    max_val = market.outcome_max or 1e12
    N = 21
    try:
        state = get_amm_state(market_id, N, min_val, max_val)
        knots = state['knots']
        result = []
        for i, k in enumerate(knots):
            quote = get_quotes_for_bucket(state, i, size=1.0)
            result.append({
                'value': k['x'],
                'mid': quote.get('mid', 0.0),
                'bid': quote.get('bid', 0.0),
                'ask': quote.get('ask', 0.0),
                'liquidity': quote.get('liquidity', 0.0),
                'error': quote.get('error', None)
            })
        return result
    except Exception as e:
        print(f"Error in get_market_bid_ask: {e}")
        return [{
            'value': 0.0,
            'mid': 0.0,
            'bid': 0.0,
            'ask': 0.0,
            'liquidity': 0.0,
            'error': str(e)
        }]

from fastapi import Body

@router.post("/markets/{market_id}/order")
def place_market_order(
    market_id: int,
    bucket_idx: int = Body(...),
    side: str = Body(...),
    size: float = Body(...),
    order_type: str = Body(...),
    limit_price: float = Body(None)
):
    """
    Place a market or limit order at a specific bucket (valuation index).
    """
    result = place_order(market_id, bucket_idx, side, size, order_type, limit_price)
    return result

@router.get("/markets/{market_id}/quote")
def get_market_quote(market_id: int, val: float, db: Session = Depends(get_db)):
    # --- CONTINUOUS AMM LOGIC ---
    market = db.query(models.Market).filter(models.Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    min_val = market.outcome_min or 5e6
    max_val = market.outcome_max or lmsr.LOG_BUCKET_MAX
    N = 21
    state = get_amm_state(market_id, N, min_val, max_val)
    insert_knot(state, val)
    knots = state['knots']
    b = state['b']
    q = [k['q'] for k in knots]
    prices = lmsr_prices_sparse(q, b)
    pk = prices[idx]
    low_idx = max(0, idx - 1)
    high_idx = min(len(knots) - 1, idx + 1)
    payout_low = prices[low_idx]
    payout_high = prices[high_idx]
    return {
        'knot': knots[idx],
        'price': pk,
        'payouts': {
            'low': payout_low,
            'base': pk,
            'high': payout_high,
        },
        'b': b,
        'N': len(knots)
    }

@router.get("/markets/{market_id}/amm_state")
def get_market_amm_state(market_id: int):
    from .amm_state import get_amm_state
    # Use default grid for now
    N = 21
    min_val = 5e6
    max_val = 1e12
    state = get_amm_state(market_id, N, min_val, max_val, prior=None)
    q = [k['q'] for k in state['knots']]
    b = state['b']
    return {'q': q, 'b': b}

# Unified quote_and_trade endpoint for threshold contracts
from fastapi import Body
from datetime import datetime

from .play_wallet import PlayWallet
from decimal import Decimal
import time
from fastapi import Query

FAUCET_LIMIT = 1000  # Max faucet per call
FAUCET_INTERVAL = 60  # seconds between allowed faucet requests per user
faucet_last = {}  # {user_id: last_request_time}

@router.get("/wallet/balance")
def get_wallet_balance(user_id: int = Query(...), db: Session = Depends(get_db)):
    wallet = PlayWallet()
    bal = wallet.get_balance(db, str(user_id))
    return {"user_id": user_id, "balance": float(bal)}

@router.get("/faucet")
def faucet(user_id: int = Query(...), amt: float = Query(...), db: Session = Depends(get_db)):
    now = time.time()
    last = faucet_last.get(user_id, 0)
    if now - last < FAUCET_INTERVAL:
        raise HTTPException(status_code=429, detail=f"Faucet cooldown: wait {int(FAUCET_INTERVAL - (now - last))}s")
    if amt > FAUCET_LIMIT:
        raise HTTPException(status_code=400, detail=f"Max faucet per call: {FAUCET_LIMIT}")
    wallet = PlayWallet()
    wallet.credit(db, str(user_id), Decimal(str(amt)), ref="faucet")
    faucet_last[user_id] = now
    return {"user_id": user_id, "credited": amt}

@router.post("/depositIntent")
def deposit_intent(user_id: int = Body(...), db: Session = Depends(get_db)):
    # Stub: return dummy on-chain address
    return {"user_id": user_id, "deposit_address": f"0xDUMMY{user_id:04d}"}

@router.post("/withdraw")
def withdraw(user_id: int = Body(...), amt: float = Body(...), db: Session = Depends(get_db)):
    wallet = PlayWallet()
    try:
        wallet.debit(db, str(user_id), Decimal(str(amt)), ref="withdraw")
        # Log intent only, no real transfer
        return {"user_id": user_id, "withdrawn": amt, "status": "intent logged"}
    except Exception as e:
        raise HTTPException(status_code=402, detail=f"Insufficient balance: {e}")

@router.post("/markets/{market_id}/quote_and_trade")
def quote_and_trade(
    market_id: int,
    val: float = Body(...),
    dir: str = Body(...),
    n: float = Body(...),
    T: str = Body(...),
    user_id: int = Body(...),
    execute: bool = Body(False),
    db: Session = Depends(get_db),
):
    # Lookup market and AMM state
    market = db.query(models.Market).filter(models.Market.id == market_id).first()
    if not market:
        raise HTTPException(status_code=404, detail="Market not found")
    min_val = market.outcome_min or 5e6
    max_val = market.outcome_max or 1e12
    N = 21
    state = get_amm_state(market_id, N, min_val, max_val)
    insert_knot(state, val)
    knots = state['knots']
    b = state['b']
    q = [k['q'] for k in knots]
    # Find bucket index for val
    k = next((i for i, knot in enumerate(knots) if abs(knot['x'] - val) < 1e-6), None)
    if k is None:
        raise HTTPException(status_code=400, detail="Could not find or insert bucket for valuation")
    # Get quote for this bucket
    quote = get_quotes_for_bucket(state, k, size=n)
    # If math error, return error
    if 'error' in quote and quote['error']:
        return {"error": quote['error'], "bid": 0, "mid": 0, "ask": 0, "liquidity": 0}
    # Quote only (no trade)
    if not execute:
        return {
            "bid": quote['bid'],
            "mid": quote['mid'],
            "ask": quote['ask'],
            "liquidity": quote['liquidity'],
            "bucket": k
        }
    # Trade: update q and wallet
    q_before = q[:]
    # For this MVP, buy = ask, sell = bid, size = n
    if dir == 'buy':
        q_after = [qk + (n if i == k else 0) for i, qk in enumerate(q)]
        payment = quote['ask']
    elif dir == 'sell':
        q_after = [qk - (n if i == k else 0) for i, qk in enumerate(q)]
        payment = quote['bid']
    else:
        raise HTTPException(status_code=400, detail="Invalid direction (must be 'buy' or 'sell')")
    # Wallet settlement: debit user for payment, log tx
    wallet = PlayWallet()
    try:
        wallet.debit(db, str(user_id), Decimal(str(payment)), ref=f"market:{market_id}|trade:{val}|{dir}|{n}")
    except Exception as e:
        raise HTTPException(status_code=402, detail=f"Insufficient balance: {e}")
    # Update AMM state
    for i in range(len(knots)):
        knots[i]['q'] = q_after[i]
    # Store contract as Bet
    db_bet = models.Bet(
        user_id=user_id,
        market_id=market_id,
        amount=n,
        prediction={"val": val, "dir": dir, "expiry": T},
        placed_at=datetime.utcnow()
    )
    db.add(db_bet)
    db.commit()
    db.refresh(db_bet)
    return {
        "bid": quote['bid'],
        "mid": quote['mid'],
        "ask": quote['ask'],
        "liquidity": quote['liquidity'],
        "bucket": k,
        "payment": float(payment),
        "bet_id": db_bet.id
    }

@router.get("/bets/", response_model=list[schemas.BetRead])
def list_bets(db: Session = Depends(get_db)):
    return db.query(models.Bet).all()

# Leaderboard (P&L)
@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    starting_balance = 1000.0
    ranked = [
        {
            "username": u.username,
            "display_name": u.display_name,
            "balance": u.balance,
            "pnl": u.balance - starting_balance,
        }
        for u in users
    ]
    ranked = sorted(ranked, key=lambda x: x["pnl"], reverse=True)
    return ranked
