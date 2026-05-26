# Nanato Studio Backend

FastAPI backend for local Nanato Studio development. SQLite is the default database through `DATABASE_URL=sqlite:///./nanatostudio.db`.

The backend now provides a simple real auth foundation:

- Argon2 password hashing.
- HttpOnly SameSite=Lax session cookie auth.
- Server-generated math challenge for register/login.
- Default admin seed when no admin exists.
- Activity logging for auth events.

## Local Setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/auth/challenge
```

macOS/Linux activation:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Default Admin

On startup, if no admin user exists, the backend creates:

- username: `adm1n`
- email: `adm1n@example.local`
- password: `adm1n`
- role: `admin`
- `must_change_password`: `true`

The default password is intentionally weak for local bootstrap only and is stored as an Argon2 hash, not plaintext.

## Routes

- `GET /api/health`
- `GET /api/auth/challenge`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `GET /api/users/me`

Browser auth uses an HttpOnly cookie named `nanato_session`. API clients can also send the raw session token as a bearer token if they obtained one through internal tooling, but normal browser use should rely on cookies.

## Local Frontend Auth Debugging

Astro Login/Register pages resolve the API base like this:

- `PUBLIC_API_BASE_URL` set: use that value. Values ending in `/api` are normalized so frontend calls still target `/api/...` correctly.
- `PUBLIC_API_MODE=same-origin` or `PUBLIC_API_BASE_URL=/api`: use relative `/api/...` through the current origin.
- Local Astro dev/preview ports `4321`, `4322`, `4323`, `4324`, `4331`, `4335`, and `4339`: default to the same local hostname as the page, either `http://127.0.0.1:8000` or `http://localhost:8000`.
- Docker/Nginx or production-like same-origin deployment: use relative `/api/...`, which is proxied by Nginx.

Credentialed CORS is restricted to configured origins. The default local list includes Astro dev/preview ports and `localhost:8080` / `127.0.0.1:8080` for local Docker frontend access. It does not use wildcard credentialed CORS.

Cookie behavior:

- `SESSION_COOKIE_SECURE=false` for local HTTP.
- `SESSION_COOKIE_SECURE=true` only for HTTPS deployments.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Path=/`.

Environment variables are listed in the root `.env.example`.

From the repository root, start the backend with:

```powershell
npm run backend:dev
```

Then start the frontend in another terminal:

```powershell
npm run dev
```

Check local auth readiness:

```powershell
npm run auth:check
```

The direct PowerShell check is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-auth.ps1
```

To print the full local workflow and useful URLs:

```powershell
npm run dev:auth
```

To open backend and frontend in separate PowerShell windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev-auth.ps1 -StartAll
```

Useful local URLs:

- Frontend: `http://127.0.0.1:4321/`
- Login: `http://127.0.0.1:4321/login/`
- Backend health: `http://127.0.0.1:8000/api/health`
- Backend challenge: `http://127.0.0.1:8000/api/auth/challenge`

Default local admin bootstrap is `adm1n` / `adm1n`. Change the password after first login.

If Login/Register show `Failed to fetch` or `Challenge unavailable`, check:

- backend is running on `http://127.0.0.1:8000` or `http://localhost:8000`
- `PUBLIC_API_BASE_URL` is either unset for local Astro dev or points at the right backend
- frontend and backend use matching local hostnames. Mixing `localhost` and `127.0.0.1` can make the browser withhold the HttpOnly session cookie after a successful login.
- frontend origin is included in backend CORS
- Docker/Nginx `/api` proxy is running for same-origin deployments
- ports `8000` and `4321` are not already occupied by another process

Fallback commands when system `npm` is unavailable:

```powershell
node .tools\npm\package\bin\npm-cli.js run dev
node .tools\npm\package\bin\npm-cli.js run check
node .tools\npm\package\bin\npm-cli.js run build
```

Production-like local deployment should use the Nginx proxy instead of direct browser calls to the backend:

```powershell
docker compose -f deploy/docker-compose.yml up --build
Invoke-RestMethod http://localhost:8080/api/health
Invoke-RestMethod http://localhost:8080/api/auth/challenge
```

The compose frontend build passes `PUBLIC_API_MODE=same-origin` and `PUBLIC_API_BASE_URL=/api`, so Login/Register call the same origin at `http://localhost:8080/api/...`.

## Manual API Smoke Test

PowerShell example using a web session:

```powershell
$base = "http://127.0.0.1:8000"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Invoke-RestMethod "$base/api/health"

$challenge = Invoke-RestMethod "$base/api/auth/challenge?purpose=login" -WebSession $session
# Solve the returned math question manually, then:
Invoke-RestMethod "$base/api/auth/login" -Method Post -WebSession $session -ContentType "application/json" -Body (@{
  username_or_email = "adm1n"
  password = "adm1n"
  challenge_id = $challenge.challenge_id
  challenge_answer = "ANSWER"
} | ConvertTo-Json)

Invoke-RestMethod "$base/api/auth/me" -WebSession $session
Invoke-RestMethod "$base/api/auth/logout" -Method Post -WebSession $session
```

## Tests

```powershell
pytest
```

The tests use a temporary SQLite database and do not mutate `backend/nanatostudio.db`.
