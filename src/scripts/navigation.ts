import { navigate } from "astro:transitions/client";
import { apiFetch } from "./api";

const mobileQuery = window.matchMedia("(max-width: 920px)");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const paletteValues = ["paper", "rain", "milk", "hoodie", "sage"] as const;
let headerOffsetFrame = 0;
let lastFlyInPath = "";
let roomLightFrame = 0;
let pendingPageFlyIn = false;
const pageExchangeDuration = 1120;

type PaletteName = (typeof paletteValues)[number];
type ThemeMode = "light" | "dark";
type PageExitSnapshot = {
  html: string;
  className: string;
  left: number;
  top: number;
  width: number;
  height: number;
  motion: ReturnType<typeof organicMotion>;
};

declare global {
  interface Window {
    __nanatoSharedAudio?: HTMLAudioElement;
    __nanatoNavigateLink?: (event: MouseEvent, link: HTMLAnchorElement) => void;
  }
}

const themeStorageKey = "nanato-theme";
const paletteStorageKey = "nanato-palette";

function readCookieValue(name: string): string | null {
  const encodedName = `${encodeURIComponent(name)}=`;
  const pair = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(encodedName));
  if (!pair) return null;

  try {
    return decodeURIComponent(pair.slice(encodedName.length));
  } catch {
    return null;
  }
}

function writeCookieValue(name: string, value: string): void {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function isPaletteName(value: string | null | undefined): value is PaletteName {
  return Boolean(value && paletteValues.includes(value as PaletteName));
}

function readStoredVisualState(): { theme: ThemeMode; palette: PaletteName } {
  let savedTheme: string | null = null;
  let savedPalette: string | null = null;

  try {
    savedTheme = window.localStorage.getItem(themeStorageKey);
    savedPalette = window.localStorage.getItem(paletteStorageKey);
  } catch {
    savedTheme = null;
    savedPalette = null;
  }

  savedTheme ??= readCookieValue(themeStorageKey);
  savedPalette ??= readCookieValue(paletteStorageKey);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    theme: savedTheme === "light" || savedTheme === "dark" ? savedTheme : prefersDark ? "dark" : "light",
    palette: isPaletteName(savedPalette) ? savedPalette : "paper"
  };
}

function persistVisualState(theme: ThemeMode, palette: PaletteName): void {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
    window.localStorage.setItem(paletteStorageKey, palette);
  } catch {
    // Cookie fallback keeps the visual state stable in restricted browser contexts.
  }

  writeCookieValue(themeStorageKey, theme);
  writeCookieValue(paletteStorageKey, palette);
}

function applyDocumentVisualState(theme: ThemeMode, palette: PaletteName): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.mode = theme;
  document.documentElement.dataset.palette = palette;
}

function applyStoredVisualState(): { theme: ThemeMode; palette: PaletteName } {
  const state = readStoredVisualState();
  applyDocumentVisualState(state.theme, state.palette);
  return state;
}

function pulseRoomLight(mode: ThemeMode): void {
  const layer = document.querySelector<HTMLElement>("[data-room-light-layer]");
  if (!layer || motionQuery.matches) return;

  layer.classList.remove(
    "room-light-layer--window-on",
    "room-light-layer--lamp-dim",
    "room-light-layer--pulse",
    "room-light-layer--dimming"
  );
  void layer.offsetWidth;
  layer.classList.add(mode === "light" ? "room-light-layer--window-on" : "room-light-layer--lamp-dim");
  window.setTimeout(
    () =>
      layer.classList.remove(
        "room-light-layer--window-on",
        "room-light-layer--lamp-dim",
        "room-light-layer--pulse",
        "room-light-layer--dimming"
      ),
    2300
  );
}

function setupRoomLighting(): void {
  const layer = document.querySelector<HTMLElement>("[data-room-light-layer]");
  if (!layer || layer.dataset.roomLightReady === "true") return;
  layer.dataset.roomLightReady = "true";

  let targetX = 33;
  let targetY = 46;
  let currentX = targetX;
  let currentY = targetY;
  let currentScroll = Math.min(1, window.scrollY / Math.max(window.innerHeight, 1));

  const render = (): void => {
    roomLightFrame = 0;
    currentX += (targetX - currentX) * 0.045;
    currentY += (targetY - currentY) * 0.045;
    currentScroll += (Math.min(1, window.scrollY / Math.max(window.innerHeight, 1)) - currentScroll) * 0.045;
    layer.style.setProperty("--room-light-x", `${currentX.toFixed(2)}%`);
    layer.style.setProperty("--room-light-y", `${currentY.toFixed(2)}%`);
    layer.style.setProperty("--room-light-scroll", currentScroll.toFixed(3));
    const lightTheme = document.documentElement.dataset.theme !== "dark" && document.documentElement.dataset.mode !== "dark";
    const alpha = lightTheme ? 0.24 + currentScroll * 0.05 : 0.08 + currentScroll * 0.025;
    layer.style.setProperty("--room-light-alpha", alpha.toFixed(3));

    if (
      Math.abs(targetX - currentX) > 0.05 ||
      Math.abs(targetY - currentY) > 0.05 ||
      Math.abs(Math.min(1, window.scrollY / Math.max(window.innerHeight, 1)) - currentScroll) > 0.02
    ) {
      roomLightFrame = window.requestAnimationFrame(render);
    }
  };

  const requestRender = (): void => {
    if (!roomLightFrame) roomLightFrame = window.requestAnimationFrame(render);
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      const pointerX = (event.clientX / Math.max(window.innerWidth, 1)) * 100;
      const pointerY = (event.clientY / Math.max(window.innerHeight, 1)) * 100;
      targetX = Math.max(16, Math.min(76, 33 + (pointerX - 50) * 0.12));
      targetY = Math.max(20, Math.min(70, 46 + (pointerY - 50) * 0.1));
      requestRender();
    },
    { passive: true }
  );

  window.addEventListener("scroll", requestRender, { passive: true });
  requestRender();
}

const revealSelectors = [
  ".studio-hero",
  ".home-feature-strip",
  ".feature-tile",
  ".studio-section",
  ".studio-card",
  ".studio-panel",
  ".index-hero",
  ".featured-document",
  ".doc-group",
  ".directory-card",
  ".library-hero",
  ".library-pathway",
  ".library-feature-manual",
  ".projects-hero",
  ".project-feature",
  ".project-track-item",
  ".about-hero",
  ".about-principles article",
  ".blog-journal-hero",
  ".blog-feature-section",
  ".blog-featured-post",
  ".blog-journal-grid",
  ".blog-note-card",
  ".blog-upcoming-card",
  ".blog-note__header",
  ".blog-note__body-shell",
  ".lab-hero",
  ".app-card",
  ".utility-hero",
  ".dashboard-card",
  ".dashboard-panel",
  ".music-room__hero",
  ".music-room__panel",
  ".docs-article__header",
  ".manual-chapter-stack__intro",
  ".manual-chapter",
  ".download-vault",
  ".aiformula-figure",
  ".article-navigation"
];

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

type HeaderMenuName = "project" | "account" | "palette";

function setHeaderMenuState(menu: HeaderMenuName | null): void {
  if (menu) {
    document.documentElement.dataset.headerMenu = menu;
    return;
  }

  delete document.documentElement.dataset.headerMenu;
}

function closeHeaderPopovers(except?: HeaderMenuName): void {
  if (except !== "project") {
    const projectRoot = document.querySelector<HTMLElement>("[data-project-menu-root]");
    projectRoot?.removeAttribute("data-project-menu-open");
    projectRoot?.querySelector<HTMLButtonElement>("[data-project-menu-toggle]")?.setAttribute("aria-expanded", "false");
    projectRoot?.querySelector<HTMLElement>("[data-project-menu-panel]")?.setAttribute("aria-hidden", "true");
  }

  if (except !== "account") {
    const accountRoot = document.querySelector<HTMLElement>("[data-account-menu]");
    accountRoot?.removeAttribute("data-account-menu-open");
    accountRoot?.querySelector<HTMLButtonElement>("[data-account-menu-toggle]")?.setAttribute("aria-expanded", "false");
    accountRoot?.querySelector<HTMLElement>("[data-account-menu-panel]")?.setAttribute("aria-hidden", "true");
  }

  if (except !== "palette") {
    document.querySelector<HTMLElement>(".visual-controls--palette-menu")?.removeAttribute("data-palette-menu-open");
  }

  if (!except) setHeaderMenuState(null);
}

