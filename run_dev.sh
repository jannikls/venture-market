#!/bin/bash
set -e  # Exit on error

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill processes in reverse order of starting
    if [ -n "$FRONTEND_PID" ]; then
        echo "Stopping frontend (PID: $FRONTEND_PID)"
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    if [ -n "$BACKEND_PID" ]; then
        echo "Stopping backend (PID: $BACKEND_PID)"
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    # Clean up any remaining node processes that might have been started
    pkill -f "npm start" 2>/dev/null || true
    pkill -f "node.*start" 2>/dev/null || true
    
    echo -e "${GREEN}Cleanup complete.${NC}" 
    exit 0
}

# Set up trap to call cleanup function on script exit
trap cleanup EXIT INT TERM

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print section headers
section() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to kill processes on a specific port
kill_on_port() {
    local port=$1
    if command_exists lsof; then
        local pid=$(lsof -ti :$port)
        if [ -n "$pid" ]; then
            echo "Killing process on port $port..."
            kill -9 $pid 2>/dev/null || true
        fi
    fi
}

# Function to check if a port is in use
is_port_in_use() {
    local port=$1
    if command_exists lsof; then
        lsof -i :$port >/dev/null 2>&1
        return $?
    fi
    return 1
}

# Function to wait for a service to be available
wait_for_service() {
    local host=$1
    local port=$2
    local max_attempts=30
    local attempt=0
    
    echo -n "Waiting for $host:$port..."
    until nc -z $host $port; do
        if [ $attempt -ge $max_attempts ]; then
            echo "\n${RED}ERROR: Service at $host:$port did not become available${NC}"
            exit 1
        fi
        echo -n "."
        sleep 1
        attempt=$((attempt+1))
    done
    echo -e " ${GREEN}OK${NC}"
}

# Main script starts here
echo -e "${GREEN}=== Starting Development Environment ===${NC}"

# Kill any existing processes
echo "Stopping any existing processes..."
kill_on_port 3000  # Frontend
kill_on_port 8000  # Backend

# Start backend in background
section "Starting Backend Server"

echo -e "${GREEN}Starting backend server...${NC}"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is required but not installed.${NC}"
    exit 1
fi

# Check if required Python packages are installed
if ! python3 -c "import uvicorn, fastapi, sqlalchemy" &> /dev/null; then
    echo -e "${YELLOW}Installing required Python packages...${NC}"
    pip install -r "$PROJECT_ROOT/backend/requirements.txt" || {
        echo -e "${RED}Failed to install Python dependencies.${NC}"
        exit 1
    }
fi

# Get the absolute path of the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$SCRIPT_DIR"
cd "$PROJECT_ROOT"

echo -e "${BLUE}Project root: $PROJECT_ROOT${NC}"

# Verify required directories exist
if [ ! -d "$PROJECT_ROOT/backend" ] || [ ! -d "$PROJECT_ROOT/frontend" ]; then
    echo -e "${RED}Error: Could not find required directories.${NC}"
    echo "Make sure you're running this script from the project root."
    echo "Expected to find:"
    echo "  - $PROJECT_ROOT/backend"
    echo "  - $PROJECT_ROOT/frontend"
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_ROOT/logs"
BACKEND_LOG="$PROJECT_ROOT/logs/backend.log"
echo "Backend logs will be written to: $BACKEND_LOG"
cd "$PROJECT_ROOT/backend"
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > "$PROJECT_ROOT/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend to start
wait_for_service localhost 8000

# Run health check
echo -e "\n${GREEN}Running health check...${NC}"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:8000/health)
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | sed '$d')

if [ "$HEALTH_STATUS" != "200" ]; then
    echo -e "${RED}Backend health check failed with status $HEALTH_STATUS${NC}"
    echo "Response: $HEALTH_BODY"
    echo "Check backend.log for details"
    if [ -f "$PROJECT_ROOT/backend.log" ]; then
        echo -e "\n=== Last 20 lines of backend.log ==="
        tail -n 20 "$PROJECT_ROOT/backend.log"
    fi
    kill $BACKEND_PID 2>/dev/null
    exit 1
else
    echo -e "${GREEN}✓ Backend health check passed${NC}"
    echo "Status: $HEALTH_STATUS"
    echo "Response: $HEALTH_BODY"
fi

# Start frontend in a new terminal window
section "Starting Frontend Development Server"

echo -e "${GREEN}Setting up frontend...${NC}"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
cd "$FRONTEND_DIR"

# Check if Node.js and npm are installed
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: Node.js and npm are required but not installed.${NC}"
    exit 1
fi

# Install frontend dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install || {
        echo -e "${RED}Failed to install frontend dependencies.${NC}"
        exit 1
    }
fi
if [ "$(uname)" == "Darwin" ]; then
    # macOS - warn if path contains spaces and print manual instructions
    if [[ "$PWD" == *" "* ]]; then
        echo -e "${YELLOW}Warning: Your project path contains spaces, which breaks automatic frontend launch on macOS.${NC}"
        echo -e "Please open a new terminal and run the following commands manually:"
        echo -e "\n  cd '$PWD'"
        echo -e "  npm start\n"
    else
        osascript -e 'tell app "Terminal" to do script "cd '"'"'"$PWD"'"'"' && npm start"'
    fi
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    # Linux
    x-terminal-emulator -e "bash -c 'cd \"$(pwd)\" && npm start; read -p \"Press enter to exit\"'"
else
    # Windows (Git Bash)
    start "" "npm start"
fi

# Wait for frontend to start
wait_for_service localhost 3000

# Run login test
section "Running Login Test"

echo -e "${GREEN}Testing login with test credentials...${NC}"
echo "Username: test"
echo "Password: test"
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:8000/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=test&password=test" 2>/dev/null)

if [[ $LOGIN_RESPONSE == *"access_token"* ]]; then
    echo -e "${GREEN}✓ Login test successful${NC}
"
    section "Development Environment Ready"
    echo -e "${GREEN}✓ Development environment is ready!${NC}"
    echo -e "\n${BLUE}Access URLs:${NC}"
    echo -e "Frontend:    ${GREEN}http://localhost:3000${NC}"
    echo -e "Backend API: ${GREEN}http://localhost:8000${NC}"
    echo -e "\n${BLUE}Logs:${NC}"
    echo -e "Backend:  ${GREEN}$BACKEND_LOG${NC}"
    echo -e "Frontend: ${GREEN}$PROJECT_ROOT/frontend/npm-debug.log${NC} (if any errors occur)"
else
    echo -e "${RED}✗ Login test failed${NC}"
    echo "Response: $LOGIN_RESPONSE"
    echo -e "\n${RED}=== Startup failed ===${NC}"
    kill $BACKEND_PID
    exit 1
fi

# Keep script running
wait $BACKEND_PID
