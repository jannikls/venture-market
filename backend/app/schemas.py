from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Any, Dict, Union
from datetime import datetime

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: str | None = None

class UserBase(BaseModel):
    username: str
    email: EmailStr | None = None
    display_name: str | None = None

class UserCreate(UserBase):
    password: str

class UserInDBBase(UserBase):
    id: int
    balance: float = 1000.0
    
    class Config:
        orm_mode = True

class UserRead(UserInDBBase):
    created_at: datetime
    class Config:
        orm_mode = True

class MarketBase(BaseModel):
    title: str
    description: Optional[str] = None
    outcome_type: str = Field(default="continuous")
    outcome_min: Optional[float] = None
    outcome_max: Optional[float] = None
    outcome_categories: Optional[List[str]] = None

class MarketCreate(MarketBase):
    pass

class MarketRead(MarketBase):
    id: int
    status: str
    created_at: datetime
    class Config:
        orm_mode = True

class BetBase(BaseModel):
    amount: float
    prediction: Dict[str, Any]

class BetCreate(BetBase):
    market_id: int
    user_id: int

class BetRead(BetBase):
    id: int
    market_id: int
    user_id: int
    placed_at: datetime
    class Config:
        orm_mode = True
