from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from . import models
from .db import engine, SessionLocal
from .api import router

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Drop and recreate all tables for dev if using SQLite (force schema match)
import sqlalchemy
if str(engine.url).startswith('sqlite'):
    try:
        models.Base.metadata.drop_all(bind=engine)
    except Exception as e:
        print(f"Warning: drop_all failed: {e}")
models.Base.metadata.create_all(bind=engine)

# Seed a sample market if none exist
from .db import SessionLocal
from .models import Market, User

def seed_sample_data():
    from .api import get_password_hash
    db = SessionLocal()
    try:
        # Seed test user
        test_user = db.query(User).filter(User.username == "test").first()
        if not test_user:
            hashed = get_password_hash("test123")
            user = User(username="test", hashed_password=hashed, display_name="Test User", balance=1000)
            db.add(user)
            db.commit()
            db.refresh(user)
            print("\n\033[92m[Seeded test user]\033[0m Username: test  Password: test123\n")
        else:
            print("\n\033[93m[Test user already exists]\033[0m Username: test  Password: test123\n")

        # No sample market creation here. Markets should be created via API or frontend.
    finally:
        db.close()

seed_sample_data()

app.include_router(router)

# Global OPTIONS handler for CORS preflight
@app.options("/{rest_of_path:path}")
def preflight_handler(rest_of_path: str):
    from fastapi.responses import Response
    return Response(status_code=200)

@app.get("/", tags=["Health"])
async def read_root():
    return {"message": "Venture Prediction Market API is running"}

@app.get("/health", status_code=status.HTTP_200_OK, tags=["Health"])
async def health_check():
    """Health check endpoint for load balancers and monitoring."""
    try:
        # Test database connection
        db = SessionLocal()
        db.execute("SELECT 1")
        db.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unhealthy", "error": str(e)}
        )
