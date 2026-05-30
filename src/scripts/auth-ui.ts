import { ApiError, apiBaseInfo, apiFetch, describeApiBase, formatApiError, runApiDiagnostics } from "./api";
import type MarkdownIt from "markdown-it";

type ApiUser = {
  id: number;
  username: string;
  email: string;
  role: "admin" | "editor" | "user";
  is_active: boolean;
  must_change_password: boolean;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string | null;
};

type ChallengeResponse = {
  challenge_id: string;
  question: string;
  expires_at: string;
};

type AuthResponse = {
  user: ApiUser;
  session_expires_at: string;
};

type Maintainer = {
  id: number;
  username: string;
  email?: string | null;
};

type ContentItem = {
  id: number;
  type: "blog" | "doc" | "chapter";
  title: string;
  slug: string;
  file_path: string;
  route_path: string;
  anchor?: string | null;
  is_editable: boolean;
  updated_at?: string;
  maintainers: Maintainer[];
};

type ContentDetail = ContentItem & {
  frontmatter: Record<string, unknown>;
  body: string;
  body_hash: string;
};

type ActivityEvent = {
  id: number;
  actor_user_id?: number | null;
  target_user_id?: number | null;
  event_type: string;
  created_at: string;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown>;
};

type AdminOverview = {
  total_users: number;
  active_users: number;
  admin_count: number;
  editor_count: number;
  user_count: number;
  content_items: number;
  assigned_permissions: number;
  recent_logins: number;
  recent_login_failures: number;
  recent_content_edits: number;
  recent_content_updates: number;
  default_admin_password_warning: boolean;
  recent_activity_events: ActivityEvent[];
};

type ParsedMarkdownDocument = {
  body: string;
  frontmatter: Record<string, unknown>;
};

let editorMarkdownRenderer: MarkdownIt | null = null;
const editorPreviewFrames = new WeakMap<HTMLFormElement, number>();

function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function setHidden(element: Element | null, hidden: boolean): void {
  element?.toggleAttribute("hidden", hidden);
}

function setText(element: Element | null, text: string): void {
  if (element) element.textContent = text;
}

function withApiTimeout<T>(request: Promise<T>, message: string, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), ms);
    request.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function clearElement(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function formValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function setStatus(root: ParentNode, message: string, tone: "neutral" | "success" | "error" = "neutral"): void {
  const status = qs<HTMLElement>("[data-auth-message]", root);
  if (!status) return;
  status.textContent = message;
  status.classList.remove("form-status--neutral", "form-status--success", "form-status--error");
  status.classList.add(`form-status--${tone}`);
}

function setDiagnosticResult(root: HTMLElement, message: string, tone: "neutral" | "success" | "error" = "neutral"): void {
  const result = qs<HTMLElement>("[data-api-debug-result]", root);
  if (!result) return;
  result.textContent = message;
  result.classList.remove("api-debug-panel__result--neutral", "api-debug-panel__result--success", "api-debug-panel__result--error");
  result.classList.add(`api-debug-panel__result--${tone}`);
}

function setupApiDiagnostics(): void {
  qsa<HTMLElement>("[data-api-diagnostics]").forEach((panel) => {
    if (panel.dataset.apiDiagnosticsReady === "true") return;
    panel.dataset.apiDiagnosticsReady = "true";
    const base = qs<HTMLElement>("[data-api-base]", panel);
    const mode = qs<HTMLElement>("[data-api-mode]", panel);
    const button = qs<HTMLButtonElement>("[data-api-debug-check]", panel);
    const form = panel.closest(".auth-card")?.querySelector<HTMLFormElement>("[data-auth-form]");
    const info = apiBaseInfo();

    setText(base, describeApiBase());
    setText(mode, info.mode);
    setDiagnosticResult(panel, "Use this when the challenge says unavailable.", "neutral");

    button?.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Checking...";
      setDiagnosticResult(panel, "Checking /api/health and /api/auth/challenge...", "neutral");

      try {
        const diagnostics = await runApiDiagnostics();
        const tone = diagnostics.health.ok && diagnostics.challenge.ok ? "success" : "error";
        const lines = [
          diagnostics.summary,
          `API base: ${diagnostics.apiBase}`,
          `Health: ${diagnostics.health.ok ? "OK" : diagnostics.health.message}`,
          `Challenge: ${diagnostics.challenge.ok ? "OK" : diagnostics.challenge.message}`
        ];
        setDiagnosticResult(panel, lines.join(" "), tone);
        if (form && diagnostics.challenge.ok) await loadChallenge(form);
      } catch (error) {
        setDiagnosticResult(panel, formatApiError(error), "error");
      } finally {
        button.disabled = false;
        button.textContent = "Check backend";
      }
    });
  });
}