function decodeHashId(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function cssEscape(value: string): string {
  if ("CSS" in window && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function manualChapterForAnchor(anchor: string): HTMLElement | null {
  if (!anchor) return null;
  return document.querySelector<HTMLElement>(`[data-manual-chapter-anchor="${cssEscape(anchor)}"]`);
}

function openManualChapterForTarget(target: Element | null): void {
  const chapter = target?.closest<HTMLElement>("[data-manual-chapter]")
    ?? (target instanceof HTMLElement ? manualChapterForAnchor(target.id) : null);
  const details = chapter?.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
  if (!chapter || !details) return;

  if (!details.open) details.open = true;
  chapter.setAttribute("data-manual-chapter-active", "");
  window.setTimeout(() => chapter.removeAttribute("data-manual-chapter-active"), 1400);
}

function setHeaderOffset(): void {
  const header = document.querySelector<HTMLElement>(".site-header");
  const height = header?.offsetHeight ?? 0;
  document.documentElement.style.setProperty("--site-scroll-offset", `${height + 18}px`);
}

function requestHeaderOffset(): void {
  if (headerOffsetFrame) return;
  headerOffsetFrame = window.requestAnimationFrame(() => {
    headerOffsetFrame = 0;
    setHeaderOffset();
  });
}

function setupHeaderState(): void {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (!header) return;
  if (header.dataset.headerReady === "true") return;
  header.dataset.headerReady = "true";

  let ticking = false;
  const update = (): void => {
    header.toggleAttribute("data-scrolled", window.scrollY > 8);
  };

  const requestUpdate = (): void => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  };

  update();
  window.addEventListener("scroll", requestUpdate, { passive: true });
}

function setupNavigation(): void {
  const body = document.body;
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  const panel = document.querySelector<HTMLElement>("[data-nav-panel]");
  const closeButton = document.querySelector<HTMLButtonElement>("[data-nav-close]");

  if (!toggle || !panel) return;
  if (toggle.dataset.navReady === "true") return;
  toggle.dataset.navReady = "true";

  const syncPanelAccessibility = (open: boolean): void => {
    if (mobileQuery.matches) {
      panel.toggleAttribute("inert", !open);
      panel.setAttribute("aria-hidden", String(!open));
      return;
    }

    panel.removeAttribute("inert");
    panel.removeAttribute("aria-hidden");
  };

  const setOpen = (open: boolean): void => {
    body.classList.toggle("has-open-mobile-nav", open);
    panel.toggleAttribute("data-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    closeButton?.toggleAttribute("hidden", !open);
    syncPanelAccessibility(open);
  };

  toggle.addEventListener("click", () => {
    setOpen(!body.classList.contains("has-open-mobile-nav"));
  });

  closeButton?.addEventListener("click", () => setOpen(false));

  panel.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (target?.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !body.classList.contains("has-open-mobile-nav")) return;
    setOpen(false);
    toggle.focus();
  });

  mobileQuery.addEventListener("change", () => setOpen(false));
  setOpen(false);
}

function setupProjectMenu(): void {
  const root = document.querySelector<HTMLElement>("[data-project-menu-root]");
  const toggle = root?.querySelector<HTMLButtonElement>("[data-project-menu-toggle]");
  const panel = root?.querySelector<HTMLElement>("[data-project-menu-panel]");
  if (!root || !toggle || !panel) return;
  if (root.dataset.projectMenuReady === "true") return;
  root.dataset.projectMenuReady = "true";

  let closeTimer = 0;

  const clearTimers = (): void => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const setOpen = (open: boolean): void => {
    clearTimers();
    if (open) {
      closeHeaderPopovers("project");
      setHeaderMenuState("project");
    } else if (document.documentElement.dataset.headerMenu === "project") {
      setHeaderMenuState(null);
    }
    root.toggleAttribute("data-project-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
  };

  const scheduleClose = (): void => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => setOpen(false), motionQuery.matches ? 0 : 90);
  };

  root.addEventListener("pointerenter", () => setOpen(true));
  root.addEventListener("pointerleave", scheduleClose);
  root.addEventListener("mouseenter", () => setOpen(true));
  root.addEventListener("mouseleave", scheduleClose);
  panel.addEventListener("pointerenter", () => setOpen(true));
  panel.addEventListener("pointerleave", scheduleClose);
  panel.addEventListener("mouseenter", () => setOpen(true));
  panel.addEventListener("mouseleave", scheduleClose);
  root.addEventListener("focusin", (event) => {
    const target = asElement(event.target);
    if (target?.closest("[data-project-menu-toggle]")) return;
    setOpen(true);
  });
  root.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) scheduleClose();
    }, 0);
  });
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(mobileQuery.matches ? !root.hasAttribute("data-project-menu-open") : true);
  });
  panel.addEventListener("click", (event) => {
    const link = asElement(event.target)?.closest<HTMLAnchorElement>("[data-project-menu-link]");
    if (!link) return;

    const beforeNavigation = window.location.href;
    setOpen(false);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target
    ) {
      return;
    }

    window.setTimeout(() => {
      if (window.location.href === beforeNavigation) window.location.assign(link.href);
    }, 180);
  });
  document.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (!target || root.contains(target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !root.hasAttribute("data-project-menu-open")) return;
    setOpen(false);
    toggle.focus();
  });
  setOpen(false);
}

type AccountUser = {
  username: string;
  role: string;
};

function setupAccountMenu(): void {
  const root = document.querySelector<HTMLElement>("[data-account-menu]");
  const toggle = root?.querySelector<HTMLButtonElement>("[data-account-menu-toggle]");
  const label = root?.querySelector<HTMLElement>("[data-account-menu-label]");
  const panel = root?.querySelector<HTMLElement>("[data-account-menu-panel]");
  const guestItems = Array.from(root?.querySelectorAll<HTMLElement>("[data-account-guest]") ?? []);
  const signedInItems = Array.from(root?.querySelectorAll<HTMLElement>("[data-account-signed-in]") ?? []);
  const signOut = root?.querySelector<HTMLButtonElement>("[data-account-signout]");

  if (!root || !toggle || !panel) return;
  if (root.dataset.accountMenuReady === "true") return;
  root.dataset.accountMenuReady = "true";

  let closeTimer = 0;

  const clearCloseTimer = (): void => {
    if (!closeTimer) return;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const setOpen = (open: boolean): void => {
    clearCloseTimer();
    if (open) {
      closeHeaderPopovers("account");
      setHeaderMenuState("account");
    } else if (document.documentElement.dataset.headerMenu === "account") {
      setHeaderMenuState(null);
    }
    root.toggleAttribute("data-account-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
  };

  const scheduleClose = (): void => {
    clearCloseTimer();
    closeTimer = window.setTimeout(() => setOpen(false), motionQuery.matches ? 0 : 90);
  };

  const setAuthenticated = (authenticated: boolean, user?: AccountUser): void => {
    root.dataset.authState = authenticated ? "signed-in" : "guest";
    if (label) label.textContent = authenticated ? "Workspace" : "Sign in";
    toggle.setAttribute(
      "aria-label",
      authenticated
        ? `Account menu for ${user?.username ?? "signed-in user"}`
        : "Sign in or create an account"
    );
    guestItems.forEach((item) => {
      item.hidden = authenticated;
    });
    signedInItems.forEach((item) => {
      item.hidden = !authenticated;
    });
  };

  const refreshAuthState = async (): Promise<void> => {
    try {
      const user = await apiFetch<AccountUser>("/api/auth/me");
      setAuthenticated(true, user);
    } catch {
      setAuthenticated(false);
    }
  };

  root.addEventListener("pointerenter", () => setOpen(true));
  root.addEventListener("pointerleave", scheduleClose);
  root.addEventListener("focusin", (event) => {
    const target = asElement(event.target);
    if (target?.closest("[data-account-menu-toggle]")) return;
    setOpen(true);
  });
  root.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) scheduleClose();
    }, 0);
  });
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(mobileQuery.matches ? !root.hasAttribute("data-account-menu-open") : true);
  });
  panel.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (!target?.closest("a, button")) return;
    setOpen(false);
  });
  document.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (!target || root.contains(target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !root.hasAttribute("data-account-menu-open")) return;
    setOpen(false);
    toggle.focus();
  });

  signOut?.addEventListener("click", async () => {
    signOut.disabled = true;
    signOut.textContent = "Signing out";
    try {
      await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // The backend may already have expired the session; still reset the public account surface.
    } finally {
      signOut.disabled = false;
      signOut.textContent = "Sign out";
      setAuthenticated(false);
      setOpen(false);
      if (window.location.pathname.startsWith("/dashboard") || window.location.pathname.startsWith("/admin")) {
        window.location.assign("/login/");
      }
    }
  });

  setAuthenticated(false);
  void refreshAuthState();
}

function setupSmoothHashScroll(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = asElement(event.target)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;

    const hash = link.getAttribute("href");
    if (!hash || hash === "#") return;

    const target = document.getElementById(decodeHashId(hash.slice(1)));
    if (!target) return;

    event.preventDefault();
    openManualChapterForTarget(target);
    const offset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--site-scroll-offset")
    );
    const top = Math.max(target.getBoundingClientRect().top + window.scrollY - (offset || 0), 0);

    window.scrollTo({
      top,
      behavior: motionQuery.matches ? "auto" : "smooth"
    });
    window.history.replaceState(null, "", hash);
  });
}

function setupDownloadVaultState(): void {
  document.querySelectorAll<HTMLDetailsElement>(".download-vault").forEach((vault) => {
    const summary = vault.querySelector<HTMLElement>(":scope > summary");
    if (!summary) return;
    if (vault.dataset.downloadVaultReady === "true") return;
    vault.dataset.downloadVaultReady = "true";

    summary.setAttribute("aria-expanded", String(vault.open));
    vault.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", String(vault.open));
    });
  });
}

