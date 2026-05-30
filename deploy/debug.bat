@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

if /I "%~1"=="help" goto mode_help
if /I "%~1"=="--help" goto mode_help
if /I "%~1"=="/?" goto mode_help
if /I "%~1"=="docker" goto mode_docker
if /I "%~1"=="check" goto mode_check
if /I "%~1"=="local" goto mode_local
if not "%~1"=="" goto mode_unknown

goto mode_local

:mode_local
echo.
echo Nanato Studio local debug stack
echo Root: %ROOT%
echo.

call :ensure_backend_venv
if errorlevel 1 exit /b 1
call :start_backend
if errorlevel 1 exit /b 1
call :start_frontend
if errorlevel 1 exit /b 1

echo.
echo Debug stack requested.
echo.
echo Frontend:          http://127.0.0.1:4321/
echo Login:             http://127.0.0.1:4321/login/
echo Register:          http://127.0.0.1:4321/register/
echo Dashboard:         http://127.0.0.1:4321/dashboard/
echo Admin:             http://127.0.0.1:4321/admin/
echo Backend health:    http://127.0.0.1:8000/api/health
echo Backend challenge: http://127.0.0.1:8000/api/auth/challenge
echo.
echo Local default admin for debugging only: adm1n / adm1n
echo Change the default password after first login.
echo.
echo To verify auth endpoints:
echo   deploy\debug.bat check
echo.
echo If a service was started by this helper, logs are written to:
echo   tmp-debug-backend.out.log / tmp-debug-backend.err.log
echo   tmp-debug-frontend.out.log / tmp-debug-frontend.err.log
echo.
echo Opening:          http://127.0.0.1:4321/
start "" "http://127.0.0.1:4321/"
exit /b 0

:mode_docker
echo.
echo Nanato Studio production-like local deployment
echo Root: %ROOT%
echo URL:  http://localhost:8080/
echo API:  http://localhost:8080/api/health
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo ERROR: Docker was not found on PATH.
  echo Install/start Docker Desktop, or run non-Docker local debug mode:
  echo   deploy\debug.bat
  exit /b 1
)

docker compose version >nul 2>nul
if errorlevel 1 (
  echo ERROR: Docker Compose is not available.
  echo Try updating Docker Desktop, or run:
  echo   docker compose version
  exit /b 1
)

docker compose -f "%ROOT%\deploy\docker-compose.yml" up --build
exit /b %errorlevel%

:mode_check
echo.
echo Checking Nanato Studio local auth endpoints...
echo.

if not exist "%ROOT%\scripts\check-auth.ps1" goto mode_check_fallback

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\check-auth.ps1"
exit /b %errorlevel%

:mode_check_fallback
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 3 | Out-Null; Write-Host 'PASS backend health'; } catch { Write-Host 'FAIL backend health'; Write-Host 'Start backend with: cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000'; exit 1 }; try { Invoke-RestMethod 'http://127.0.0.1:8000/api/auth/challenge?purpose=login' -TimeoutSec 3 | Out-Null; Write-Host 'PASS auth challenge'; } catch { Write-Host 'FAIL auth challenge'; exit 1 }"
exit /b %errorlevel%

:ensure_backend_venv
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
  echo Backend venv found.
  exit /b 0
)

echo Backend venv not found. Creating backend\.venv...
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m venv "%ROOT%\backend\.venv"
  if not errorlevel 1 goto :install_backend_requirements
)

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python was not found on PATH.
  echo Install Python, then rerun:
  echo   deploy\debug.bat
  exit /b 1
)

python -m venv "%ROOT%\backend\.venv"
if errorlevel 1 (
  echo ERROR: Failed to create backend virtual environment.
  exit /b 1
)

:install_backend_requirements
echo Installing backend requirements...
"%ROOT%\backend\.venv\Scripts\python.exe" -m pip install -r "%ROOT%\backend\requirements.txt"
if errorlevel 1 (
  echo ERROR: Failed to install backend requirements.
  exit /b 1
)

exit /b 0

:start_backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Backend already reachable on http://127.0.0.1:8000.
  exit /b 0
)