async function loadChallenge(form: HTMLFormElement): Promise<void> {
  const mode = form.dataset.authMode === "register" ? "register" : "login";
  const question = qs<HTMLElement>("[data-challenge-question]", form);
  const input = qs<HTMLInputElement>("[data-challenge-id]", form);
  const answer = qs<HTMLInputElement>('input[name="challenge_answer"]', form);

  setText(question, "Loading challenge...");
  if (input) input.value = "";
  if (answer) answer.value = "";

  try {
    const challenge = await apiFetch<ChallengeResponse>(`/api/auth/challenge?purpose=${mode}`);
    setText(question, challenge.question);
    if (input) input.value = challenge.challenge_id;
  } catch (error) {
    const message = formatApiError(error);
    setText(question, "Challenge unavailable");
    setStatus(form, message, "error");
  }
}

function setFormBusy(form: HTMLFormElement, busy: boolean): void {
  qsa<HTMLInputElement | HTMLTextAreaElement>("input, textarea", form).forEach((control) => {
    if (control.type !== "hidden") control.readOnly = busy;
  });
  qsa<HTMLButtonElement>("button", form).forEach((control) => {
    control.disabled = busy;
  });
  form.toggleAttribute("aria-busy", busy);
}

function clearPasswordInputs(form: HTMLFormElement): void {
  qsa<HTMLInputElement>('input[type="password"]', form).forEach((input) => {
    input.value = "";
  });
}

async function handleLogin(form: HTMLFormElement): Promise<void> {
  const payload = {
    username_or_email: formValue(form, "username_or_email"),
    password: formValue(form, "password"),
    challenge_id: formValue(form, "challenge_id"),
    challenge_answer: formValue(form, "challenge_answer")
  };

  const result = await apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  window.location.href = result.user.role === "admin" ? "/admin/" : "/dashboard/";
}

async function handleRegister(form: HTMLFormElement): Promise<void> {
  const payload = {
    username: formValue(form, "username"),
    email: formValue(form, "email"),
    confirm_email: formValue(form, "confirm_email"),
    password: formValue(form, "password"),
    confirm_password: formValue(form, "confirm_password"),
    challenge_id: formValue(form, "challenge_id"),
    challenge_answer: formValue(form, "challenge_answer")
  };

  const result = await apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  form.reset();
  setStatus(
    form,
    `Account created for ${result.user.username}. You can now sign in from the login page.`,
    "success"
  );
}

function setupAuthForms(): void {
  qsa<HTMLFormElement>("[data-auth-form]").forEach((form) => {
    if (form.dataset.authFormReady === "true") return;
    form.dataset.authFormReady = "true";
    loadChallenge(form);

    qs<HTMLButtonElement>("[data-challenge-reload]", form)?.addEventListener("click", () => {
      loadChallenge(form);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormBusy(form, true);
      setStatus(form, "Submitting securely...", "neutral");

      try {
        if (!formValue(form, "challenge_id")) {
          setStatus(
            form,
            "No active human challenge. Check the backend status, then retry the challenge before submitting.",
            "error"
          );
          await loadChallenge(form);
          return;
        }

        if (form.dataset.authMode === "register") {
          await handleRegister(form);
          await loadChallenge(form);
        } else {
          await handleLogin(form);
        }
      } catch (error) {
        clearPasswordInputs(form);
        setStatus(form, formatApiError(error), "error");
        await loadChallenge(form);
      } finally {
        setFormBusy(form, false);
      }
    });
  });
}

async function logout(redirectTo = "/login/"): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // A missing or expired session is effectively signed out for the UI.
  }
  window.location.href = redirectTo;
}

function setupLogoutButtons(): void {
  qsa<HTMLButtonElement>("[data-auth-logout]").forEach((button) => {
    if (button.dataset.authLogoutReady === "true") return;
    button.dataset.authLogoutReady = "true";
    button.addEventListener("click", () => {
      logout();
    });
  });
}

function writeUserFields(root: ParentNode, user: ApiUser): void {
  qsa<HTMLElement>("[data-user-field]", root).forEach((element) => {
    const field = element.dataset.userField;
    if (field === "username") element.textContent = user.username;
    if (field === "email") element.textContent = user.email;
    if (field === "role") element.textContent = user.role;
    if (field === "status") element.textContent = user.is_active ? "Active" : "Inactive";
    if (field === "last_login_at") element.textContent = formatDateTime(user.last_login_at);
  });
}