function setupManualChapters(): void {
  const chapters = Array.from(document.querySelectorAll<HTMLElement>("[data-manual-chapter]"));
  if (chapters.length === 0) return;
  const outlineLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-manual-outline-link]"));
  const expandAll = document.querySelector<HTMLButtonElement>("[data-manual-expand-all]");
  const collapseAll = document.querySelector<HTMLButtonElement>("[data-manual-collapse-all]");
  const chapterAnimations = new WeakMap<HTMLDetailsElement, Animation>();
  let ticking = false;

  const syncChapter = (chapter: HTMLElement, details: HTMLDetailsElement): void => {
    const summary = details.querySelector<HTMLElement>(":scope > summary");
    chapter.toggleAttribute("data-manual-chapter-open", details.open);
    summary?.setAttribute("aria-expanded", String(details.open));
  };

  const setChapterOpen = (chapter: HTMLElement, details: HTMLDetailsElement, open: boolean, animate = true): void => {
    chapterAnimations.get(details)?.cancel();

    const summary = details.querySelector<HTMLElement>(":scope > summary");
    const body = details.querySelector<HTMLElement>(".manual-chapter__body");
    if (!summary || !body || motionQuery.matches || !animate) {
      details.open = open;
      syncChapter(chapter, details);
      if (open) {
        chapter.setAttribute("data-manual-chapter-active", "");
        window.setTimeout(() => chapter.removeAttribute("data-manual-chapter-active"), 1400);
      }
      return;
    }

    const startHeight = details.offsetHeight || summary.offsetHeight;
    if (open) details.open = true;
    syncChapter(chapter, details);

    const endHeight = open ? summary.offsetHeight + body.offsetHeight : summary.offsetHeight;
    details.classList.add("manual-chapter__details--animating");
    details.style.height = `${startHeight}px`;
    details.style.overflow = "hidden";

    const animation = details.animate(
      {
        height: [`${startHeight}px`, `${endHeight}px`],
        opacity: open ? [0.84, 1] : [1, 0.92]
      },
      {
        duration: 360,
        easing: "cubic-bezier(0.16, 0.86, 0.22, 1)"
      }
    );

    chapterAnimations.set(details, animation);
    window.requestAnimationFrame(() => {
      details.style.height = `${endHeight}px`;
    });

    animation.onfinish = () => {
      if (!open) details.open = false;
      details.style.height = "";
      details.style.overflow = "";
      details.classList.remove("manual-chapter__details--animating");
      chapterAnimations.delete(details);
      syncChapter(chapter, details);
      requestOutlineUpdate();
    };

    animation.oncancel = () => {
      details.style.height = "";
      details.style.overflow = "";
      details.classList.remove("manual-chapter__details--animating");
      chapterAnimations.delete(details);
      syncChapter(chapter, details);
    };

    if (open) {
      chapter.setAttribute("data-manual-chapter-active", "");
      window.setTimeout(() => chapter.removeAttribute("data-manual-chapter-active"), 1400);
    }
  };

  const setCurrentOutline = (chapter: HTMLElement | null): void => {
    if (outlineLinks.length === 0) return;
    const anchor = chapter?.dataset.manualChapterAnchor ?? outlineLinks[0]?.hash.slice(1);

    outlineLinks.forEach((link) => {
      const isCurrent = decodeHashId(link.hash.slice(1)) === anchor;
      link.classList.toggle("manual-outline__link--active", isCurrent);
      if (isCurrent) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const updateOutlineFromScroll = (): void => {
    const offset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--site-scroll-offset")
    );
    const marker = window.scrollY + (offset || 0) + 36;
    let current = chapters[0];

    for (const chapter of chapters) {
      if (chapter.offsetTop <= marker) {
        current = chapter;
      } else {
        break;
      }
    }

    setCurrentOutline(current);
  };

  const requestOutlineUpdate = (): void => {
    if (outlineLinks.length === 0 || ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      updateOutlineFromScroll();
    });
  };

  chapters.forEach((chapter) => {
    const details = chapter.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
    if (!details) return;
    if (details.dataset.manualChapterReady === "true") return;
    details.dataset.manualChapterReady = "true";

    const summary = details.querySelector<HTMLElement>(":scope > summary");
    summary?.setAttribute("aria-expanded", String(details.open));
    summary?.addEventListener("click", (event) => {
      event.preventDefault();
      setChapterOpen(chapter, details, !details.open);
    });
    details.addEventListener("toggle", () => syncChapter(chapter, details));
  });

  expandAll?.addEventListener("click", () => {
    chapters.forEach((chapter) => {
      const details = chapter.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
      if (!details) return;
      setChapterOpen(chapter, details, true, false);
    });
  });

  collapseAll?.addEventListener("click", () => {
    chapters.forEach((chapter) => {
      const details = chapter.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
      if (!details) return;
      setChapterOpen(chapter, details, false, false);
    });
    requestOutlineUpdate();
  });

  outlineLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const id = decodeHashId(link.hash.slice(1));
      const chapter = manualChapterForAnchor(id);
      setCurrentOutline(chapter);
      const details = chapter?.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
      if (chapter && details) setChapterOpen(chapter, details, true);
    });
  });

  const openFromHash = (): void => {
    const id = decodeHashId(window.location.hash.slice(1));
    if (!id) return;

    const target = document.getElementById(id);
    const chapter = target ? target.closest<HTMLElement>("[data-manual-chapter]") : manualChapterForAnchor(id);
    const details = chapter?.querySelector<HTMLDetailsElement>("[data-manual-chapter-details]");
    if (!chapter || !details) return;

    if (!details.open) setChapterOpen(chapter, details, true, false);
    syncChapter(chapter, details);
    setCurrentOutline(chapter);
  };

  openFromHash();
  window.addEventListener("hashchange", openFromHash);
  window.addEventListener("scroll", requestOutlineUpdate, { passive: true });
  window.addEventListener("resize", requestOutlineUpdate);
  updateOutlineFromScroll();
}

function setupDocsRail(): void {
  const rail = document.querySelector<HTMLElement>("[data-docs-rail]");
  const toggle = document.querySelector<HTMLButtonElement>("[data-docs-rail-toggle]");
  const panel = rail?.querySelector<HTMLElement>("[data-docs-rail-panel]");
  if (!rail || !toggle) return;
  if (rail.dataset.docsRailReady === "true") return;
  rail.dataset.docsRailReady = "true";

  const links = Array.from(rail.querySelectorAll<HTMLAnchorElement>("[data-docs-rail-link]"));
  const chapters = links
    .map((link) => {
      const id = decodeHashId(link.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      const chapter = id ? manualChapterForAnchor(id) : null;
      const marker = chapter ?? target;
      return marker ? { link, marker, target } : null;
    })
    .filter(Boolean) as Array<{ link: HTMLAnchorElement; marker: HTMLElement; target: HTMLElement | null }>;

  let closeTimer = 0;
  let panelHideTimer = 0;
  let ticking = false;

  const clearCloseTimer = (): void => {
    if (!closeTimer) return;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const clearPanelHideTimer = (): void => {
    if (!panelHideTimer) return;
    window.clearTimeout(panelHideTimer);
    panelHideTimer = 0;
  };

  const setCurrent = (current?: HTMLAnchorElement): void => {
    const active = current ?? links[0];

    links.forEach((link) => {
      const isCurrent = link === active;
      link.classList.toggle("docs-rail__link--active", isCurrent);
      if (isCurrent) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const updateCurrentFromScroll = (): void => {
    if (chapters.length === 0) {
      setCurrent();
      return;
    }

    const offset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--site-scroll-offset")
    );
    const marker = window.scrollY + (offset || 0) + 32;
    let current = chapters[0];

    for (const chapter of chapters) {
      if (chapter.marker.offsetTop <= marker) {
        current = chapter;
      } else {
        break;
      }
    }

    setCurrent(current.link);
  };

  const setOpen = (open: boolean): void => {
    clearCloseTimer();
    clearPanelHideTimer();
    if (open && panel) panel.hidden = false;
    rail.toggleAttribute("data-docs-rail-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel?.toggleAttribute("inert", !open);
    panel?.setAttribute("aria-hidden", String(!open));
    if (open) updateCurrentFromScroll();
    if (!open && panel) {
      const hideDelay = motionQuery.matches ? 0 : 240;
      panelHideTimer = window.setTimeout(() => {
        if (!rail.hasAttribute("data-docs-rail-open")) panel.hidden = true;
        panelHideTimer = 0;
      }, hideDelay);
    }
  };

  const scheduleClose = (): void => {
    clearCloseTimer();
    closeTimer = window.setTimeout(() => setOpen(false), motionQuery.matches ? 0 : 850);
  };

  const requestCurrentUpdate = (): void => {
    if (!rail.hasAttribute("data-docs-rail-open") || ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      updateCurrentFromScroll();
    });
  };

  toggle.addEventListener("click", () => setOpen(true));
  rail.addEventListener("pointerenter", () => setOpen(true));
  rail.addEventListener("pointerleave", scheduleClose);
  rail.addEventListener("focusin", () => setOpen(true));
  rail.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!rail.contains(document.activeElement)) scheduleClose();
    }, 0);
  });
  rail.addEventListener("click", (event) => {
    const chapterLink = asElement(event.target)?.closest<HTMLAnchorElement>("[data-docs-rail-link]");
    if (chapterLink) {
      setCurrent(chapterLink);
      const target = document.getElementById(decodeHashId(chapterLink.hash.slice(1)));
      openManualChapterForTarget(target);
      if (mobileQuery.matches) scheduleClose();
    }
  });

  document.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (target?.closest("[data-docs-rail]")) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !rail.hasAttribute("data-docs-rail-open")) return;
    setOpen(false);
    toggle.focus();
  });
  window.addEventListener("hashchange", updateCurrentFromScroll);
  window.addEventListener("scroll", requestCurrentUpdate, { passive: true });
  window.addEventListener("resize", requestCurrentUpdate);

  updateCurrentFromScroll();
  setOpen(false);
}

function setupSiteSearch(): void {
  const root = document.querySelector<HTMLFormElement>("[data-site-search]");
  const input = root?.querySelector<HTMLInputElement>("[data-site-search-input]");
  const results = root?.querySelector<HTMLElement>("[data-site-search-results]");
  const empty = root?.querySelector<HTMLElement>("[data-search-empty]");
  const items = Array.from(root?.querySelectorAll<HTMLAnchorElement>("[data-search-item]") ?? []);
  if (!root || !input || !results || !empty || items.length === 0) return;
  if (root.dataset.siteSearchReady === "true") return;
  root.dataset.siteSearchReady = "true";

  let resultsHideTimer = 0;

  const clearResultsHideTimer = (): void => {
    if (!resultsHideTimer) return;
    window.clearTimeout(resultsHideTimer);
    resultsHideTimer = 0;
  };

  const setCompactSearchActive = (active: boolean): void => {
    root.toggleAttribute("data-search-active", active);
  };

  const shouldKeepCompactSearchOpen = (): boolean =>
    Boolean(input.value.trim()) || root.contains(document.activeElement) || root.matches(":hover");

  const setOpen = (open: boolean): void => {
    clearResultsHideTimer();
    if (open) results.hidden = false;
    root.toggleAttribute("data-search-open", open);
    input.setAttribute("aria-expanded", String(open));
    results.toggleAttribute("inert", !open);
    results.setAttribute("aria-hidden", String(!open));
    setCompactSearchActive(open || shouldKeepCompactSearchOpen());
    if (!open) {
      const hideDelay = motionQuery.matches ? 0 : 160;
      resultsHideTimer = window.setTimeout(() => {
        if (!root.hasAttribute("data-search-open")) results.hidden = true;
        resultsHideTimer = 0;
      }, hideDelay);
    }
  };

  const firstVisibleResult = (): HTMLAnchorElement | undefined => items.find((item) => !item.hidden);

  const submitFirstResult = (): void => {
    const firstResult = firstVisibleResult();
    if (firstResult) window.location.href = firstResult.href;
  };

  const updateResults = (): void => {
    const query = input.value.trim().toLowerCase();
    let visibleCount = 0;

    items.forEach((item) => {
      const isMatch = query.length > 0 && Boolean(item.dataset.searchText?.includes(query));
      item.hidden = !isMatch || visibleCount >= 6;
      if (isMatch) visibleCount += 1;
    });

    empty.hidden = query.length === 0 || visibleCount > 0;
    setOpen(query.length > 0);
  };

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    submitFirstResult();
  });
  input.addEventListener("input", updateResults);
  input.addEventListener("focus", () => {
    setCompactSearchActive(true);
    if (input.value.trim()) setOpen(true);
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => setCompactSearchActive(shouldKeepCompactSearchOpen()), 80);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      updateResults();
      input.blur();
      return;
    }

    if (event.key !== "Enter") return;
    if (firstVisibleResult()) {
      event.preventDefault();
      submitFirstResult();
    }
  });
  root.addEventListener("pointerenter", () => {
    setCompactSearchActive(true);
    if (input.value.trim()) setOpen(true);
  });
  root.addEventListener("pointerleave", () => {
    if (!root.contains(document.activeElement)) {
      setOpen(false);
      setCompactSearchActive(false);
    }
  });
  document.addEventListener("click", (event) => {
    const target = asElement(event.target);
    if (target && root.contains(target)) return;
    setOpen(false);
    setCompactSearchActive(false);
  });
  window.addEventListener("resize", () => setCompactSearchActive(shouldKeepCompactSearchOpen()));
  setOpen(false);
}

