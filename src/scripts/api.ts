export type ApiProbeResult = {
  ok: boolean;
  label: string;
  url: string;
  status?: number;
  message: string;
};

export type ApiDiagnosticsResult = {
  apiBase: string;
  mode: string;
  health: ApiProbeResult;
  challenge: ApiProbeResult;
  summary: string;
};

type ApiBaseInfo = {
  base: string;
  display: string;
  mode: "configured" | "configured-same-origin" | "local-backend" | "same-origin";
};

type ApiErrorOptions = {
  isNetwork?: boolean;
  path?: string;
  responseBody?: unknown;
  url?: string;
};

export class ApiError extends Error {
  isNetwork: boolean;
  path?: string;
  responseBody?: unknown;
  status: number;
  url?: string;

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetwork = Boolean(options.isNetwork);
    this.path = options.path;
    this.responseBody = options.responseBody;
    this.url = options.url;
  }
}

const localBackendPort = "8000";
const localBackendCommand =
  "cd backend && .venv\\Scripts\\Activate.ps1 && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeConfiguredBase(value: string): string {
  const trimmed = trimTrailingSlash(value.trim());
  if (!trimmed || trimmed === "same-origin" || trimmed === "/api") return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function isSameOriginMode(value: unknown): boolean {
  return typeof value === "string" && ["same-origin", "proxy", "/api"].includes(value.trim().toLowerCase());
}

function isSameOriginBase(value: string): boolean {
  const trimmed = trimTrailingSlash(value.trim()).toLowerCase();
  return trimmed === "" || trimmed === "same-origin" || trimmed === "/api";
}

function isLocalAstroPort(port: string): boolean {
  const numericPort = Number(port);
  return Number.isInteger(numericPort) && numericPort >= 4321 && numericPort <= 4339;
}

function localBackendBaseForHost(hostname: string): string {
  const host = hostname === "localhost" ? "localhost" : "127.0.0.1";
  return `http://${host}:${localBackendPort}`;
}

function resolveApiBase(): ApiBaseInfo {
  const configured = import.meta.env.PUBLIC_API_BASE_URL;
  const configuredMode = import.meta.env.PUBLIC_API_MODE;

  if (isSameOriginMode(configuredMode)) {
    return {
      base: "",
      display: `${window.location.origin} (same-origin /api proxy)`,
      mode: "configured-same-origin"
    };
  }

  if (typeof configured === "string" && configured.trim()) {
    const base = normalizeConfiguredBase(configured);
    return {
      base,
      display: base || `${window.location.origin} (same-origin /api proxy)`,
      mode: isSameOriginBase(configured) ? "configured-same-origin" : "configured"
    };
  }

  const { hostname, origin, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (isLocalHost && isLocalAstroPort(port)) {
    const base = localBackendBaseForHost(hostname);
    return {
      base,
      display: base,
      mode: "local-backend"
    };
  }

  return {
    base: "",
    display: `${origin} (same-origin /api proxy)`,
    mode: "same-origin"
  };
}

export function apiBaseInfo(): ApiBaseInfo {
  return resolveApiBase();
}

export function describeApiBase(): string {
  return resolveApiBase().display;
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveApiBase().base}${normalizedPath}`;
}

function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin ? parsed.pathname : parsed.origin;
  } catch {
    return url;
  }
}

function networkMessage(url: string): string {
  const info = resolveApiBase();
  const target = endpointLabel(url);
  const origin = window.location.origin;

  if (info.mode === "same-origin") {
    return [
      `Could not reach the API through the same-origin /api proxy at ${target}.`,
      "If you are using Docker or Nginx, confirm the /api proxy is running and points to FastAPI.",
      `For direct local Astro debugging, set PUBLIC_API_BASE_URL=${localBackendBaseForHost(window.location.hostname)} or run Astro on a local dev port.`
    ].join(" ");
  }

  return [
    `Could not reach FastAPI backend at ${info.display}.`,
    `Start backend with: ${localBackendCommand}.`,
    "Then retry the challenge.",
    `If the backend is already running, check CORS for ${origin} or verify PUBLIC_API_BASE_URL.`
  ].join(" ");
}

function formatApiDetail(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "Request failed";

  const record = body as Record<string, unknown>;
  const detail = record.detail;
  const message = record.message;

  if (typeof detail === "string") return detail;
  if (typeof message === "string") return message;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const issue = item as Record<string, unknown>;
        const location = Array.isArray(issue.loc) ? issue.loc.join(".") : "";
        const msg = typeof issue.msg === "string" ? issue.msg : "Invalid value";
        return location ? `${location}: ${msg}` : msg;
      })
      .join("; ");
  }

  return "Request failed";
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = apiUrl(path);
  const { headers, ...requestInit } = init;
  let response: Response;

  try {
    response = await fetch(url, {
      ...requestInit,
      credentials: "include",
      headers: requestHeaders(headers)
    });
  } catch {
    throw new ApiError(networkMessage(url), 0, { isNetwork: true, path, url });
  }

  const body = await readResponseBody(response);

  if (!response.ok) {
    const detail = formatApiDetail(body);
    const wrongBaseHint = response.status === 404
      ? " Check that the API base points to FastAPI and that /api is proxied in Docker/Nginx deployments."
      : "";
    throw new ApiError(`${detail}${wrongBaseHint}`, response.status, {
      path,
      responseBody: body,
      url
    });
  }

  return body as T;
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed";
}

function requestHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has("Content-Type")) merged.set("Content-Type", "application/json");
  return merged;
}

async function probe(label: string, path: string): Promise<ApiProbeResult> {
  const url = apiUrl(path);
  try {
    await apiFetch(path);
    return {
      ok: true,
      label,
      url,
      message: `${label} OK`
    };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : undefined;
    return {
      ok: false,
      label,
      url,
      status: apiError?.status,
      message: formatApiError(error)
    };
  }
}

export async function runApiDiagnostics(): Promise<ApiDiagnosticsResult> {
  const info = resolveApiBase();
  const health = await probe("Health endpoint", "/api/health");
  const challenge = await probe("Challenge endpoint", "/api/auth/challenge?purpose=login");
  let summary = "Backend reachable. Health and challenge endpoints responded.";

  if (!health.ok && !challenge.ok) {
    summary = health.status === 0 || challenge.status === 0
      ? "Backend is likely not running, the API base is wrong, or the browser blocked the request with CORS/network failure."
      : "Backend responded, but both health and challenge checks failed.";
  } else if (!health.ok) {
    summary = "Challenge responded, but the health endpoint failed. Check backend route registration.";
  } else if (!challenge.ok) {
    summary = "Backend health is reachable, but the challenge endpoint failed. Check auth route errors.";
  }

  return {
    apiBase: info.display,
    mode: info.mode,
    health,
    challenge,
    summary
  };
}