async function setupDashboard(): Promise<void> {
  const root = qs<HTMLElement>("[data-dashboard-page]");
  if (!root) return;
  if (root.dataset.dashboardReady === "true") return;
  root.dataset.dashboardReady = "true";

  const loading = qs<HTMLElement>("[data-dashboard-loading]", root);
  const signedOut = qs<HTMLElement>("[data-dashboard-signed-out]", root);
  const signedIn = qs<HTMLElement>("[data-dashboard-signed-in]", root);
  const adminAreas = qsa<HTMLElement>("[data-dashboard-admin]", root);
  const userAreas = qsa<HTMLElement>("[data-dashboard-user]", root);
  const logoutButtons = qsa<HTMLButtonElement>("[data-auth-logout]", root);
  const warning = qs<HTMLElement>("[data-dashboard-password-warning]", root);

  try {
    const user = await apiFetch<ApiUser>("/api/auth/me");
    writeUserFields(root, user);
    setHidden(loading, true);
    setHidden(signedOut, true);
    setHidden(signedIn, false);
    setHidden(warning, !user.must_change_password);
    adminAreas.forEach((area) => setHidden(area, user.role !== "admin"));
    userAreas.forEach((area) => setHidden(area, user.role === "admin"));
    logoutButtons.forEach((button) => setHidden(button, false));

    const adminSummary = qs<HTMLElement>("[data-dashboard-admin-summary]", root);
    const userContent = qs<HTMLElement>("[data-dashboard-user-content]", root);
    if (user.role === "admin" && adminSummary) {
      try {
        const overview = await apiFetch<AdminOverview>("/api/admin/overview");
        renderOverview(adminSummary, overview);
      } catch (error) {
        adminSummary.textContent = formatApiError(error);
      }
    }
    if (user.role !== "admin" && userContent) {
      try {
        const response = await apiFetch<{ items: ContentItem[] }>("/api/editor/content");
        renderEditorList(userContent, response.items);
      } catch (error) {
        userContent.textContent = formatApiError(error);
      }
    }
  } catch (error) {
    setHidden(loading, true);
    setHidden(signedIn, true);
    setHidden(signedOut, false);
    const message = error instanceof ApiError
      ? error.status >= 500
        ? "The API is reachable but returned a server error."
        : "No active backend session was found."
      : "The API could not be reached. Start the FastAPI backend and try again.";
    setText(qs("[data-dashboard-signed-out-message]", root), message);
  }
}

function setupPasswordChange(): void {
  const form = qs<HTMLFormElement>("[data-password-change-form]");
  if (!form) return;
  if (form.dataset.passwordChangeReady === "true") return;
  form.dataset.passwordChangeReady = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormBusy(form, true);
    setStatus(form, "Updating password...", "neutral");

    const payload = {
      current_password: formValue(form, "current_password"),
      new_password: formValue(form, "new_password"),
      confirm_new_password: formValue(form, "confirm_new_password")
    };

    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      setStatus(form, "Password changed. The default-admin warning will clear after refresh.", "success");
      setHidden(qs("[data-dashboard-password-warning]"), true);
      setHidden(qs("[data-admin-password-warning]"), true);
    } catch (error) {
      clearPasswordInputs(form);
      setStatus(form, formatApiError(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  });
}

function renderJsonFallback(container: HTMLElement, payload: unknown): void {
  const pre = document.createElement("pre");
  pre.className = "admin-json-preview";
  pre.textContent = JSON.stringify(payload, null, 2);
  container.append(pre);
}

function renderOverview(container: HTMLElement, data: unknown): void {
  if (!data || typeof data !== "object") {
    renderJsonFallback(container, data);
    return;
  }

  const record = data as Partial<AdminOverview> & Record<string, unknown>;
  const grid = document.createElement("div");
  grid.className = "admin-data-grid";
  [
    ["Total users", record.total_users],
    ["Active users", record.active_users],
    ["Admins", record.admin_count],
    ["Editors", record.editor_count],
    ["Users", record.user_count],
    ["Content items", record.content_items],
    ["Assignments", record.assigned_permissions],
    ["Recent logins", record.recent_logins],
    ["Login failures", record.recent_login_failures],
    ["Content updates", record.recent_content_updates ?? record.recent_content_edits]
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "admin-card admin-card--compact";
    const span = document.createElement("span");
    span.textContent = String(label);
    const strong = document.createElement("strong");
    strong.textContent = value === undefined || value === null ? "Unavailable" : String(value);
    card.append(span, strong);
    grid.append(card);
  });
  container.append(grid);

  if (record.default_admin_password_warning) {
    const warning = document.createElement("section");
    warning.className = "auth-alert auth-alert--warning";
    warning.innerHTML = "<strong>Default admin password is still active.</strong><span>Change the seeded password from the dashboard before using this beyond local development.</span>";
    container.append(warning);
  }

  if (Array.isArray(record.recent_activity_events) && record.recent_activity_events.length > 0) {
    const section = document.createElement("section");
    section.className = "admin-note-panel";
    const title = document.createElement("h2");
    title.textContent = "Recent backend activity";
    section.append(title);
    renderActivity(section, { events: record.recent_activity_events }, false);
    container.append(section);
  }
}

