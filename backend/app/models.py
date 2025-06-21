from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, JSON, Enum, Boolean
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func
import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=False)
    display_name = Column(String)
    balance = Column(Float, default=1000.0)  # Starting balance in fake money
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    markets = relationship("Market", back_populates="creator")
    bets = relationship("Bet", back_populates="user")

class Market(Base):
    __tablename__ = 'markets'
    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    description = Column(String)
    status = Column(String, default='open')  # open, closed, resolved
    outcome_type = Column(String, default='continuous')  # continuous, binary, categorical
    outcome_min = Column(Float, nullable=True)  # For continuous
    outcome_max = Column(Float, nullable=True)  # For continuous
    outcome_categories = Column(JSON, nullable=True)  # For categorical
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    creator = relationship("User", back_populates="markets")
    bets = relationship('Bet', back_populates='market')

class Bet(Base):
    __tablename__ = 'bets'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    market_id = Column(Integer, ForeignKey('markets.id'))
    amount = Column(Float, nullable=False)
    prediction = Column(JSON, nullable=False)  # e.g., {"prob": 0.7} or {"distribution": {...}}
    placed_at = Column(DateTime, default=datetime.datetime.utcnow)
    user = relationship('User', back_populates='bets')
    market = relationship('Market', back_populates='bets')