type EditableContentItem = {
  id: number;
  route_path: string;
  slug: string;
  is_editable: boolean;
};

type InlineContentDetail = EditableContentItem & {
  title: string;
  file_path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  body_hash: string;
};

let inlineEditorDetail: InlineContentDetail | null = null;
let inlineMarkdownRenderer: { render(source: string): string } | null = null;

function normalizeRoutePath(value: string): string {
  if (!value) return "";
  const [path, hash = ""] = value.split("#");
  const normalizedPath = path.endsWith("/") ? path : `${path}/`;
  return hash ? `${normalizedPath}#${hash}` : normalizedPath;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderInlineMarkdown(source: string): Promise<string> {
  if (!inlineMarkdownRenderer) {
    const markdownIt = await import("markdown-it");
    inlineMarkdownRenderer = new markdownIt.default({
      html: false,
      linkify: true,
      typographer: true
    });
  }
  return inlineMarkdownRenderer.render(source);
}

function inlineEditorElements(): {
  drawer: HTMLElement;
  title: HTMLElement | null;
  path: HTMLElement | null;
  textarea: HTMLTextAreaElement | null;
  preview: HTMLElement | null;
  status: HTMLElement | null;
  save: HTMLButtonElement | null;
} {
  let drawer = document.querySelector<HTMLElement>("[data-inline-editor]");
  if (!drawer) {
    drawer = document.createElement("aside");
    drawer.className = "inline-editor-drawer";
    drawer.dataset.inlineEditor = "";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "In-page Markdown editor");
    drawer.tabIndex = -1;
    drawer.innerHTML = `
      <header class="inline-editor-drawer__header">
        <div>
          <p class="eyebrow">Live editor</p>
          <h2 data-inline-editor-title>Select source</h2>
          <p data-inline-editor-path>Backend-authorized Markdown source.</p>
        </div>
        <button class="inline-editor-drawer__close" type="button" data-inline-editor-close aria-label="Close editor">Close</button>
      </header>
      <div class="inline-editor-drawer__tools" aria-label="Markdown tools">
        <button type="button" data-inline-editor-insert="heading">Heading</button>
        <button type="button" data-inline-editor-insert="bold">Bold</button>
        <button type="button" data-inline-editor-insert="code">Code</button>
        <button type="button" data-inline-editor-insert="image">Image</button>
        <button type="button" data-inline-editor-insert="link">Link</button>
        <button type="button" data-inline-editor-view="raw">Raw MD</button>
      </div>
      <div class="inline-editor-drawer__status" data-inline-editor-status aria-live="polite">Open an edit button to load source Markdown.</div>
      <label class="inline-editor-drawer__source">
        <span>Markdown source</span>
        <textarea data-inline-editor-body rows="18" spellcheck="false"></textarea>
      </label>
      <section class="inline-editor-drawer__preview markdown-content" data-inline-editor-preview aria-label="Live Markdown preview"></section>
      <footer class="inline-editor-drawer__footer">
        <button class="button button--primary" type="button" data-inline-editor-save>Save source</button>
      </footer>
    `;
    document.body.append(drawer);

    const createdDrawer = drawer;
    createdDrawer.querySelector<HTMLButtonElement>("[data-inline-editor-close]")?.addEventListener("click", () => {
      createdDrawer.hidden = true;
      document.documentElement.removeAttribute("data-inline-editor-open");
    });
    createdDrawer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      createdDrawer.hidden = true;
      document.documentElement.removeAttribute("data-inline-editor-open");
    });
  }

  return {
    drawer,
    title: drawer.querySelector("[data-inline-editor-title]"),
    path: drawer.querySelector("[data-inline-editor-path]"),
    textarea: drawer.querySelector("[data-inline-editor-body]"),
    preview: drawer.querySelector("[data-inline-editor-preview]"),
    status: drawer.querySelector("[data-inline-editor-status]"),
    save: drawer.querySelector("[data-inline-editor-save]")
  };
}

function setInlineEditorStatus(message: string, tone: "neutral" | "success" | "error" = "neutral"): void {
  const { status } = inlineEditorElements();
  if (!status) return;
  status.textContent = message;
  status.dataset.inlineEditorTone = tone;
}

