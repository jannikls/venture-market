# Venture Outcome Prediction Market Backend

- **Framework:** FastAPI
- **Database:** PostgreSQL
- **ORM:** SQLAlchemy

## Setup
1. `python -m venv venv && source venv/bin/activate`
2. `pip install -r requirements.txt`
3. `uvicorn app.main:app --reload`

## Structure
- `app/` — FastAPI app code
- `models.py` — SQLAlchemy models (no migrations unless requested)
- `schemas.py` — Pydantic schemas
- `main.py` — FastAPI entrypoint
