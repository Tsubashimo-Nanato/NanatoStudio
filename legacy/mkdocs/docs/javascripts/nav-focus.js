(() => {
  let smoothScrollBound = false;
  let vaultResizeBound = false;
  let cardDownloadBound = false;
  let layoutResizeBound = false;
  let teardownAiformulaScrollSync = null;

  const getHashTarget = (hash) => {
    if (!hash || !hash.startsWith("#")) return null;
    const targetId = decodeURIComponent(hash.slice(1));
    return targetId ? document.getElementById(targetId) : null;
  };

  const resolveUrl = (href) => {
    try {
      return new URL(href, window.location.href).href;
    } catch (_error) {
      return href;
    }
  };

  const updateLayoutOffsets = () => {
    const root = document.documentElement;
    const header = document.querySelector(".md-header");
    const tabs = window.innerWidth >= 960 ? document.querySelector(".md-tabs") : null;
    const topOffset = (header?.offsetHeight || 0) + (tabs?.offsetHeight || 0) + 16;
    const scrollOffset = topOffset + 26;

    root.style.setProperty("--site-scroll-offset", `${scrollOffset}px`);
    root.style.setProperty("--project-native-toc-top", `${topOffset}px`);
  };

  const getScrollOffset = () => {
    const rawOffset = getComputedStyle(document.documentElement)
      .getPropertyValue("--site-scroll-offset")
      .trim();
    const parsedOffset = Number.parseFloat(rawOffset);

    if (Number.isFinite(parsedOffset)) {
      return parsedOffset;
    }

    const header = document.querySelector(".md-header");
    const tabs = window.innerWidth >= 960 ? document.querySelector(".md-tabs") : null;
    return (header?.offsetHeight || 0) + (tabs?.offsetHeight || 0) + 42;
  };

  const smoothScrollToHash = (hash, updateHistory = false) => {
    const target = getHashTarget(hash);
    if (!target) return;

    window.scrollTo({
      top: Math.max(target.getBoundingClientRect().top + window.scrollY - getScrollOffset(), 0),
      behavior: "smooth",
    });

    if (updateHistory) {
      window.history.replaceState(null, "", hash);
    }
  };

  const getVaultSummary = (vault) => vault.querySelector(":scope > summary");
  const getVaultContent = (vault) => vault.querySelector(":scope > .download-vault__content");

  const setVaultExpanded = (vault, expanded) => {
    const summary = getVaultSummary(vault);
    const content = getVaultContent(vault);
    if (!summary || !content) return;

    vault.classList.toggle("is-expanded", expanded);
    summary.setAttribute("aria-expanded", String(expanded));

    if (expanded) {
      vault.open = true;
      content.style.maxHeight = `${content.scrollHeight}px`;
      return;
    }

    content.style.maxHeight = "0px";
  };

  const refreshExpandedVaultHeights = () => {
    document.querySelectorAll(".download-vault.is-expanded").forEach((vault) => {
      const content = getVaultContent(vault);
      if (!content) return;
      content.style.maxHeight = `${content.scrollHeight}px`;
    });
  };

  const bindVaultResize = () => {
    if (vaultResizeBound) return;
    vaultResizeBound = true;

    window.addEventListener("resize", () => {
      window.requestAnimationFrame(refreshExpandedVaultHeights);
    });
  };

  const setupReferenceVaults = () => {
    document.querySelectorAll(".download-vault").forEach((vault) => {
      const summary = getVaultSummary(vault);
      const content = getVaultContent(vault);
      if (!summary || !content) return;

      if (!summary.dataset.bound) {
        summary.addEventListener("click", (event) => {
          event.preventDefault();

          const isExpanded = vault.classList.contains("is-expanded");
          if (isExpanded) {
            const closeAfterTransition = () => {
              if (!vault.classList.contains("is-expanded")) {
                vault.open = false;
              }
              content.removeEventListener("transitionend", closeAfterTransition);
            };

            content.style.maxHeight = `${content.scrollHeight}px`;
            window.requestAnimationFrame(() => setVaultExpanded(vault, false));
            content.addEventListener("transitionend", closeAfterTransition);
            return;
          }

          vault.open = true;
          content.style.maxHeight = "0px";
          window.requestAnimationFrame(() => setVaultExpanded(vault, true));
        });

        summary.dataset.bound = "true";
      }

      setVaultExpanded(vault, false);
    });

    bindVaultResize();
  };

  const startFileDownload = async (href, fileName) => {
    const absoluteHref = resolveUrl(href);

    if (window.location.protocol.startsWith("http")) {
      try {
        const response = await fetch(absoluteHref, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const tempLink = document.createElement("a");
        tempLink.href = objectUrl;
        tempLink.download = fileName || "";
        tempLink.style.display = "none";
        document.body.appendChild(tempLink);
        tempLink.click();
        tempLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
        return;
      } catch (_error) {
        // Fall back to a normal anchor download below.
      }
    }

    const fallbackLink = document.createElement("a");
    fallbackLink.href = absoluteHref;
    fallbackLink.download = fileName || "";
    fallbackLink.rel = "noopener";
    fallbackLink.style.display = "none";
    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    fallbackLink.remove();
  };

  const bindCardDownloads = () => {
    if (cardDownloadBound) return;
    cardDownloadBound = true;

    document.addEventListener(
      "click",
      async (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const card = event.target.closest(".download-card[data-download-file]");
        if (!card) return;

        event.preventDefault();
        event.stopPropagation();
        const downloadPath =
          card.dataset.downloadPath || `../../assets/aiformula/documents/${card.dataset.downloadFile}`;
        await startFileDownload(downloadPath, card.dataset.downloadFile);
      },
      true
    );
  };

  const bindSmoothScroll = () => {
    if (smoothScrollBound) return;
    smoothScrollBound = true;

    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = event.target.closest('a[href^="#"]');
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      const target = getHashTarget(href);
      if (!target) return;

      event.preventDefault();
      smoothScrollToHash(href, true);
    });
  };

  const bindLayoutResize = () => {
    if (layoutResizeBound) return;
    layoutResizeBound = true;

    window.addEventListener("resize", () => {
      updateLayoutOffsets();
    });
  };

  const ensureProjectSidebarLabel = () => {
    if (!document.body.classList.contains("projects-subpage")) return;

    const sidebarInner = document.querySelector(".md-sidebar--primary .md-sidebar__inner");
    if (!sidebarInner) return;

    let label = sidebarInner.querySelector(":scope > .project-sidebar-label");
    if (!label) {
      label = document.createElement("div");
      label.className = "project-sidebar-label";
      label.textContent = "Contents";
      sidebarInner.prepend(label);
    }
  };

  const scheduleProjectSidebarLabel = () => {
    ensureProjectSidebarLabel();
    window.requestAnimationFrame(ensureProjectSidebarLabel);
    window.setTimeout(ensureProjectSidebarLabel, 90);
  };

  const getTopLevelTocItem = (node, tocRoot) => {
    let item = node?.closest(".md-nav__item");

    while (item && item.parentElement && item.parentElement !== tocRoot) {
      item = item.parentElement.closest(".md-nav__item");
    }

    return item;
  };

  const clearAiformulaScrollSync = () => {
    if (!teardownAiformulaScrollSync) return;
    teardownAiformulaScrollSync();
    teardownAiformulaScrollSync = null;
  };

  const setupAiformulaScrollSync = () => {
    clearAiformulaScrollSync();

    if (!document.body.classList.contains("page-aiformula")) return;

    const tocRoot = document.querySelector(".md-sidebar--primary [data-md-component='toc']");
    const tocScrollContainer = document.querySelector(".md-sidebar--primary .md-nav--primary");
    if (!tocRoot || !tocScrollContainer) return;

    const tocLinks = Array.from(tocRoot.querySelectorAll("a.md-nav__link[href^='#']"));
    const headingEntries = tocLinks
      .map((link) => {
        const href = link.getAttribute("href");
        const heading = getHashTarget(href);
        if (!heading) return null;

        const item = link.closest(".md-nav__item");
        const topItem = getTopLevelTocItem(link, tocRoot);
        return { heading, link, item, topItem };
      })
      .filter(Boolean);

    if (!headingEntries.length) return;

    let cachedOffsets = [];
    let activeHeadingId = "";
    let scrollTicking = false;

    const clearClasses = () => {
      tocRoot.querySelectorAll(".is-scroll-current").forEach((node) => {
        node.classList.remove("is-scroll-current");
      });

      tocRoot.querySelectorAll(".is-scroll-current-item").forEach((node) => {
        node.classList.remove("is-scroll-current-item");
      });
    };

    const refreshOffsets = () => {
      cachedOffsets = headingEntries
        .map((entry) => ({
          ...entry,
          top: entry.heading.getBoundingClientRect().top + window.scrollY,
        }))
        .sort((left, right) => left.top - right.top);
    };

    const ensureTocItemVisible = (link) => {
      if (!link) return;

      const linkRect = link.getBoundingClientRect();
      const containerRect = tocScrollContainer.getBoundingClientRect();
      const padding = 20;

      if (linkRect.top >= containerRect.top + padding && linkRect.bottom <= containerRect.bottom - padding) {
        return;
      }

      const targetTop = Math.max(link.offsetTop - tocScrollContainer.clientHeight * 0.32, 0);
      tocScrollContainer.scrollTo({
        top: targetTop,
        behavior: "smooth",
      });
    };

    const getCurrentEntry = () => {
      if (!cachedOffsets.length) return null;

      const marker = window.scrollY + getScrollOffset() + 28;
      let current = cachedOffsets[0];

      for (const entry of cachedOffsets) {
        if (entry.top <= marker) {
          current = entry;
        } else {
          break;
        }
      }

      const viewportBottom = window.scrollY + window.innerHeight;
      const pageBottom = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );

      if (viewportBottom >= pageBottom - 8) {
        return cachedOffsets[cachedOffsets.length - 1];
      }

      return current;
    };

    const syncCurrentToc = () => {
      const currentEntry = getCurrentEntry();
      if (!currentEntry) return;
      if (currentEntry.heading.id === activeHeadingId) return;

      activeHeadingId = currentEntry.heading.id;
      clearClasses();

      currentEntry.link.classList.add("is-scroll-current");
      currentEntry.item?.classList.add("is-scroll-current-item");

      if (currentEntry.topItem && currentEntry.topItem !== currentEntry.item) {
        currentEntry.topItem.classList.add("is-scroll-current-item");
      }

      ensureTocItemVisible(currentEntry.link);
    };

    const handleScroll = () => {
      if (scrollTicking) return;

      scrollTicking = true;
      window.requestAnimationFrame(() => {
        scrollTicking = false;
        syncCurrentToc();
      });
    };

    const handleResize = () => {
      refreshOffsets();
      syncCurrentToc();
    };

    refreshOffsets();
    syncCurrentToc();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("load", handleResize);
    window.setTimeout(handleResize, 140);
    window.setTimeout(handleResize, 600);

    teardownAiformulaScrollSync = () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("load", handleResize);
      clearClasses();
    };
  };

  const applyNavigationUi = () => {
    const body = document.body;
    if (!body) return;

    updateLayoutOffsets();
    bindLayoutResize();

    body.classList.remove(
      "projects-subpage",
      "page-enter-active",
      "page-aiformula",
      "page-aiformula-chapter",
      "has-project-nav-visible",
      "has-project-nav-open",
      "has-focused-toc",
      "toc-auto-open"
    );

    document.querySelectorAll(".project-scroll-nav").forEach((nav) => nav.remove());

    const path = window.location.pathname.replace(/\\/g, "/");
    const isProjectsSubpage =
      (/\/projects\/[^/]+\/?$/.test(path) || /\/projects\/[^/]+\/index\.html$/.test(path)) &&
      !(/\/projects\/?$/.test(path) || /\/projects\/index\.html$/.test(path));
    const isAiformulaOverview = /\/projects\/aiformula\/?$/.test(path) || /\/projects\/aiformula\/index\.html$/.test(path);
    const isAiformulaChapter =
      /\/projects\/aiformula\/[^/]+\/?$/.test(path) || /\/projects\/aiformula\/[^/]+\/index\.html$/.test(path);

    if (isProjectsSubpage) {
      body.classList.add("projects-subpage");
    }

    if (isAiformulaOverview || isAiformulaChapter) {
      body.classList.add("page-aiformula");
    }

    if (isAiformulaChapter) {
      body.classList.add("page-aiformula-chapter");
    }

    bindSmoothScroll();
    bindCardDownloads();
    setupReferenceVaults();
    scheduleProjectSidebarLabel();
    setupAiformulaScrollSync();

    window.requestAnimationFrame(() => {
      body.classList.add("page-enter-active");
    });
  };

  if (typeof document$ !== "undefined" && document$.subscribe) {
    document$.subscribe(() => {
      applyNavigationUi();
    });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyNavigationUi, { once: true });
  } else {
    applyNavigationUi();
  }
})();