function frontmatterText(detail: InlineContentDetail, key: string): string {
  const value = detail.frontmatter?.[key];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

async function updateInlineEditorPreview(): Promise<void> {
  const { textarea, preview } = inlineEditorElements();
  if (!textarea || !preview) return;
  const source = textarea.value.trim();
  if (!source) {
    preview.innerHTML = '<p class="editor-preview__empty">No Markdown body yet.</p>';
    return;
  }
  try {
    preview.innerHTML = await renderInlineMarkdown(source);
  } catch {
    preview.innerHTML = `<pre>${escapeHtml(source)}</pre>`;
  }
}

function insertMarkdownSnippet(kind: string): void {
  const { textarea } = inlineEditorElements();
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const snippets: Record<string, string> = {
    heading: `\n## ${selected || "Section title"}\n`,
    bold: `**${selected || "bold text"}**`,
    code: `\n\`\`\`text\n${selected || "code here"}\n\`\`\`\n`,
    image: `![${selected || "image description"}](/assets/path/to-image.png)`,
    link: `[${selected || "link text"}](https://example.com)`
  };
  const snippet = snippets[kind] ?? "";
  textarea.setRangeText(snippet, start, end, "end");
  textarea.focus();
  void updateInlineEditorPreview();
}

async function openInlineEditor(contentId: string): Promise<void> {
  const { drawer, title, path, textarea, save } = inlineEditorElements();
  drawer.hidden = false;
  drawer.scrollTop = 0;
  document.documentElement.dataset.inlineEditorOpen = "true";
  drawer.setAttribute("aria-busy", "true");
  if (save) save.disabled = true;
  setInlineEditorStatus("Loading backend-authorized Markdown source...", "neutral");

  try {
    const detail = await apiFetch<InlineContentDetail>(`/api/editor/content/${contentId}`);
    inlineEditorDetail = detail;
    if (title) title.textContent = detail.title;
    if (path) path.textContent = `${detail.route_path} / ${detail.file_path}`;
    if (textarea) {
      textarea.value = detail.body;
    }
    if (save) save.disabled = !detail.is_editable;
    setInlineEditorStatus(
      detail.is_editable
        ? "Editing source Markdown. Saving writes through FastAPI and still requires a static rebuild for production."
        : "This content item is not directly editable.",
      detail.is_editable ? "neutral" : "error"
    );
    await updateInlineEditorPreview();
    drawer.scrollTop = 0;
    drawer.focus({ preventScroll: true });
  } catch (error) {
    inlineEditorDetail = null;
    if (title) title.textContent = "Editor unavailable";
    if (path) path.textContent = "The backend did not return editable source for this item.";
    if (textarea) textarea.value = "";
    if (save) save.disabled = true;
    setInlineEditorStatus(
      error instanceof Error
        ? `${error.message} Live editing requires the local FastAPI backend and an authenticated account.`
        : "Live editing requires the local FastAPI backend and an authenticated account.",
      "error"
    );
  } finally {
    drawer.removeAttribute("aria-busy");
  }
}

function setupInlineEditorShell(): void {
  const { drawer, textarea, save } = inlineEditorElements();
  if (drawer.dataset.inlineEditorReady === "true") return;
  drawer.dataset.inlineEditorReady = "true";

  let previewFrame = 0;
  textarea?.addEventListener("input", () => {
    if (previewFrame) window.cancelAnimationFrame(previewFrame);
    previewFrame = window.requestAnimationFrame(() => {
      previewFrame = 0;
      void updateInlineEditorPreview();
    });
  });
  drawer.querySelectorAll<HTMLButtonElement>("[data-inline-editor-insert]").forEach((button) => {
    button.addEventListener("click", () => insertMarkdownSnippet(button.dataset.inlineEditorInsert ?? ""));
  });
  drawer.querySelector<HTMLButtonElement>("[data-inline-editor-view]")?.addEventListener("click", () => {
    drawer.toggleAttribute("data-inline-editor-raw");
  });
  save?.addEventListener("click", async () => {
    const detail = inlineEditorDetail;
    const body = textarea?.value ?? "";
    if (!detail || !detail.is_editable) return;
    save.disabled = true;
    setInlineEditorStatus("Saving source Markdown...", "neutral");
    try {
      const tags = frontmatterText(detail, "tags")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const updated = await apiFetch<InlineContentDetail>(`/api/editor/content/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          body_hash: detail.body_hash,
          body,
          frontmatter: {
            title: frontmatterText(detail, "title") || detail.title,
            description: frontmatterText(detail, "description"),
            category: frontmatterText(detail, "category"),
            tags
          }
        })
      });
      inlineEditorDetail = updated;
      setInlineEditorStatus("Saved source Markdown. Run npm build before deploying static output.", "success");
    } catch (error) {
      setInlineEditorStatus(error instanceof Error ? error.message : "Save failed.", "error");
    } finally {
      save.disabled = false;
    }
  });
}

function setupInlineEditorButton(button: HTMLAnchorElement): void {
  if (button.dataset.inlineEditorReady === "true") return;
  button.dataset.inlineEditorReady = "true";
  button.addEventListener("click", (event) => {
    const contentId = button.dataset.inlineEditContentId;
    if (!contentId) return;
    event.preventDefault();
    setupInlineEditorShell();
    void openInlineEditor(contentId);
  });
}

async function setupInlineEditButtons(): Promise<void> {
  const buttons = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-inline-edit-route]"));
  if (buttons.length === 0) return;

  try {
    const response = await apiFetch<{ items: EditableContentItem[] }>("/api/editor/content");
    const editableByRoute = new Map<string, EditableContentItem>();

    response.items
      .filter((item) => item.is_editable)
      .forEach((item) => {
        editableByRoute.set(normalizeRoutePath(item.route_path), item);
      });

    buttons.forEach((button) => {
      const route = normalizeRoutePath(button.dataset.inlineEditRoute ?? "");
      const item = editableByRoute.get(route);
      if (!item) return;

      button.href = `/editor/?content_id=${item.id}`;
      button.dataset.inlineEditContentId = String(item.id);
      button.hidden = false;
      button.setAttribute("aria-label", button.dataset.inlineEditLabel ?? `Edit ${item.slug}`);
      setupInlineEditorButton(button);
    });
  } catch {
    buttons.forEach((button) => {
      button.hidden = true;
    });
  }
}

function setupThemeToggle(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  const visualControls = document.querySelector<HTMLElement>(".visual-controls--palette-menu");
  const paletteSelect = document.querySelector<HTMLSelectElement>("[data-palette-select]");
  const paletteButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-palette-option]"));
  if (!toggle && !paletteSelect && paletteButtons.length === 0) return;
  const controlsReady = visualControls?.dataset.visualControlsReady === "true";

  let transitionTimer = 0;

  const currentTheme = (): ThemeMode =>
    document.documentElement.dataset.mode === "dark" || document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  const currentPalette = (): PaletteName =>
    isPaletteName(document.documentElement.dataset.palette) ? document.documentElement.dataset.palette : "paper";

  const applyVisualState = (theme: ThemeMode, palette = currentPalette()): void => {
    applyDocumentVisualState(theme, palette);
    toggle?.setAttribute("aria-pressed", String(theme === "dark"));
    toggle?.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    if (paletteSelect) paletteSelect.value = palette;
    paletteButtons.forEach((button) => {
      const active = button.dataset.paletteOption === palette;
      button.classList.toggle("palette-option--active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  const applyVisualStateWithFade = (theme: ThemeMode, palette = currentPalette()): void => {
    if (motionQuery.matches) {
      applyVisualState(theme, palette);
      return;
    }

    if (transitionTimer) window.clearTimeout(transitionTimer);
    document.documentElement.setAttribute("data-theme-transition", "true");
    document.documentElement.dataset.roomLightSwitch = theme === "light" ? "window-on" : "lamp-dim";
    pulseRoomLight(theme);

    window.requestAnimationFrame(() => {
      applyVisualState(theme, palette);
    });

    transitionTimer = window.setTimeout(() => {
      document.documentElement.removeAttribute("data-theme-transition");
      delete document.documentElement.dataset.roomLightSwitch;
      transitionTimer = 0;
    }, 2300);
  };

  let paletteCloseTimer = 0;

  const setPaletteMenuOpen = (open: boolean): void => {
    if (!visualControls) return;
    if (paletteCloseTimer) window.clearTimeout(paletteCloseTimer);
    paletteCloseTimer = 0;
    if (open) {
      closeHeaderPopovers("palette");
      setHeaderMenuState("palette");
    } else if (document.documentElement.dataset.headerMenu === "palette") {
      setHeaderMenuState(null);
    }
    visualControls.toggleAttribute("data-palette-menu-open", open);
  };

  const schedulePaletteMenuClose = (): void => {
    if (!visualControls) return;
    if (paletteCloseTimer) window.clearTimeout(paletteCloseTimer);
    paletteCloseTimer = window.setTimeout(() => {
      if (!visualControls.contains(document.activeElement)) setPaletteMenuOpen(false);
    }, motionQuery.matches ? 0 : 110);
  };

  const restored = applyStoredVisualState();
  applyVisualState(restored.theme, restored.palette);
  if (controlsReady) return;
  if (visualControls) visualControls.dataset.visualControlsReady = "true";

  visualControls?.addEventListener("pointerenter", () => setPaletteMenuOpen(true));
  visualControls?.addEventListener("pointerleave", schedulePaletteMenuClose);
  visualControls?.addEventListener("mouseenter", () => setPaletteMenuOpen(true));
  visualControls?.addEventListener("mouseleave", schedulePaletteMenuClose);
  visualControls?.addEventListener("focusin", () => setPaletteMenuOpen(true));
  visualControls?.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!visualControls?.contains(document.activeElement)) schedulePaletteMenuClose();
    }, 0);
  });

  toggle?.addEventListener("click", () => {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    persistVisualState(nextTheme, currentPalette());
    applyVisualStateWithFade(nextTheme);
  });

  paletteSelect?.addEventListener("change", () => {
    const nextPalette = isPaletteName(paletteSelect.value) ? paletteSelect.value : "paper";
    persistVisualState(currentTheme(), nextPalette);
    applyVisualStateWithFade(currentTheme(), nextPalette);
  });

  paletteButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextPalette = isPaletteName(button.dataset.paletteOption) ? button.dataset.paletteOption : "paper";
      persistVisualState(currentTheme(), nextPalette);
      applyVisualStateWithFade(currentTheme(), nextPalette);
      setPaletteMenuOpen(false);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !visualControls?.hasAttribute("data-palette-menu-open")) return;
    setPaletteMenuOpen(false);
    toggle?.focus();
  });
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function drawCdFace(canvas: HTMLCanvasElement, image?: HTMLImageElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const size = Math.min(canvas.width, canvas.height);
  const center = size / 2;
  const radius = size * 0.46;
  context.clearRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();

  if (image?.complete && image.naturalWidth > 0) {
    const coverSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - coverSize) / 2;
    const sy = (image.naturalHeight - coverSize) / 2;
    context.drawImage(image, sx, sy, coverSize, coverSize, center - radius, center - radius, radius * 2, radius * 2);
    context.globalAlpha = 0.32;
  }

  const sweep = typeof context.createConicGradient === "function"
    ? context.createConicGradient(-0.8, center, center)
    : context.createLinearGradient(center - radius, center - radius, center + radius, center + radius);
  sweep.addColorStop(0, "rgba(72, 86, 148, 0.86)");
  sweep.addColorStop(0.22, "rgba(220, 176, 84, 0.62)");
  sweep.addColorStop(0.45, "rgba(118, 61, 71, 0.74)");
  sweep.addColorStop(0.68, "rgba(36, 108, 151, 0.76)");
  sweep.addColorStop(1, "rgba(72, 86, 148, 0.86)");
  context.fillStyle = sweep;
  context.fillRect(center - radius, center - radius, radius * 2, radius * 2);
  context.globalAlpha = 1;

  const sheen = context.createRadialGradient(center * 0.72, center * 0.66, 0, center, center, radius);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.56)");
  sheen.addColorStop(0.22, "rgba(255, 255, 255, 0.14)");
  sheen.addColorStop(0.58, "rgba(255, 255, 255, 0.04)");
  sheen.addColorStop(1, "rgba(0, 0, 0, 0.16)");
  context.fillStyle = sheen;
  context.fillRect(center - radius, center - radius, radius * 2, radius * 2);

  context.strokeStyle = "rgba(255, 255, 255, 0.24)";
  context.lineWidth = Math.max(1, size * 0.004);
  for (let ring = 0.18; ring <= 0.92; ring += 0.075) {
    context.beginPath();
    context.arc(center, center, radius * ring, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();

  context.save();
  context.beginPath();
  context.arc(center, center, radius * 0.16, 0, Math.PI * 2);
  context.fillStyle = "rgba(250, 248, 239, 0.92)";
  context.fill();
  context.lineWidth = Math.max(2, size * 0.015);
  context.strokeStyle = "rgba(44, 48, 71, 0.22)";
  context.stroke();
  context.beginPath();
  context.arc(center, center, radius * 0.045, 0, Math.PI * 2);
  context.fillStyle = "rgba(45, 45, 58, 0.58)";
  context.fill();
  context.restore();
}

function setupCdFaces(): void {
  const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("[data-cd-canvas]"));
  if (canvases.length === 0) return;

  const source = "/assets/music/dissembly-this-is-where-we-start-cd.png";
  const image = new Image();
  image.decoding = "async";
  image.onload = () => canvases.forEach((canvas) => drawCdFace(canvas, image));
  image.onerror = () => canvases.forEach((canvas) => drawCdFace(canvas));
  image.src = source;
  canvases.forEach((canvas) => drawCdFace(canvas));
}

function getSharedAudio(): HTMLAudioElement | null {
  const source = "/audio/dissembly-this-is-where-we-start.wav";
  if (window.__nanatoSharedAudio) return window.__nanatoSharedAudio;

  const audio = new Audio(source);
  audio.loop = true;
  audio.preload = "metadata";
  audio.dataset.audio = "";
  audio.dataset.trackTitle = audio.dataset.trackTitle || "This is where we start";
  audio.dataset.trackArtist = audio.dataset.trackArtist || "Dissembly";
  window.__nanatoSharedAudio = audio;
  return audio;
}

function setupMusicPlayer(): void {
  const audio = getSharedAudio();
  if (!audio) return;
  const audioElement = audio;
  const audioReady = audio.dataset.audioReady === "true";
  audio.dataset.audioReady = "true";
  setupCdFaces();

  const surfaces = Array.from(document.querySelectorAll<HTMLElement>("[data-audio-player], [data-portable-player]"));
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-player-toggle]"));
  const icons = Array.from(document.querySelectorAll<HTMLElement>("[data-play-icon]"));
  const progressInputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-player-progress]"));
  const currentTimeLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-player-time]"));
  const durationLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-player-duration]"));
  const statusLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-player-status]"));
  const volumeSliders = Array.from(document.querySelectorAll<HTMLInputElement>("[data-volume-slider]"));
  const volumeKnobs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-volume-knob]"));
  const discs = Array.from(
    document.querySelectorAll<HTMLElement>(".music-page__disc, .music-mini__disc, .music-widget__disc")
  );
  const savedVolume = Number(window.localStorage.getItem("nanato-music-volume") ?? "0.42");
  let targetVolume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 0.42;
  let previousAudibleVolume = targetVolume > 0.01 ? targetVolume : 0.42;
  let raf = 0;
  let discRotation = 0;
  let volumeFrame = 0;

  audio.volume = targetVolume;

  const setStatus = (message: string): void => {
    statusLabels.forEach((label) => {
      label.textContent = message;
    });
  };

  const currentRatio = (): number => {
    const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
    return hasDuration ? Math.min(1, Math.max(0, audio.currentTime / audio.duration)) : 0;
  };

  const setNeedleTransform = (ratio: number, playing: boolean, stopping = false): void => {
    const roomPlaybackAngle = 54 - ratio * 14;
    const widgetPlaybackAngle = 50 - ratio * 12;
    const roomAngle = playing || stopping ? roomPlaybackAngle : 24;
    const widgetAngle = playing || stopping ? widgetPlaybackAngle : 22;
    surfaces.forEach((surface) => {
      surface.style.setProperty("--needle-angle", `${roomAngle}deg`);
      surface.style.setProperty("--needle-angle-widget", `${widgetAngle}deg`);
    });
  };

  const setPlayingState = (playing: boolean, stopping = false): void => {
    surfaces.forEach((surface) => {
      surface.classList.toggle("is-playing", playing);
      surface.classList.toggle("is-stopping", stopping);
    });
    toggles.forEach((button) => {
      button.setAttribute("aria-label", playing ? "Pause music" : "Play music");
    });
    icons.forEach((icon) => {
      icon.textContent = playing ? "pause" : "play";
    });
    setNeedleTransform(currentRatio(), playing, stopping);
    setStatus(playing ? "looping quietly" : stopping ? "fading out" : "paused");
  };

  const animateDiscs = (): void => {
    if (audio.paused || motionQuery.matches) {
      raf = 0;
      return;
    }
    discRotation = (discRotation + 0.42) % 360;
    discs.forEach((disc) => disc.style.setProperty("--disc-rotation", `${discRotation}deg`));
    updateProgress();
    raf = window.requestAnimationFrame(animateDiscs);
  };

  const startDiscAnimation = (): void => {
    if (!raf && !motionQuery.matches) raf = window.requestAnimationFrame(animateDiscs);
  };

  const fadeVolume = (to: number, duration = 520, onComplete?: () => void): void => {
    if (volumeFrame) window.cancelAnimationFrame(volumeFrame);
    const from = audio.volume;
    const started = performance.now();
    const ease = (value: number): number => 1 - Math.pow(1 - value, 3);

    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / duration);
      audio.volume = from + (to - from) * ease(progress);
      if (progress < 1) {
        volumeFrame = window.requestAnimationFrame(step);
        return;
      }
      volumeFrame = 0;
      audio.volume = to;
      onComplete?.();
    };

    volumeFrame = window.requestAnimationFrame(step);
  };

  const updateProgress = (): void => {
    const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
    const ratio = hasDuration ? Math.min(1, Math.max(0, audio.currentTime / audio.duration)) : 0;
    progressInputs.forEach((progress) => {
      progress.value = String(ratio * 1000);
      progress.style.setProperty("--track-progress", `${ratio * 100}%`);
    });
    const stopping = surfaces.some((surface) => surface.classList.contains("is-stopping"));
    setNeedleTransform(ratio, !audio.paused && !stopping, stopping);
    currentTimeLabels.forEach((label) => {
      label.textContent = formatTime(audio.currentTime);
    });
    durationLabels.forEach((label) => {
      label.textContent = hasDuration ? formatTime(audio.duration) : "0:00";
    });
  };

  const startPlayback = async (): Promise<void> => {
    audio.volume = 0;
    await audio.play();
    setPlayingState(true);
    fadeVolume(targetVolume, 520);
    startDiscAnimation();
  };

  const pausePlayback = (): void => {
    setPlayingState(false, true);
    fadeVolume(0, 520, () => {
      audio.pause();
      audio.volume = targetVolume;
      setPlayingState(false);
    });
  };

  const togglePlayback = async (): Promise<void> => {
    try {
      if (audio.paused) {
        await startPlayback();
      } else {
        pausePlayback();
      }
    } catch {
      setStatus("tap again to start");
    }
  };

  const setVolume = (value: number): void => {
    targetVolume = Math.min(1, Math.max(0, value));
    if (targetVolume > 0.01) {
      previousAudibleVolume = targetVolume;
      audio.muted = false;
    }
    if (!audio.paused) {
      fadeVolume(targetVolume, 240);
    } else {
      audio.volume = targetVolume;
    }
    try {
      window.localStorage.setItem("nanato-music-volume", String(targetVolume));
    } catch {
      // Volume persistence is optional.
    }
    volumeSliders.forEach((slider) => {
      slider.value = String(Math.round(targetVolume * 100));
      slider.style.setProperty("--volume-fill", `${targetVolume * 100}%`);
    });
    syncVolumeControls();
  };

  const setMuted = (muted: boolean): void => {
    if (muted && targetVolume > 0.01) previousAudibleVolume = targetVolume;
    audio.muted = muted;
    if (!muted && targetVolume <= 0.01) {
      targetVolume = previousAudibleVolume;
      audio.volume = audio.paused ? targetVolume : audio.volume;
    }
    syncVolumeControls();
  };

  function syncVolumeControls(): void {
    const visibleLevel = audioElement.muted ? 0 : targetVolume;
    const levelPercent = Math.round(visibleLevel * 100);
    const knobAngle = -135 + visibleLevel * 270;
    volumeSliders.forEach((slider) => {
      slider.value = String(Math.round(targetVolume * 100));
      slider.style.setProperty("--volume-fill", `${visibleLevel * 100}%`);
    });
    volumeKnobs.forEach((knob) => {
      knob.style.setProperty("--volume-level", String(visibleLevel));
      knob.style.setProperty("--volume-fill", `${visibleLevel * 100}%`);
      knob.style.setProperty("--knob-angle", `${knobAngle}deg`);
      knob.toggleAttribute("data-muted", audioElement.muted || visibleLevel <= 0.01);
      knob.setAttribute("aria-pressed", String(audioElement.muted || visibleLevel <= 0.01));
      knob.setAttribute(
        "aria-label",
        audioElement.muted || visibleLevel <= 0.01
          ? `Muted. Click to restore volume, or drag diagonally to adjust.`
          : `Volume ${levelPercent} percent. Click to mute, or drag diagonally to adjust.`
      );
    });
  };

  toggles.forEach((button) => {
    if (button.dataset.playerToggleReady === "true") return;
    button.dataset.playerToggleReady = "true";
    button.addEventListener("click", () => void togglePlayback());
  });
  progressInputs.forEach((progress) => {
    if (progress.dataset.playerProgressReady === "true") return;
    progress.dataset.playerProgressReady = "true";
    progress.addEventListener("input", () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
      updateProgress();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-player-skip]").forEach((button) => {
    if (button.dataset.playerSkipReady === "true") return;
    button.dataset.playerSkipReady = "true";
    button.addEventListener("click", () => {
      const offset = Number(button.dataset.playerSkip ?? "0");
      const duration = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + offset;
      audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + offset));
      updateProgress();
    });
  });
  volumeSliders.forEach((slider) => {
    slider.style.setProperty("--volume-fill", `${targetVolume * 100}%`);
    slider.value = String(Math.round(targetVolume * 100));
    if (slider.dataset.volumeReady === "true") return;
    slider.dataset.volumeReady = "true";
    slider.addEventListener("input", () => setVolume(Number(slider.value) / 100));
  });
  volumeKnobs.forEach((knob) => {
    if (knob.dataset.volumeKnobReady === "true") return;
    knob.dataset.volumeKnobReady = "true";
    let pointerId = 0;
    let dragging = false;
    let didDrag = false;

    const volumeFromPointer = (clientX: number, clientY: number): number => {
      const rect = knob.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const range = Math.max(rect.width, rect.height) * 1.12;
      return Math.min(1, Math.max(0, 0.5 + (dx - dy) / range));
    };

    knob.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      dragging = true;
      didDrag = false;
      knob.setPointerCapture(pointerId);
      knob.setAttribute("data-volume-knob-active", "");
    });

    knob.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      didDrag = true;
      setVolume(volumeFromPointer(event.clientX, event.clientY));
    });

    const finishDrag = (event: PointerEvent): void => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      knob.removeAttribute("data-volume-knob-active");
      try {
        knob.releasePointerCapture(pointerId);
      } catch {
        // Capture may already be released by the browser.
      }
      if (didDrag) {
        event.preventDefault();
        window.setTimeout(() => {
          didDrag = false;
        }, 0);
      }
    };

    knob.addEventListener("pointerup", finishDrag);
    knob.addEventListener("pointercancel", finishDrag);
    knob.addEventListener("click", (event) => {
      if (didDrag) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      setMuted(!(audio.muted || targetVolume <= 0.01));
    });
  });

  if (!audioReady) {
    audio.addEventListener("loadedmetadata", updateProgress);
    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("play", () => {
      setPlayingState(true);
      startDiscAnimation();
    });
    audio.addEventListener("pause", () => setPlayingState(false));
  }
  updateProgress();
  syncVolumeControls();
  setPlayingState(!audio.paused);
  if (!audio.paused) startDiscAnimation();
}

function setupMusicWidget(): void {
  const widget = document.querySelector<HTMLElement>("[data-portable-player]");
  if (!widget) return;
  if (widget.dataset.musicWidgetReady === "true") return;
  widget.dataset.musicWidgetReady = "true";

  let closeTimer = 0;

  const setOpen = (open: boolean): void => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
    widget.toggleAttribute("data-music-widget-open", open);
  };

  const scheduleClose = (): void => {
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => setOpen(false), motionQuery.matches ? 0 : 360);
  };

  widget.addEventListener("pointerenter", () => setOpen(true));
  widget.addEventListener("pointerleave", scheduleClose);
  widget.addEventListener("focusin", () => setOpen(true));
  widget.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!widget.contains(document.activeElement)) scheduleClose();
    }, 0);
  });
}

function setupDeskStickers(): void {
  const hosts = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".studio-hero, .library-hero, .projects-hero, .apps-desk, .about-hero, .blog-journal-hero, .music-room__hero, .docs-article__header, .manual-hero"
    )
  );

  hosts.forEach((host) => {
    if (host.querySelector(":scope > [data-desk-sticker]")) return;
    if (host.matches(".apps-desk") && host.querySelector(".apps-desk__tab")) return;
    const sticker = document.createElement("span");
    sticker.className = "desk-sticker";
    sticker.dataset.deskSticker = "";
    sticker.setAttribute("aria-hidden", "true");
    sticker.style.position = "absolute";
    host.prepend(sticker);
  });

  document.querySelectorAll<HTMLElement>(".apps-desk__tab").forEach((sticker) => {
    sticker.dataset.deskSticker = "";
  });

  const stickers = Array.from(document.querySelectorAll<HTMLElement>("[data-desk-sticker]"));
  stickers.forEach((sticker, index) => {
    if (sticker.dataset.stickerReady === "true") return;
    sticker.dataset.stickerReady = "true";
    sticker.style.position = "absolute";
    sticker.style.zIndex = "9";
    sticker.style.setProperty("--sticker-delay", `${(index % 5) * -1.6}s`);
    sticker.style.setProperty("--sticker-rotate", `${index % 2 === 0 ? -1.2 : 1.1}deg`);

    let pointerId = 0;
    let startX = 0;
    let startY = 0;
    let targetX = 0;
    let targetY = 0;
    let visualX = 0;
    let visualY = 0;
    let dragFrame = 0;
    let releaseTimer = 0;

    const findDragHost = (): HTMLElement => {
      return (
        sticker.closest<HTMLElement>(
          ".studio-hero, .library-hero, .projects-hero, .apps-desk, .about-hero, .blog-journal-hero, .music-room__hero, .docs-article__header, .manual-hero"
        ) ?? sticker.parentElement ?? sticker
      );
    };

    const host = findDragHost();

    const setHostTransform = (): void => {
      const rotate = Math.max(-1.6, Math.min(1.6, visualX / 96));
      host.style.transform = `translate3d(${visualX}px, ${visualY}px, 0) rotate(${rotate}deg)`;
    };

    const animateDrag = (): void => {
      visualX += (targetX - visualX) * 0.18;
      visualY += (targetY - visualY) * 0.18;
      setHostTransform();
      if (Math.abs(targetX - visualX) > 0.2 || Math.abs(targetY - visualY) > 0.2) {
        dragFrame = window.requestAnimationFrame(animateDrag);
        return;
      }
      dragFrame = 0;
    };

    const releaseSticker = (): void => {
      if (releaseTimer) window.clearTimeout(releaseTimer);
      releaseTimer = 0;
      if (!sticker.hasAttribute("data-sticker-dragging")) return;
      sticker.removeAttribute("data-sticker-dragging");
      host.removeAttribute("data-sticker-host-dragging");
      if (dragFrame) window.cancelAnimationFrame(dragFrame);
      dragFrame = 0;
      const startTransform = host.style.transform || "translate3d(0, 0, 0) rotate(0deg)";
      const overshootX = visualX * -0.13;
      const overshootY = visualY * -0.13;
      host.animate(
        [
          { transform: startTransform },
          { transform: `translate3d(${overshootX}px, ${overshootY}px, 0) rotate(${Math.max(-0.8, Math.min(0.8, overshootX / 120))}deg)` },
          { transform: "translate3d(0, 0, 0) rotate(0deg)" }
        ],
        {
          duration: motionQuery.matches ? 1 : 1120,
          easing: "cubic-bezier(0.16, 0.84, 0.24, 1)"
        }
      );
      host.style.transform = "";
      targetX = 0;
      targetY = 0;
      visualX = 0;
      visualY = 0;
    };

    sticker.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      targetX = 0;
      targetY = 0;
      visualX = 0;
      visualY = 0;
      sticker.setPointerCapture(pointerId);
      sticker.setAttribute("data-sticker-dragging", "");
      host.setAttribute("data-sticker-host-dragging", "");
      host.getAnimations().forEach((animation) => animation.cancel());
      if (releaseTimer) window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(releaseSticker, 5200);
    });

    sticker.addEventListener("pointermove", (event) => {
      if (!sticker.hasAttribute("data-sticker-dragging") || event.pointerId !== pointerId) return;
      if (releaseTimer) window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(releaseSticker, 5200);
      targetX = Math.max(-132, Math.min(132, event.clientX - startX));
      targetY = Math.max(-88, Math.min(88, event.clientY - startY));
      if (!dragFrame) dragFrame = window.requestAnimationFrame(animateDrag);
    });

    sticker.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pointerId) return;
      releaseSticker();
    });

    sticker.addEventListener("pointercancel", (event) => {
      if (event.pointerId !== pointerId) return;
      releaseSticker();
    });

    sticker.addEventListener("lostpointercapture", () => {
      if (!sticker.hasAttribute("data-sticker-dragging")) return;
      releaseSticker();
    });

    document.addEventListener("mouseup", releaseSticker);
    document.addEventListener("touchend", releaseSticker);
    window.addEventListener("blur", releaseSticker);
  });
}

function setupDraggableApps(): void {
  const apps = Array.from(document.querySelectorAll<HTMLElement>(".apps-desk__note, .app-tool"));
  apps.forEach((app, index) => {
    if (app.dataset.appDragReady === "true") return;
    app.dataset.appDragReady = "true";
    app.classList.add("app-draggable");
    app.style.setProperty("--app-drag-x", "0px");
    app.style.setProperty("--app-drag-y", "0px");
    app.style.setProperty("--app-drag-rotate", "0deg");
    app.style.setProperty("--app-drag-delay", `${index * -1.3}s`);

    let pointerId = 0;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let targetX = 0;
    let targetY = 0;
    let visualX = 0;
    let visualY = 0;
    let frame = 0;
    let didDrag = false;

    const apply = (): void => {
      frame = 0;
      visualX += (targetX - visualX) * 0.22;
      visualY += (targetY - visualY) * 0.22;
      const rotate = Math.max(-2.2, Math.min(2.2, visualX / 92));
      app.style.setProperty("--app-drag-x", `${visualX.toFixed(2)}px`);
      app.style.setProperty("--app-drag-y", `${visualY.toFixed(2)}px`);
      app.style.setProperty("--app-drag-rotate", `${rotate.toFixed(3)}deg`);
      if (Math.abs(targetX - visualX) > 0.25 || Math.abs(targetY - visualY) > 0.25) {
        frame = window.requestAnimationFrame(apply);
      }
    };

    const requestApply = (): void => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const finish = (release = false): void => {
      app.removeAttribute("data-app-dragging");
      if (release && didDrag) {
        app.setAttribute("data-app-dragged", "true");
        app.setAttribute("data-app-positioned", "true");
        window.setTimeout(() => app.removeAttribute("data-app-dragged"), 260);
      }
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      visualX = targetX;
      visualY = targetY;
      apply();
    };

    app.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = asElement(event.target);
      if (target?.closest("button, input, textarea, select, code")) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      originX = targetX;
      originY = targetY;
      didDrag = false;
      app.setPointerCapture(pointerId);
      app.setAttribute("data-app-dragging", "true");
    });

    app.addEventListener("pointermove", (event) => {
      if (!app.hasAttribute("data-app-dragging") || event.pointerId !== pointerId) return;
      const nextX = originX + event.clientX - startX;
      const nextY = originY + event.clientY - startY;
      if (Math.abs(nextX - originX) > 3 || Math.abs(nextY - originY) > 3) didDrag = true;
      targetX = Math.max(-116, Math.min(116, nextX));
      targetY = Math.max(-82, Math.min(82, nextY));
      requestApply();
    });

    app.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pointerId) return;
      finish(true);
    });

    app.addEventListener("pointercancel", (event) => {
      if (event.pointerId !== pointerId) return;
      finish(true);
    });

    app.addEventListener(
      "click",
      (event) => {
        if (!app.hasAttribute("data-app-dragged")) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true
    );
  });
}

function setupMotionReveal(): void {
  if (motionQuery.matches || !("IntersectionObserver" in window)) {
    document.documentElement.dataset.motionReady = "reduced";
    return;
  }

  const candidates = Array.from(document.querySelectorAll<HTMLElement>(revealSelectors.join(",")))
    .filter((element) => !element.classList.contains("page-enter"))
    .filter((element) => !element.hasAttribute("data-motion-reveal"))
    .slice(0, 70);

  if (candidates.length === 0) return;

  document.documentElement.dataset.motionReady = "true";

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -10% 0px",
      threshold: 0.08
    }
  );

  const initiallyVisible = new Set(
    candidates.filter((element) => element.getBoundingClientRect().top < window.innerHeight * 0.92)
  );

  candidates.forEach((element, index) => {
    const delay = Math.min((index % 4) * 42, 126);
    element.dataset.motionReveal = "";
    element.style.setProperty("--motion-reveal-delay", `${delay}ms`);

    if (initiallyVisible.has(element)) {
      element.classList.add("is-visible");
      return;
    }

    observer.observe(element);
  });
}

function pageMotionTargets(root: ParentNode): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      ".page-enter, .studio-hero, .blog-journal-hero, .library-hero, .projects-hero, .apps-desk, .music-room__hero, .docs-article__header, .manual-hero, .manual-overview-card, .manual-chapter-stack, .feature-tile, .studio-card, .app-tool, .blog-note-card"
    )
  ).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width >= 48 && rect.height >= 32 && rect.bottom > -80 && rect.top < window.innerHeight * 1.18;
  });

  const selected: HTMLElement[] = [];
  candidates.forEach((element) => {
    if (selected.some((parent) => parent !== element && parent.contains(element))) return;
    selected.push(element);
  });

  return selected.slice(0, 9);
}

function organicMotion(index: number): { x: number; y: number; rotate: number; delay: number } {
  const seed = (index * 37 + window.location.pathname.length * 11) % 29;
  const direction = index % 2 === 0 ? -1 : 1;
  return {
    x: direction * (14 + (seed % 6) * 3.5),
    y: 18 + (seed % 7) * 4.5,
    rotate: direction * (0.38 + (seed % 6) * 0.12),
    delay: Math.min(340, index * 38 + (seed % 5) * 18)
  };
}

function createPageExitStage(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>("[data-page-exit-stage]");
  if (existing) {
    existing.replaceChildren();
    return existing;
  }

  const stage = document.createElement("div");
  stage.className = "page-exit-stage";
  stage.setAttribute("aria-hidden", "true");
  stage.dataset.pageExitStage = "true";
  document.body.append(stage);
  return stage;
}

function animatePageExitItem(item: HTMLElement, motion: ReturnType<typeof organicMotion>, duration: number, startProgress = 0): void {
  const startOpacity = Math.max(0.18, 0.52 - startProgress * 0.28);
  const startX = motion.x * 0.12 * startProgress;
  const startY = motion.y * 0.22 * startProgress;
  const startRotate = motion.rotate * 0.18 * startProgress;
  const exitX = motion.x * 3.1;
  const exitY = 44 + motion.y * 1.75;
  const exitRotate = motion.rotate * 1.55;

  item.animate(
    [
      {
        opacity: startOpacity,
        transform: `translate3d(${startX}px, ${startY}px, 0) rotate(${startRotate}deg) scale(1)`,
        filter: `blur(${2.2 + Math.min(1.4, startProgress * 2.4)}px) saturate(0.9)`,
        offset: 0
      },
      {
        opacity: 0.3,
        transform: `translate3d(${exitX * 0.54}px, ${exitY * 0.48}px, 0) rotate(${exitRotate * 0.56}deg) scale(0.996)`,
        filter: "blur(3.8px) saturate(0.84)",
        offset: 0.58
      },
      {
        opacity: 0,
        transform: `translate3d(${exitX}px, ${exitY}px, 0) rotate(${exitRotate}deg) scale(0.972)`,
        filter: "blur(6px) saturate(0.78)",
        offset: 1
      }
    ],
    {
      duration,
      delay: Math.min(120, motion.delay * 0.32),
      easing: "cubic-bezier(0.2, 0.76, 0.16, 1)",
      fill: "forwards"
    }
  );
}

function restorePageExitStage(): void {
  // The persistent exit layer is populated before navigation so it survives
  // Astro swaps. Cleanup is handled by the animation timeout.
}

function renderPageExitSnapshots(snapshots: PageExitSnapshot[], startProgress = 0): void {
  if (snapshots.length === 0 || motionQuery.matches) return;

  const stage = createPageExitStage();
  const remainingDuration = Math.max(900, pageExchangeDuration - 80);

  snapshots.slice(0, 9).forEach((snapshot) => {
    const item = document.createElement("div");
    item.className = `${snapshot.className} page-exit-stage__item`;
    item.innerHTML = snapshot.html;
    Object.assign(item.style, {
      position: "fixed",
      left: `${snapshot.left}px`,
      top: `${snapshot.top}px`,
      width: `${snapshot.width}px`,
      height: `${snapshot.height}px`,
      margin: "0",
      pointerEvents: "none",
      transformOrigin: "50% 42%",
      overflow: "hidden",
      opacity: "0.5"
    });
    stage.append(item);
    animatePageExitItem(item, snapshot.motion, remainingDuration, startProgress);
  });

  window.setTimeout(() => stage.replaceChildren(), remainingDuration + 520);
}

function preparePageExitLayer(): boolean {
  const main = document.querySelector<HTMLElement>(".site-main");

  const seed = (window.location.pathname.length * 17 + window.location.search.length * 7) % 13;
  const direction = seed % 2 === 0 ? -1 : 1;
  document.documentElement.style.setProperty("--route-exit-x", `${direction * (10 + seed * 1.6)}vw`);
  document.documentElement.style.setProperty("--route-exit-y", `${72 + seed * 1.4}vh`);
  document.documentElement.style.setProperty("--route-exit-rot", `${direction * (0.48 + seed * 0.045)}deg`);
  document.documentElement.style.setProperty("--route-enter-x", `${direction * -(1.4 + seed * 0.08)}rem`);
  document.documentElement.style.setProperty("--route-enter-y", `${2.4 + seed * 0.1}rem`);
  document.documentElement.style.setProperty("--route-enter-rot", `${direction * -(0.18 + seed * 0.02)}deg`);

  if (!main || motionQuery.matches) {
    document.querySelector("[data-page-exit-stage]")?.replaceChildren();
    return false;
  }

  const snapshots = pageMotionTargets(main)
    .map((element, index): PageExitSnapshot | null => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 18) return null;
      return {
        html: element.innerHTML,
        className: element.className || "",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        motion: organicMotion(index + seed)
      };
    })
    .filter((snapshot): snapshot is PageExitSnapshot => Boolean(snapshot));

  renderPageExitSnapshots(snapshots);

  pageMotionTargets(main)
    .slice(0, 8)
    .forEach((element, index) => {
      const motion = organicMotion(index + seed);
      element.animate(
        [
          { opacity: 1, transform: "translate3d(0, 0, 0) rotate(0deg)", filter: "blur(0)" },
          {
            opacity: 0.56,
            transform: `translate3d(${motion.x * 0.34}px, ${motion.y * 0.42}px, 0) rotate(${motion.rotate * 0.32}deg)`,
            filter: "blur(1.6px) saturate(0.92)"
          }
        ],
        {
          duration: 210,
          delay: Math.min(70, motion.delay * 0.16),
          easing: "cubic-bezier(0.2, 0.72, 0.18, 1)",
          fill: "forwards"
        }
      );
    });

  return snapshots.length > 0;
}

function animateCurrentPageOut(): Promise<void> {
  document.documentElement.dataset.pageLeaving = "true";
  preparePageExitLayer();

  return new Promise((resolve) => window.setTimeout(resolve, 80));
}

function shouldAnimateNavigation(link: HTMLAnchorElement, event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.target || link.hasAttribute("download")) return false;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;

  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false;
  return true;
}

function setupPageNavigationMotion(): void {
  const handleNavigation = (event: MouseEvent, link: HTMLAnchorElement): void => {
    if (!shouldAnimateNavigation(link, event)) return;
      if (link.hasAttribute("data-inline-edit-content-id") || link.hasAttribute("data-inline-edit-route")) return;
      if (document.documentElement.dataset.pageLeaving === "true") {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      closeHeaderPopovers();
      const targetHref = link.href;

      void animateCurrentPageOut().then(async () => {
        try {
          pendingPageFlyIn = true;
          await navigate(targetHref);
        } catch {
          window.location.assign(targetHref);
        } finally {
          delete document.documentElement.dataset.pageLeaving;
        }
      });
  };

  window.__nanatoNavigateLink = handleNavigation;

  if (document.documentElement.dataset.pageNavigationMotionReady !== "true") {
    document.documentElement.dataset.pageNavigationMotionReady = "true";
    window.addEventListener(
      "click",
      (event) => {
        const target = asElement(event.target);
        const link = target?.closest<HTMLAnchorElement>("a[href]");
        if (!link) return;
        window.__nanatoNavigateLink?.(event, link);
      },
      true
    );
  }

  document.querySelectorAll<HTMLAnchorElement>("a[data-page-transition-link]").forEach((link) => {
    if (link.dataset.pageTransitionReady === "true") return;
    link.dataset.pageTransitionReady = "true";
    link.addEventListener(
      "click",
      (event) => {
        handleNavigation(event, link);
      },
      true
    );
  });
}

function setupPageFlyIn(): void {
  if (motionQuery.matches) return;
  if (!pendingPageFlyIn) return;
  pendingPageFlyIn = false;
  const pathKey = `${window.location.pathname}${window.location.search}`;
  if (lastFlyInPath === pathKey) return;
  lastFlyInPath = pathKey;

  restorePageExitStage();

  const main = document.querySelector<HTMLElement>(".site-main");
  if (!main) return;

  const targets = pageMotionTargets(main);

  document.documentElement.dataset.pageEntering = "true";
  window.setTimeout(() => {
    delete document.documentElement.dataset.pageEntering;
  }, pageExchangeDuration + 420);

  targets.forEach((element, index) => {
    const motion = organicMotion(index);
    element.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${motion.x * 1.08}px, ${motion.y * 1.14}px, 0) rotate(${motion.rotate * 1.1}deg) scale(0.982)`,
          filter: "blur(5px)",
          offset: 0
        },
        {
          opacity: 0.42,
          transform: `translate3d(${motion.x * 0.62}px, ${motion.y * 0.66}px, 0) rotate(${motion.rotate * 0.62}deg) scale(0.99)`,
          filter: "blur(3px)",
          offset: 0.36
        },
        {
          opacity: 0.9,
          transform: `translate3d(${motion.x * -0.035}px, ${motion.y * -0.045}px, 0) rotate(${motion.rotate * -0.09}deg) scale(1.001)`,
          filter: "blur(0.8px)",
          offset: 0.82
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)",
          filter: "blur(0)",
          offset: 1
        }
      ],
      {
        duration: pageExchangeDuration,
        delay: Math.min(motion.delay * 0.62, 230),
        easing: "cubic-bezier(0.18, 0.74, 0.14, 1)",
        fill: "backwards"
      }
    );
  });
}

