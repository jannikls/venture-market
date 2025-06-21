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

# Bets
@router.post("/bets/", response_model=schemas.BetRead)
def place_bet(bet: schemas.BetCreate, db: Session = Depends(get_db)):
    db_bet = models.Bet(
        user_id=bet.user_id,
        market_id=bet.market_id,
        amount=bet.amount,
        prediction=bet.prediction,
    )
    db.add(db_bet)
    db.commit()
    db.refresh(db_bet)
    return db_bet

@router.get("/bets/", response_model=list[schemas.BetRead])
def list_bets(db: Session = Depends(get_db)):
    return db.query(models.Bet).all()