function renderUsers(container: HTMLElement, data: unknown): void {
  const users = Array.isArray(data) ? data : (data as { users?: unknown[] })?.users;
  if (!Array.isArray(users)) {
    renderJsonFallback(container, data);
    return;
  }

  const createForm = document.createElement("form");
  createForm.className = "admin-form admin-user-create-form";
  createForm.innerHTML = `
    <div>
      <p class="eyebrow">Create user</p>
      <h2>Add an account</h2>
      <p class="form-status form-status--neutral" data-auth-message aria-live="polite">Temporary passwords are submitted to the backend and are never displayed after creation.</p>
    </div>
    <div class="admin-form__grid">
      <label>Username <input type="text" name="username" autocomplete="off" required /></label>
      <label>Email <input type="email" name="email" autocomplete="off" required /></label>
      <label>Temporary password <input type="password" name="temporary_password" autocomplete="new-password" minlength="8" required /></label>
      <label>Role
        <select name="role">
          <option value="user">user</option>
          <option value="editor">editor</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label class="admin-checkbox-row"><input type="checkbox" name="is_active" checked /> Active</label>
      <label class="admin-checkbox-row"><input type="checkbox" name="must_change_password" checked /> Must change password</label>
    </div>
    <button class="button button--primary" type="submit">Create user</button>
  `;
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormBusy(createForm, true);
    setStatus(createForm, "Creating user...", "neutral");
    try {
      await apiFetch<ApiUser>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: formValue(createForm, "username"),
          email: formValue(createForm, "email"),
          temporary_password: formValue(createForm, "temporary_password"),
          role: formValue(createForm, "role"),
          is_active: new FormData(createForm).has("is_active"),
          must_change_password: new FormData(createForm).has("must_change_password")
        })
      });
      createForm.reset();
      setStatus(createForm, "User created. Reloading account list...", "success");
      window.location.reload();
    } catch (error) {
      clearPasswordInputs(createForm);
      setFormBusy(createForm, false);
      setStatus(createForm, formatApiError(error), "error");
    }
  });
  container.append(createForm);

  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = "<thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Password</th><th>Action</th></tr></thead>";
  const body = document.createElement("tbody");
  users.forEach((item) => {
    const user = item as Partial<ApiUser>;
    const row = document.createElement("tr");

    const usernameCell = document.createElement("td");
    const usernameInput = document.createElement("input");
    usernameInput.value = user.username ?? "";
    usernameInput.name = "username";
    usernameCell.append(usernameInput);

    const emailCell = document.createElement("td");
    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.value = user.email ?? "";
    emailInput.name = "email";
    emailCell.append(emailInput);

    const roleCell = document.createElement("td");
    const roleSelect = document.createElement("select");
    roleSelect.name = "role";
    ["user", "editor", "admin"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = user.role === value;
      roleSelect.append(option);
    });
    roleCell.append(roleSelect);

    const statusCell = document.createElement("td");
    const activeLabel = document.createElement("label");
    activeLabel.className = "admin-inline-check";
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.checked = user.is_active !== false;
    activeLabel.append(activeInput, " Active");
    const mustChangeLabel = document.createElement("label");
    mustChangeLabel.className = "admin-inline-check";
    const mustChangeInput = document.createElement("input");
    mustChangeInput.type = "checkbox";
    mustChangeInput.checked = user.must_change_password === true;
    mustChangeLabel.append(mustChangeInput, " Must change");
    statusCell.append(activeLabel, mustChangeLabel);

    const passwordCell = document.createElement("td");
    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.placeholder = "New temp password";
    passwordInput.autocomplete = "new-password";
    passwordCell.append(passwordInput);

    const actionCell = document.createElement("td");
    const saveButton = document.createElement("button");
    saveButton.className = "button button--subtle";
    saveButton.type = "button";
    saveButton.textContent = "Save";
    const statusText = document.createElement("span");
    statusText.className = "admin-row-status";
    saveButton.addEventListener("click", async () => {
      if (!user.id) return;
      saveButton.disabled = true;
      statusText.textContent = "Saving...";
      const temporaryPassword = passwordInput.value.trim();
      try {
        await apiFetch<ApiUser>(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            username: usernameInput.value,
            email: emailInput.value,
            role: roleSelect.value,
            is_active: activeInput.checked,
            must_change_password: mustChangeInput.checked,
            ...(temporaryPassword ? { temporary_password: temporaryPassword } : {})
          })
        });
        passwordInput.value = "";
        statusText.textContent = "Saved";
      } catch (error) {
        statusText.textContent = formatApiError(error);
      } finally {
        saveButton.disabled = false;
      }
    });
    actionCell.append(saveButton, statusText);

    row.append(usernameCell, emailCell, roleCell, statusCell, passwordCell, actionCell);
    body.append(row);
  });
  table.append(body);
  container.append(table);
}

function renderActivity(container: HTMLElement, data: unknown, includeFilter = true): void {
  const events = Array.isArray(data) ? data : (data as { events?: unknown[]; activity?: unknown[] })?.events ?? (data as { activity?: unknown[] })?.activity;
  if (!Array.isArray(events)) {
    renderJsonFallback(container, data);
    return;
  }

  if (includeFilter) {
    const filter = document.createElement("form");
    filter.className = "activity-filter-form";
    filter.innerHTML = `
      <label>
        Event type
        <input type="text" name="event_type" placeholder="login_failure, content_update..." />
      </label>
      <button class="button button--subtle" type="submit">Filter</button>
      <button class="button" type="button" data-activity-clear>Clear</button>
    `;
    filter.addEventListener("submit", async (event) => {
      event.preventDefault();
      const eventType = formValue(filter, "event_type").trim();
      try {
        const response = await apiFetch(`/api/admin/activity${eventType ? `?event_type=${encodeURIComponent(eventType)}` : ""}`);
        clearElement(container);
        renderActivity(container, response, includeFilter);
      } catch (error) {
        alert(formatApiError(error));
      }
    });
    qs<HTMLButtonElement>("[data-activity-clear]", filter)?.addEventListener("click", async () => {
      try {
        const response = await apiFetch("/api/admin/activity");
        clearElement(container);
        renderActivity(container, response, includeFilter);
      } catch (error) {
        alert(formatApiError(error));
      }
    });
    container.append(filter);
  }

  const feed = document.createElement("div");
  feed.className = "activity-feed";
  events.forEach((event) => {
    const record = event as Record<string, unknown>;
    const item = document.createElement("article");
    item.className = "activity-item";
    const title = document.createElement("strong");
    title.textContent = String(record.event_type ?? record.action ?? "activity");
    const meta = document.createElement("span");
    const actor = record.actor_user_id ? `actor ${record.actor_user_id}` : "system";
    const target = record.target_user_id ? `target ${record.target_user_id}` : "no target";
    meta.textContent = `${formatDateTime(String(record.created_at ?? ""))} / ${actor} / ${target}`;
    const details = document.createElement("p");
    details.textContent = typeof record.details === "object" && record.details !== null
      ? JSON.stringify(record.details)
      : String(record.details ?? record.summary ?? "No details provided");
    item.append(title, meta, details);
    feed.append(item);
  });
  container.append(feed);
}