function setupPageInteractions(): void {
  applyStoredVisualState();
  setHeaderOffset();
  setupHeaderState();
  setupRoomLighting();
  setupNavigation();
  setupProjectMenu();
  setupAccountMenu();
  setupDownloadVaultState();
  setupManualChapters();
  setupDocsRail();
  setupSiteSearch();
  void setupInlineEditButtons();
  setupThemeToggle();
  setupMusicPlayer();
  setupMusicWidget();
  setupDeskStickers();
  setupDraggableApps();
  setupPageNavigationMotion();
  setupPageFlyIn();
  setupMotionReveal();
}

setupSmoothHashScroll();
setupPageInteractions();

document.addEventListener("astro:before-swap", () => {
  applyStoredVisualState();
  const stage = document.querySelector("[data-page-exit-stage]");
  if (!stage?.childElementCount) {
    pendingPageFlyIn = preparePageExitLayer() || pendingPageFlyIn;
  }
});
document.addEventListener("astro:before-preparation", () => {
  if (document.documentElement.dataset.pageLeaving === "true") return;
  pendingPageFlyIn = preparePageExitLayer();
});
document.addEventListener("astro:after-swap", () => {
  applyStoredVisualState();
  delete document.documentElement.dataset.pageLeaving;
  window.requestAnimationFrame(setupPageInteractions);
});
document.addEventListener("astro:page-load", setupPageInteractions);
window.addEventListener("resize", requestHeaderOffset);
window.addEventListener("load", setHeaderOffset);
