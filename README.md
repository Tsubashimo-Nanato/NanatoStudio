# Nanato Studio

Nanato Studio is now an Astro website with a FastAPI backend scaffold. The old MkDocs source and generated output were preserved under `legacy/mkdocs/`; they are no longer the active framework.

## Project Layout

- `src/pages/` contains Astro routes.
- `src/content/blog/` contains dated blog Markdown or MDX.
- `src/content/docs/` contains documentation Markdown or MDX.
- `src/layouts/` contains shared page, blog, and docs layouts.
- `src/components/` contains shared navigation and site chrome.
- `src/styles/global.css` contains site-wide styling.
- `public/assets/` contains static assets copied from the old MkDocs `docs/assets/` tree.
- `backend/` contains the FastAPI app and SQLite local database scaffold.
- `deploy/` contains Docker and Nginx files for production-like local deployment.
- `legacy/mkdocs/` contains archived MkDocs source, generated `site/`, overrides, hooks, and debug snapshots.

Do not edit `dist/`, `site/`, or anything under `legacy/mkdocs/site/` as source. Astro generates frontend output into `dist/`.

## Frontend

Install dependencies and run Astro locally:

```bash
npm install
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

Run type and content checks:

```bash
npm run check
```

## Backend

Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

macOS/Linux:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```bash
curl http://127.0.0.1:8000/api/health
```

PowerShell auth checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/auth/challenge
```

## Local Auth Debugging

Login and Register call the real FastAPI backend with `credentials: "include"`. The frontend resolves the API base as follows:

- `PUBLIC_API_BASE_URL` set: use that value.
- `PUBLIC_API_MODE=same-origin` or `PUBLIC_API_BASE_URL=/api`: use relative `/api/...` through the current origin.
- Local Astro dev/preview ports such as `4321`, `4322`, `4323`, `4324`, `4331`, `4335`, and `4339`: use the same local hostname as the page, either `http://127.0.0.1:8000` or `http://localhost:8000`.
- Same-origin Docker/Nginx deployment, including `http://localhost:8080`: use relative `/api/...` through the Nginx proxy.

For normal Astro dev, do not set `PUBLIC_API_MODE=same-origin` unless you also provide a local `/api` proxy. Open the frontend and backend through matching local hostnames. For example, use `http://127.0.0.1:4321` with `http://127.0.0.1:8000`, or `http://localhost:4321` with `http://localhost:8000`. Mixing `localhost` and `127.0.0.1` can make the browser withhold the HttpOnly session cookie after login.

Start the backend from the repository root:

```powershell
npm run backend:dev
```

Equivalent manual backend command:

```powershell
cd backend
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
npm run dev
```

Check whether the local auth stack is reachable:

```powershell
npm run auth:check
```

The direct PowerShell check is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-auth.ps1
```

To print the full workflow, URLs, and optional startup commands:

```powershell
npm run dev:auth
```

To open backend and frontend in separate PowerShell windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev-auth.ps1 -StartAll
```

Useful URLs:

- Frontend: `http://127.0.0.1:4321/`
- Login: `http://127.0.0.1:4321/login/`
- Backend health: `http://127.0.0.1:8000/api/health`
- Backend challenge: `http://127.0.0.1:8000/api/auth/challenge`

PowerShell endpoint checks:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/auth/challenge
```

Default local admin bootstrap:

- username: `adm1n`
- password: `adm1n`

This account is for local bootstrap only. Change the password after first login.

Common causes of `Failed to fetch` or `Challenge unavailable`:

- the backend is not running on `http://127.0.0.1:8000`
- `PUBLIC_API_BASE_URL` points to the wrong host
- the frontend is opened on `localhost` while `PUBLIC_API_BASE_URL` forces `127.0.0.1`, or vice versa
- CORS does not include the frontend origin
- Docker/Nginx `/api` proxy is not running
- port `8000` or `4321` is already in use by another process

Fallback commands when system `npm` is unavailable:

```powershell
node .tools\npm\package\bin\npm-cli.js run dev
node .tools\npm\package\bin\npm-cli.js run check
node .tools\npm\package\bin\npm-cli.js run build
```

Environment variables are documented in `.env.example`. Important local auth values:

- `PUBLIC_API_BASE_URL`: optional browser API base. Use `http://127.0.0.1:8000` for direct Astro dev or `/api` for same-origin proxy mode.
- `PUBLIC_API_MODE`: set to `same-origin` to force `/api` proxy mode.
- `CORS_ORIGINS`: comma-separated backend CORS origins for credentialed local dev.
- `SESSION_COOKIE_SECURE`: keep `false` for local HTTP; use `true` only behind HTTPS.

## Writing Content

Add a blog post by creating a Markdown or MDX file in `src/content/blog/`:

```md
---
title: "Post title"
description: "Short summary."
date: "2026-05-09"
order: 10
category: "Blog"
tags: []
---

Write the post here.
```

Add a docs page by creating a Markdown or MDX file in `src/content/docs/`:

```md
---
title: "Docs title"
description: "Short summary."
order: 10
category: "Reference"
tags: []
---

Write the docs page here.
```

Put images, PDFs, spreadsheets, and other public static files in `public/assets/`, then reference them with root-relative paths such as `/assets/aiformula/images/example.svg`.

## Production-Like Local Deployment

Run the Docker deployment from the repository root:

```bash
docker compose -f deploy/docker-compose.yml up --build
```

The frontend is served at `http://localhost:8080`, and `/api/*` is proxied to the FastAPI backend. The Docker frontend build explicitly uses same-origin API mode:

- `PUBLIC_API_MODE=same-origin`
- `PUBLIC_API_BASE_URL=/api`

Local auth checks through the production-like origin:

```powershell
Invoke-RestMethod http://localhost:8080/api/health
Invoke-RestMethod http://localhost:8080/api/auth/challenge
```

Then open:

- `http://localhost:8080/login/`
- `http://localhost:8080/register/`

The backend compose service sets `SESSION_COOKIE_SECURE=false` for local HTTP, while auth cookies remain `HttpOnly`, `SameSite=Lax`, and `Path=/`.

## Migration Utility

The migration script is kept at `scripts/migrate_mkdocs_content.py`. It can regenerate migrated content from either `docs/` or the archived `legacy/mkdocs/docs/` folder.
