from decimal import Decimal
from app.play_wallet import PlayWallet
from app.models import User
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base
import tempfile
import os
import pytest

@pytest.fixture(scope="function")
def session():
    db_fd, db_path = tempfile.mkstemp()
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    sess = Session()
    yield sess
    sess.close()
    os.close(db_fd)
    os.unlink(db_path)

def test_wallet_credit_debit(session):
    wallet = PlayWallet()
    # Create a user
    user = User(username="alice", email="alice@example.com", hashed_password="x")
    session.add(user)
    session.commit()
    user_id = str(user.id)
    # Credit
    wallet.credit(session, user_id, Decimal("100.0"), ref="test-credit")
    bal = wallet.get_balance(session, user_id)
    assert bal == Decimal("100.0")
    # Debit
    wallet.debit(session, user_id, Decimal("30.0"), ref="test-debit")
    bal2 = wallet.get_balance(session, user_id)
    assert bal2 == Decimal("70.0")
    # Overdraft
    with pytest.raises(Exception):
        wallet.debit(session, user_id, Decimal("100.0"), ref="fail")
