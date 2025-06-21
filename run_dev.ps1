# Windows PowerShell script to start the development environment

# Stop any existing Node.js and Python processes
Write-Host "Stopping any existing processes..." -ForegroundColor Yellow
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "python" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "python3" -Force -ErrorAction SilentlyContinue

# Function to check if a port is in use
function Test-PortInUse {
    param([int]$Port)
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $tcp.Connect("localhost", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# Function to wait for a service to be available
function Wait-ForService {
    param([int]$Port, [int]$MaxAttempts = 30)
    $attempt = 0
    Write-Host -NoNewline "Waiting for port $Port..."
    while ($attempt -lt $MaxAttempts) {
        if (Test-PortInUse -Port $Port) {
            Write-Host " OK" -ForegroundColor Green
            return $true
        }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
        $attempt++
    }
    Write-Host " FAILED" -ForegroundColor Red
    return $false
}

# Start backend
Write-Host "`nStarting backend server..." -ForegroundColor Green
$backendJob = Start-Process -NoNewWindow -FilePath "python" -ArgumentList "-m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" -PassThru -WorkingDirectory "$PWD\backend"

# Wait for backend to start
if (-not (Wait-ForService -Port 8000)) {
    Write-Host "Backend failed to start" -ForegroundColor Red
    Stop-Process -Id $backendJob.Id -Force
    exit 1
}

# Test backend health check
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get -ErrorAction Stop
    Write-Host "Backend health check: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "Backend health check failed" -ForegroundColor Red
    Stop-Process -Id $backendJob.Id -Force
    exit 1
}

# Start frontend in a new window
Write-Host "`nStarting frontend development server..." -ForegroundColor Green
$frontendJob = Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "start" -PassThru -WorkingDirectory "$PWD\frontend"

# Wait for frontend to start
if (-not (Wait-ForService -Port 3000)) {
    Write-Host "Frontend failed to start" -ForegroundColor Red
    Stop-Process -Id $backendJob.Id -Force
    Stop-Process -Id $frontendJob.Id -Force
    exit 1
}

# Test login
try {
    $body = @{
        username = "test"
        password = "test"
    }
    $response = Invoke-RestMethod -Uri "http://localhost:8000/token" -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"
    Write-Host "Login test successful" -ForegroundColor Green
} catch {
    Write-Host "Login test failed" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
    Stop-Process -Id $backendJob.Id -Force
    Stop-Process -Id $frontendJob.Id -Force
    exit 1
}

# Show success message
Write-Host "`n=== Development environment is ready! ===" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend API: http://localhost:8000" -ForegroundColor Cyan
Write-Host "`nPress Ctrl+C to stop all services" -ForegroundColor Yellow

# Keep the script running until Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    # Cleanup on exit
    Write-Host "`nStopping services..." -ForegroundColor Yellow
    Stop-Process -Id $backendJob.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue
}