function contentItemsFromResponse(data: unknown): ContentItem[] | null {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[]; content?: unknown[] })?.items ?? (data as { content?: unknown[] })?.content;
  if (!Array.isArray(items)) {
    return null;
  }
  return items as ContentItem[];
}

function renderMaintainerChips(root: HTMLElement, item: ContentItem, allowRemove: boolean): void {
  const chipWrap = document.createElement("div");
  chipWrap.className = "maintainer-chip-row";

  if (item.maintainers.length === 0) {
    const empty = document.createElement("span");
    empty.className = "maintainer-chip maintainer-chip--empty";
    empty.textContent = "Admin-only until assigned";
    chipWrap.append(empty);
  }

  item.maintainers.forEach((maintainer) => {
    const chip = document.createElement("span");
    chip.className = "maintainer-chip";
    const label = document.createElement("span");
    label.textContent = maintainer.username;
    chip.append(label);

    if (allowRemove) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "maintainer-chip__remove";
      button.textContent = "Remove";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await apiFetch(`/api/admin/content/${item.id}/permissions/${maintainer.id}`, {
            method: "DELETE"
          });
          window.location.reload();
        } catch (error) {
          button.disabled = false;
          alert(formatApiError(error));
        }
      });
      chip.append(button);
    }

    chipWrap.append(chip);
  });

  root.append(chipWrap);
}

function renderContent(container: HTMLElement, data: unknown, mode: "content" | "editor" = "content"): void {
  const items = contentItemsFromResponse(data);
  if (!items) {
    renderJsonFallback(container, data);
    return;
  }

  const list = document.createElement("div");
  list.className = "content-permission-list";

  if (mode === "content") {
    const toolbar = document.createElement("div");
    toolbar.className = "content-admin-toolbar";
    const scanButton = document.createElement("button");
    scanButton.type = "button";
    scanButton.className = "button button--primary";
    scanButton.textContent = "Scan source content";
    const note = document.createElement("p");
    note.textContent = "Scan imports Markdown and MDX files from src/content/blog and src/content/docs without deleting existing content records.";
    scanButton.addEventListener("click", async () => {
      scanButton.disabled = true;
      scanButton.textContent = "Scanning...";
      try {
        await apiFetch("/api/admin/content/scan", { method: "POST", body: "{}" });
        window.location.reload();
      } catch (error) {
        scanButton.disabled = false;
        scanButton.textContent = "Scan source content";
        alert(formatApiError(error));
      }
    });
    toolbar.append(scanButton, note);
    container.append(toolbar);
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "content-permission-item";
    const title = document.createElement("strong");
    title.textContent = item.title || item.slug || "Untitled content";
    const meta = document.createElement("span");
    meta.textContent = `${item.type} / ${item.route_path}${item.is_editable ? "" : " / inventory only"}${item.updated_at ? ` / updated ${formatDateTime(item.updated_at)}` : ""}`;
    const path = document.createElement("p");
    path.textContent = item.file_path;
    article.append(title, meta, path);
    renderMaintainerChips(article, item, mode === "content");

    const actions = document.createElement("div");
    actions.className = "content-item-actions";
    const editLink = document.createElement("a");
    editLink.className = "button";
    editLink.href = `/editor/?content_id=${item.id}`;
    editLink.textContent = item.is_editable ? "Open editor" : "View inventory";
    actions.append(editLink);

    if (mode === "content") {
      const form = document.createElement("form");
      form.className = "permission-inline-form";
      const input = document.createElement("input");
      input.name = "username";
      input.placeholder = "username";
      input.required = true;
      const select = document.createElement("select");
      select.name = "permission";
      ["maintain", "edit"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
      const button = document.createElement("button");
      button.className = "button button--subtle";
      button.type = "submit";
      button.textContent = "Assign";
      form.append(input, select, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await apiFetch(`/api/admin/content/${item.id}/permissions`, {
            method: "POST",
            body: JSON.stringify({ username: input.value, permission: select.value })
          });
          window.location.reload();
        } catch (error) {
          button.disabled = false;
          alert(formatApiError(error));
        }
      });
      actions.append(form);
    }

    article.append(actions);
    list.append(article);
  });
  container.append(list);
}