echo Starting FastAPI backend in the background...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$out = '%ROOT%\tmp-debug-backend.out.log'; $err = '%ROOT%\tmp-debug-backend.err.log'; Start-Process -FilePath '%ROOT%\backend\.venv\Scripts\python.exe' -ArgumentList @('-m','uvicorn','app.main:app','--reload','--host','127.0.0.1','--port','8000') -WorkingDirectory '%ROOT%\backend' -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden"
if errorlevel 1 (
  echo ERROR: Failed to start FastAPI backend.
  exit /b 1
)

call :wait_backend
if errorlevel 1 (
  echo ERROR: FastAPI backend did not become reachable on http://127.0.0.1:8000.
  echo Backend logs:
  echo   %ROOT%\tmp-debug-backend.out.log
  echo   %ROOT%\tmp-debug-backend.err.log
  exit /b 1
)

echo Backend started on http://127.0.0.1:8000.
echo Backend logs:
echo   %ROOT%\tmp-debug-backend.out.log
echo   %ROOT%\tmp-debug-backend.err.log
exit /b 0

:start_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest 'http://127.0.0.1:4321/' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Frontend already reachable on http://127.0.0.1:4321.
  exit /b 0
)

echo Starting Astro frontend in the background...
where npm >nul 2>nul
if not errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$out = '%ROOT%\tmp-debug-frontend.out.log'; $err = '%ROOT%\tmp-debug-frontend.err.log'; Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/s','/c','npm run dev -- --host 127.0.0.1 --port 4321') -WorkingDirectory '%ROOT%' -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden"
  if errorlevel 1 (
    echo ERROR: Failed to start Astro frontend.
    exit /b 1
  )
  goto wait_frontend_after_start
)

if exist "%ROOT%\.tools\npm\package\bin\npm-cli.js" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$out = '%ROOT%\tmp-debug-frontend.out.log'; $err = '%ROOT%\tmp-debug-frontend.err.log'; Start-Process -FilePath 'node' -ArgumentList @('.tools\npm\package\bin\npm-cli.js','run','dev','--','--host','127.0.0.1','--port','4321') -WorkingDirectory '%ROOT%' -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden"
  if errorlevel 1 (
    echo ERROR: Failed to start Astro frontend.
    exit /b 1
  )
  goto wait_frontend_after_start
)

echo ERROR: npm was not found, and the bundled npm fallback is missing.
echo Install Node.js/npm, then rerun:
echo   deploy\debug.bat
exit /b 1

:wait_frontend_after_start
call :wait_frontend
if errorlevel 1 (
  echo ERROR: Astro frontend did not become reachable on http://127.0.0.1:4321.
  echo Frontend logs:
  echo   %ROOT%\tmp-debug-frontend.out.log
  echo   %ROOT%\tmp-debug-frontend.err.log
  exit /b 1
)

echo Frontend started on http://127.0.0.1:4321.
echo Frontend logs:
echo   %ROOT%\tmp-debug-frontend.out.log
echo   %ROOT%\tmp-debug-frontend.err.log
exit /b 0

:wait_backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(20); do { try { Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"
exit /b %errorlevel%

:wait_frontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(30); do { try { Invoke-WebRequest 'http://127.0.0.1:4321/' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"
exit /b %errorlevel%

:mode_unknown
echo ERROR: Unknown mode "%~1".
echo.
call :mode_help
exit /b 1

:mode_help
echo Nanato Studio debug deployment helper
echo.
echo Usage:
echo   deploy\debug.bat          Start local debug stack: FastAPI + Astro dev
echo   deploy\debug.bat local    Same as default
echo   deploy\debug.bat check    Check backend health and auth challenge
echo   deploy\debug.bat docker   Build/run production-like local Docker stack
echo   deploy\debug.bat help     Show this help
echo.
echo Local debug URLs:
echo   Frontend: http://127.0.0.1:4321/
echo   Login:    http://127.0.0.1:4321/login/
echo   Backend:  http://127.0.0.1:8000/api/health
echo.
echo Docker URL:
echo   http://localhost:8080/
echo.
exit /b 0
