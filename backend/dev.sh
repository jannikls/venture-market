#!/bin/bash

# Start the backend server with Python 3
echo "Starting backend server..."
cd "$(dirname "$0")"
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