function renderAdminData(container: HTMLElement, view: string, data: unknown): void {
  container.textContent = "";
  if (view === "overview") renderOverview(container, data);
  else if (view === "users") renderUsers(container, data);
  else if (view === "activity") renderActivity(container, data);
  else if (view === "content") renderContent(container, data, "content");
  else if (view === "editor") renderContent(container, data, "editor");
  else renderJsonFallback(container, data);
}

async function setupAdminPages(): Promise<void> {
  const root = qs<HTMLElement>("[data-admin-page]");
  if (!root) return;
  if (root.dataset.adminReady === "true") return;
  root.dataset.adminReady = "true";

  const loading = qs<HTMLElement>("[data-admin-loading]", root);
  const unauthenticated = qs<HTMLElement>("[data-admin-unauthenticated]", root);
  const forbidden = qs<HTMLElement>("[data-admin-forbidden]", root);
  const unavailable = qs<HTMLElement>("[data-admin-unavailable]", root);
  const unavailableMessage = qs<HTMLElement>("[data-admin-unavailable-message]", root);
  const content = qs<HTMLElement>("[data-admin-content]", root);
  const results = qs<HTMLElement>("[data-admin-results]", root);
  const warning = qs<HTMLElement>("[data-admin-password-warning]", root);
  const currentUser = qs<HTMLElement>("[data-admin-current-user]", root);
  const signOut = qs<HTMLButtonElement>("[data-auth-logout]", root);
  const endpoint = root.dataset.adminEndpoint;
  const view = root.dataset.adminView ?? "overview";

  try {
    const user = await apiFetch<ApiUser>("/api/auth/me");
    setText(currentUser, `${user.username} / ${user.role}`);
    setHidden(signOut, false);
    setHidden(warning, !user.must_change_password);

    if (user.role !== "admin") {
      setHidden(loading, true);
      setHidden(forbidden, false);
      return;
    }

    if (!endpoint) throw new ApiError("No admin endpoint configured for this page.", 0);

    const data = await apiFetch<unknown>(endpoint);
    if (results) renderAdminData(results, view, data);
    setHidden(loading, true);
    setHidden(content, false);
  } catch (error) {
    setHidden(loading, true);

    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      setHidden(error.status === 401 ? unauthenticated : forbidden, false);
      return;
    }

    const status = error instanceof ApiError && error.status ? `HTTP ${error.status}` : "Request failed";
    const message = formatApiError(error);
    setText(unavailableMessage, `${status}: ${message}. No admin data is being faked on this page.`);
    setHidden(unavailable, false);
  }
}

function renderEditorList(container: HTMLElement, items: ContentItem[]): void {
  clearElement(container);
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "auth-state auth-state--locked";
    empty.innerHTML = "<h2>No editable content assigned</h2><p>Ask an admin to assign you as a maintainer for a blog post, docs file, or chapter.</p>";
    container.append(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "content-permission-list";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "content-permission-item";
    card.dataset.contentId = String(item.id);
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = `${item.type} / ${item.route_path}${item.is_editable ? "" : " / inventory only"}${item.updated_at ? ` / updated ${formatDateTime(item.updated_at)}` : ""}`;
    const path = document.createElement("p");
    path.textContent = item.file_path;
    const link = document.createElement("a");
    link.className = "button";
    link.href = `/editor/?content_id=${item.id}`;
    link.textContent = item.is_editable ? "Edit source" : "Open inventory record";
    card.append(title, meta, path);
    renderMaintainerChips(card, item, false);
    card.append(link);
    list.append(card);
  });
  container.append(list);
}

function normalizeEditorRoute(value: string): string {
  if (!value) return "";
  const [path, hash = ""] = value.split("#");
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  return hash ? `${normalizedPath}#${hash}` : normalizedPath;
}

function resolveEditorContentId(items: ContentItem[], contentId: string | null, route: string | null): string | null {
  if (contentId && /^\d+$/.test(contentId)) return contentId;
  if (!route) return null;

  const normalizedRoute = normalizeEditorRoute(route);
  const item = items.find((candidate) => normalizeEditorRoute(candidate.route_path) === normalizedRoute);
  return item ? String(item.id) : null;
}

async function markdownRenderer(): Promise<MarkdownIt> {
  if (editorMarkdownRenderer) return editorMarkdownRenderer;
  const { default: MarkdownIt } = await import("markdown-it");
  editorMarkdownRenderer = new MarkdownIt({
    breaks: false,
    html: false,
    linkify: true,
    typographer: true
  });
  return editorMarkdownRenderer;
}

function parseMarkdownScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && String(numeric) === trimmed ? numeric : trimmed;
}

