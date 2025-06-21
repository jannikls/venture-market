from decimal import Decimal, ROUND_DOWN, getcontext
from sqlalchemy import Column, String, DECIMAL, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from datetime import datetime
from .models import Base
import uuid

getcontext().prec = 38

class Wallet:
    def get_balance(self, db: Session, user_id: str) -> Decimal:
        raise NotImplementedError
    def credit(self, db: Session, user_id: str, amt: Decimal, ref: str) -> None:
        raise NotImplementedError
    def debit(self, db: Session, user_id: str, amt: Decimal, ref: str) -> None:
        raise NotImplementedError
    def transfer(self, db: Session, from_id: str, to_id: str, amt: Decimal, ref: str) -> None:
        raise NotImplementedError

class PlayWallet(Wallet):
    def get_balance(self, db: Session, user_id: str) -> Decimal:
        bal = db.query(Balance).filter(Balance.user_id == user_id).first()
        return bal.balance if bal else Decimal('0.0')

    def credit(self, db: Session, user_id: str, amt: Decimal, ref: str) -> None:
        with db.begin():
            bal = db.query(Balance).filter(Balance.user_id == user_id).with_for_update().first()
            if not bal:
                bal = Balance(user_id=user_id, balance=Decimal('0.0'))
                db.add(bal)
            bal.balance = (Decimal(bal.balance) + amt).quantize(Decimal('0.000001'), rounding=ROUND_DOWN)
            tx = TxLog(ts=datetime.utcnow(), from_id=None, to_id=user_id, amt=amt, ref=ref)
            db.add(tx)

    def debit(self, db: Session, user_id: str, amt: Decimal, ref: str) -> None:
        with db.begin():
            bal = db.query(Balance).filter(Balance.user_id == user_id).with_for_update().first()
            if not bal or Decimal(bal.balance) < amt:
                raise Exception('Insufficient balance')
            bal.balance = (Decimal(bal.balance) - amt).quantize(Decimal('0.000001'), rounding=ROUND_DOWN)
            tx = TxLog(ts=datetime.utcnow(), from_id=user_id, to_id=None, amt=amt, ref=ref)
            db.add(tx)

    def transfer(self, db: Session, from_id: str, to_id: str, amt: Decimal, ref: str) -> None:
        with db.begin():
            self.debit(db, from_id, amt, ref)
            self.credit(db, to_id, amt, ref)

class Balance(Base):
    __tablename__ = 'balances'
    user_id = Column(String, primary_key=True)
    balance = Column(DECIMAL(38,6), nullable=False, default=Decimal('0.0'))

class TxLog(Base):
    __tablename__ = 'tx_log'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    ts = Column(DateTime, default=datetime.utcnow)
    from_id = Column(String, nullable=True)
    to_id = Column(String, nullable=True)
    amt = Column(DECIMAL(38,6), nullable=False)
    ref = Column(String, nullable=False)