function parseMarkdownDocument(raw: string): ParsedMarkdownDocument {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: {}, body: normalized };

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: normalized };

  const frontmatterText = normalized.slice(4, end).trim();
  const body = normalized.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  let currentListKey = "";

  frontmatterText.split("\n").forEach((line) => {
    if (!line.trim() || line.trimStart().startsWith("#")) return;
    const listMatch = line.match(/^\s*-\s*(.+?)\s*$/);
    if (listMatch && currentListKey) {
      const current = Array.isArray(frontmatter[currentListKey]) ? frontmatter[currentListKey] as unknown[] : [];
      current.push(parseMarkdownScalar(listMatch[1]));
      frontmatter[currentListKey] = current;
      return;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyMatch) {
      currentListKey = "";
      return;
    }

    const key = keyMatch[1];
    const value = keyMatch[2] ?? "";
    if (value.trim() === "") {
      frontmatter[key] = [];
      currentListKey = key;
    } else {
      frontmatter[key] = parseMarkdownScalar(value);
      currentListKey = "";
    }
  });

  return { frontmatter, body };
}

function setInputValue(form: HTMLFormElement, name: string, value: unknown): void {
  const input = qs<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`, form);
  if (!input || value === undefined || value === null) return;
  input.value = Array.isArray(value) ? value.join(", ") : String(value);
}

function updateEditorCount(form: HTMLFormElement): void {
  const body = formValue(form, "body");
  const counter = qs<HTMLElement>("[data-editor-count]", form);
  if (!counter) return;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  counter.textContent = `${words.toLocaleString()} words / ${body.length.toLocaleString()} characters`;
}

async function renderEditorPreview(form: HTMLFormElement): Promise<void> {
  const preview = qs<HTMLElement>("[data-editor-preview]", form);
  if (!preview) return;

  const body = formValue(form, "body");
  updateEditorCount(form);
  preview.setAttribute("aria-busy", "true");

  if (!body.trim()) {
    preview.innerHTML = '<p class="editor-preview__empty">No Markdown body yet.</p>';
    preview.removeAttribute("aria-busy");
    return;
  }

  try {
    const renderer = await markdownRenderer();
    preview.innerHTML = renderer.render(body);
  } catch {
    preview.textContent = body;
  } finally {
    preview.removeAttribute("aria-busy");
  }
}

function scheduleEditorPreview(form: HTMLFormElement): void {
  const existingFrame = editorPreviewFrames.get(form);
  if (existingFrame) window.cancelAnimationFrame(existingFrame);
  const frame = window.requestAnimationFrame(() => {
    editorPreviewFrames.delete(form);
    void renderEditorPreview(form);
  });
  editorPreviewFrames.set(form, frame);
}

function setupEditorEnhancements(form: HTMLFormElement): void {
  if (form.dataset.editorEnhanced === "true") return;
  form.dataset.editorEnhanced = "true";

  const bodyInput = qs<HTMLTextAreaElement>('textarea[name="body"]', form);
  const fileInput = qs<HTMLInputElement>("[data-editor-import]", form);
  const importButton = qs<HTMLButtonElement>("[data-editor-import-trigger]", form);
  const copyButton = qs<HTMLButtonElement>("[data-editor-copy]", form);
  const buildButton = qs<HTMLButtonElement>("[data-editor-build]", form);

  bodyInput?.addEventListener("input", () => scheduleEditorPreview(form));
  importButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".md") && !lowerName.endsWith(".mdx")) {
      setStatus(form, "Choose a .md or .mdx file.", "error");
      return;
    }

    try {
      const parsed = parseMarkdownDocument(await file.text());
      setInputValue(form, "title", parsed.frontmatter.title);
      setInputValue(form, "description", parsed.frontmatter.description);
      setInputValue(form, "category", parsed.frontmatter.category);
      setInputValue(form, "tags", parsed.frontmatter.tags);
      setInputValue(form, "body", parsed.body);
      setStatus(form, `Loaded ${file.name}. Review the live preview, then save to update the selected source file.`, "success");
      scheduleEditorPreview(form);
    } catch (error) {
      setStatus(form, error instanceof Error ? error.message : "Could not read Markdown file.", "error");
    }
  });

  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(formValue(form, "body"));
      setStatus(form, "Markdown source copied.", "success");
    } catch {
      setStatus(form, "Clipboard access was blocked by the browser.", "error");
    }
  });

  buildButton?.addEventListener("click", async () => {
    buildButton.disabled = true;
    setStatus(form, "Running npm run build from the backend workspace...", "neutral");
    try {
      const result = await withApiTimeout(
        apiFetch<{ message: string; output?: string }>("/api/editor/build", { method: "POST" }),
        "npm run build did not finish within 3 minutes. Check the backend terminal for progress.",
        180000
      );
      setStatus(form, result.message, "success");
    } catch (error) {
      setStatus(form, formatApiError(error), "error");
    } finally {
      buildButton.disabled = false;
    }
  });
}

function writeEditorForm(root: HTMLElement, detail: ContentDetail): void {
  const form = qs<HTMLFormElement>("[data-editor-form]", root);
  if (!form) return;
  setupEditorEnhancements(form);
  setHidden(form, false);
  setText(qs("[data-editor-title]", root), detail.title);
  setText(qs("[data-editor-path]", root), `${detail.route_path} / ${detail.file_path}`);
  const idInput = qs<HTMLInputElement>('input[name="content_id"]', form);
  const hashInput = qs<HTMLInputElement>('input[name="body_hash"]', form);
  const titleInput = qs<HTMLInputElement>('input[name="title"]', form);
  const descriptionInput = qs<HTMLInputElement>('input[name="description"]', form);
  const categoryInput = qs<HTMLInputElement>('input[name="category"]', form);
  const tagsInput = qs<HTMLInputElement>('input[name="tags"]', form);
  const bodyInput = qs<HTMLTextAreaElement>('textarea[name="body"]', form);
  if (idInput) idInput.value = String(detail.id);
  if (hashInput) hashInput.value = detail.body_hash;
  if (titleInput) titleInput.value = String(detail.frontmatter.title ?? detail.title ?? "");
  if (descriptionInput) descriptionInput.value = String(detail.frontmatter.description ?? "");
  if (categoryInput) categoryInput.value = String(detail.frontmatter.category ?? "");
  if (tagsInput) tagsInput.value = Array.isArray(detail.frontmatter.tags) ? detail.frontmatter.tags.join(", ") : "";
  if (bodyInput) bodyInput.value = detail.body;
  qsa<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button", form).forEach((field) => {
    field.disabled = !detail.is_editable;
  });
  if (!detail.is_editable) {
    setStatus(form, "This is an inventory-only chapter record. Split it into a dedicated Markdown file before editing.", "error");
  } else {
    setStatus(form, "Editing source Markdown. Production output requires a rebuild after saving.", "neutral");
  }
  scheduleEditorPreview(form);
}

function bringEditorIntoView(root: HTMLElement): void {
  const target = qs<HTMLElement>("[data-editor-form]", root) ?? qs<HTMLElement>(".editor-workbench", root);
  if (!target) return;
  window.requestAnimationFrame(() => {
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
    qs<HTMLElement>('textarea[name="body"]', target)?.focus({ preventScroll: true });
  });
}

async function setupEditorPage(): Promise<void> {
  const root = qs<HTMLElement>("[data-editor-page]");
  if (!root) return;
  if (root.dataset.editorReady === "true") return;
  root.dataset.editorReady = "true";

  const loading = qs<HTMLElement>("[data-editor-loading]", root);
  const signedOut = qs<HTMLElement>("[data-editor-signed-out]", root);
  const list = qs<HTMLElement>("[data-editor-list]", root);
  const form = qs<HTMLFormElement>("[data-editor-form]", root);
  const params = new URLSearchParams(window.location.search);
  const contentId = params.get("content_id");
  const route = params.get("route");

  try {
    const response = await withApiTimeout(
      apiFetch<{ items: ContentItem[] }>("/api/editor/content"),
      "The editor backend did not answer within 8 seconds. Check the FastAPI server, session cookie, and /api proxy before retrying."
    );
    setHidden(loading, true);
    setHidden(list, false);
    if (list) renderEditorList(list, response.items);

    const selectedContentId = resolveEditorContentId(response.items, contentId, route);
    if (selectedContentId) {
      const detail = await withApiTimeout(
        apiFetch<ContentDetail>(`/api/editor/content/${selectedContentId}`),
        "The selected Markdown file did not load within 8 seconds. The backend may be unavailable or blocked by credentials."
      );
      writeEditorForm(root, detail);
      qs<HTMLElement>(`[data-content-id="${selectedContentId}"]`, list ?? root)?.classList.add("content-permission-item--selected");
      if (!contentId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("content_id", selectedContentId);
        nextUrl.searchParams.delete("route");
        window.history.replaceState(null, "", nextUrl);
      }
      bringEditorIntoView(root);
    } else if (route) {
      setText(
        qs("[data-editor-path]", root),
        `No editable backend content record matched ${route}. Run an admin content scan or assign maintainer access.`
      );
    }
  } catch (error) {
    setHidden(loading, true);
    setHidden(signedOut, false);
    const message = formatApiError(error);
    setText(qs("[data-editor-error-message]", root), message);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const contentIdValue = formValue(form, "content_id");
    if (!contentIdValue) return;
    const tags = formValue(form, "tags")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const payload = {
      body_hash: formValue(form, "body_hash"),
      frontmatter: {
        title: formValue(form, "title"),
        description: formValue(form, "description"),
        category: formValue(form, "category"),
        tags
      },
      body: formValue(form, "body")
    };
    setFormBusy(form, true);
    setStatus(form, "Saving Markdown source...", "neutral");

    try {
      const detail = await apiFetch<ContentDetail>(`/api/editor/content/${contentIdValue}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      writeEditorForm(root, detail);
      setStatus(form, "Saved source Markdown. Run npm build before deploying static output.", "success");
    } catch (error) {
      setStatus(form, formatApiError(error), "error");
    } finally {
      setFormBusy(form, false);
    }
  });
}

function setupAuthInteractions(): void {
  setupApiDiagnostics();
  setupAuthForms();
  setupLogoutButtons();
  void setupDashboard();
  setupPasswordChange();
  void setupAdminPages();
  void setupEditorPage();
}

setupAuthInteractions();
document.addEventListener("astro:page-load", setupAuthInteractions);
