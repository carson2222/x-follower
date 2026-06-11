/*
 * content.js - runs on x.com / twitter.com.
 *
 * Responsibilities:
 *   1. Find every native "Follow" button and inject a compact "Temp Follow"
 *      button right next to it.
 *   2. When the temp button is clicked: record the user (with a timestamp) and
 *      trigger the real Follow so the actual follow still happens through X's
 *      own UI (most reliable, no private API calls).
 *   3. Show a small marker next to users who are currently in your temp list so
 *      temp-followed profiles are visually distinct.
 *   4. Watch native "Unfollow" actions: if you unfollow someone who's in your
 *      temp list, automatically mark them as cleaned up.
 *
 * X is a single-page app that constantly re-renders, so everything is driven by
 * a throttled MutationObserver plus an in-memory cache of tracked handles.
 */
(function () {
  "use strict";

  const Store = globalThis.XFStore;
  if (!Store) return; // storage.js must load first (see manifest order)

  // ---- selectors (verified against X's current DOM) -----------------------
  const SEL = {
    follow: '[data-testid$="-follow"], [data-testid="follow"]',
    unfollow: '[data-testid$="-unfollow"], [data-testid="unfollow"]',
    confirm: '[data-testid="confirmationSheetConfirm"]',
    userCell: '[data-testid="UserCell"]',
    userName: '[data-testid="UserName"]',
    toast: '[data-testid="toast"]',
    hoverCard: '[role="dialog"], [data-testid="HoverCard"]',
  };

  // Toast copy that means the follow did NOT go through (rate limits, errors).
  const FOLLOW_FAILURE_RE =
    /unable to follow|limit|too many|something went wrong|try again|couldn'?t/i;

  const HANDLE_RE = /@([A-Za-z0-9_]{1,15})/;
  const PROFILE_PATH_RE = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/;
  // Reserved first-path segments on X that are NOT usernames.
  const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "compose", "search",
    "settings", "i", "hashtag", "bookmarks", "lists", "communities",
    "jobs", "topics", "tos", "privacy", "login", "signup", "intent",
    "verified_followers", "following", "followers",
  ]);

  // In-memory cache of handles currently in "following" status. Kept in sync
  // with storage so marker rendering is synchronous and cheap.
  let trackedFollowing = new Set();
  let trackedEntries = new Map();

  // Captured when a native unfollow button is clicked, committed when the
  // confirmation dialog's confirm button is clicked.
  let pendingUnfollow = null;

  // -------------------------------------------------------------------------
  // Handle / user extraction
  // -------------------------------------------------------------------------

  function userIdFromButton(btn) {
    const tid = btn.getAttribute("data-testid") || "";
    const id = tid.split("-")[0];
    return /^\d+$/.test(id) ? id : null;
  }

  function handleFromAriaLabel(btn) {
    const label = btn.getAttribute("aria-label") || "";
    const m = label.match(HANDLE_RE);
    return m ? m[1] : null;
  }

  function userContainerForButton(btn) {
    return (
      btn.closest(SEL.userCell) ||
      btn.closest("article") ||
      btn.closest(SEL.hoverCard) ||
      btn.closest('[data-testid="UserName"]')?.parentElement ||
      btn.parentElement
    );
  }

  function handleFromContainer(btn) {
    const container = userContainerForButton(btn);
    if (!container) return null;

    // Prefer a link whose visible text looks like "@handle".
    const links = container.querySelectorAll('a[role="link"][href^="/"]');
    for (const a of links) {
      const text = (a.textContent || "").trim();
      if (text.startsWith("@")) {
        const m = text.match(HANDLE_RE);
        if (m) return m[1];
      }
    }
    // Otherwise fall back to the first link whose href is a bare profile path.
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const m = href.match(PROFILE_PATH_RE);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    return null;
  }

  function handleFromUrl() {
    const m = location.pathname.match(PROFILE_PATH_RE);
    if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    return null;
  }

  function displayNameFromContainer(btn) {
    const container = userContainerForButton(btn);
    if (!container) {
      // Profile header case.
      const un = document.querySelector(SEL.userName);
      if (un) {
        const span = un.querySelector("span");
        if (span) return span.textContent.trim() || null;
      }
      return null;
    }
    const nameBlock = container.querySelector('[data-testid="User-Name"], [data-testid="UserName"]');
    if (nameBlock) {
      const span = nameBlock.querySelector("span");
      if (span) {
        const t = span.textContent.trim();
        if (t && !t.startsWith("@")) return t;
      }
    }
    return null;
  }

  /** Best-effort extraction of {handle, displayName, userId} for a button. */
  function extractUser(btn) {
    let handle = handleFromAriaLabel(btn) || handleFromContainer(btn);
    // The big follow button on a profile page often has no @handle nearby.
    if (!handle && (btn.closest('[data-testid="UserName"]') || isProfileHeaderButton(btn))) {
      handle = handleFromUrl();
    }
    if (!handle) handle = handleFromContainer(btn) || handleFromUrl();
    return {
      handle,
      displayName: displayNameFromContainer(btn),
      userId: userIdFromButton(btn),
    };
  }

  function isProfileHeaderButton(btn) {
    // Heuristic: a follow button that lives high in the page (the profile
    // header) rather than inside a list cell or tweet.
    return !btn.closest(SEL.userCell) && !btn.closest("article") && !btn.closest(SEL.hoverCard);
  }

  function userFollowsViewer(btn) {
    const label = btn.getAttribute("aria-label") || "";
    const text = (btn.textContent || "").trim();
    if (/follow back/i.test(label) || /follow back/i.test(text)) return true;

    const container = userContainerForButton(btn);
    if (!container) return false;

    if (container.querySelector('[data-testid="userFollowIndicator"]')) return true;
    return /\bFollows you\b/i.test(container.textContent || "");
  }

  // -------------------------------------------------------------------------
  // UI building
  // -------------------------------------------------------------------------

  const CLOCK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/>' +
    '<path fill="currentColor" d="M12.75 7a.75.75 0 0 0-1.5 0v5c0 .27.14.52.37.65l3.5 2a.75.75 0 1 0 .76-1.3l-3.13-1.79V7Z"/>' +
    "</svg>";

  function buildTempButton(btn) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "xf-temp-btn";
    if (isProfileHeaderButton(btn)) el.classList.add("xf-temp-btn--header");
    el.setAttribute("data-xf", "temp");
    el.setAttribute("aria-label", "Temp follow (track for later cleanup)");
    el.title = "Temp follow - follows now and saves them so you can unfollow later";
    el.innerHTML = CLOCK_SVG;
    el.addEventListener("click", (e) => onTempClick(e, btn, el));
    return el;
  }

  function setDueHighlight(btn, isDue) {
    const surface = btn.closest(SEL.userCell) || btn.closest("article") || btn.closest(SEL.hoverCard);
    if (!surface) return;
    surface.classList.toggle("xf-due-row", !!isDue);
  }

  function trackedEntryFor(handle) {
    return trackedEntries.get(Store.normalizeHandle(handle)) || null;
  }

  function markerIsDue(entry) {
    return Store.isDue(entry, cachedSettings);
  }

  function applyMarkerState(marker, handle, entry) {
    const due = markerIsDue(entry);
    marker.classList.toggle("xf-marker--due", due);
    marker.title = due
      ? "@" + handle + " is due for cleanup"
      : "You temp-followed @" + handle + " - pending cleanup";
  }

  function buildMarker(handle, entry) {
    const el = document.createElement("span");
    el.className = "xf-marker";
    el.setAttribute("data-xf", "marker");
    el.innerHTML = CLOCK_SVG;
    applyMarkerState(el, handle, entry);
    return el;
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Resolve the current follow state for a user, preferring the stable id. */
  function followState(userId, btn) {
    if (userId) {
      if (document.querySelector('[data-testid="' + userId + '-unfollow"]'))
        return "following";
      if (document.querySelector('[data-testid="' + userId + '-follow"]'))
        return "not-following";
    }

    const scope = btn ? userContainerForButton(btn) : null;
    if (scope) {
      if (scope.querySelector(SEL.unfollow)) return "following";
      if (scope.querySelector(SEL.follow)) return "not-following";
    }

    // Fall back to the (possibly detached) button element's last known testid.
    const tid = btn ? btn.getAttribute("data-testid") || "" : "";
    if (tid === "unfollow" || tid.endsWith("-unfollow")) return "following";
    if (tid === "follow" || tid.endsWith("-follow")) return "not-following";
    return null;
  }

  function followFailureToast() {
    const toast = document.querySelector(SEL.toast);
    if (!toast) return false;
    return FOLLOW_FAILURE_RE.test(toast.textContent || "");
  }

  /**
   * Click X's real Follow button and confirm the action actually stuck.
   *
   * X optimistically flips the button to "Following" immediately, but on a rate
   * limit or error it reverts to "Follow" a beat later and shows a toast. So we
   * click, then poll the *stable* follow state for a settle window, bailing out
   * early if a failure toast appears. Returns true only if it ends up following.
   */
  async function performVerifiedFollow(btn, userId) {
    if (followState(userId, btn) === "following") return true; // already done

    btn.click();

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (followFailureToast()) return false; // explicit rejection
      // keep polling so we catch an optimistic flip that later reverts
    }
    return followState(userId, btn) === "following";
  }

  async function onTempClick(e, nativeBtn, tempBtn) {
    e.preventDefault();
    e.stopPropagation();
    if (tempBtn.dataset.xfBusy === "1") return;

    const info = extractUser(nativeBtn);
    if (!info.handle) {
      flash(tempBtn, "✕", "No username", true);
      return;
    }

    const settings = await Store.getSettings();

    // If auto-follow is off, the user is just bookmarking someone they already
    // follow - nothing can fail, so record directly.
    if (!settings.followOnTrack) {
      const entry = await Store.track(info);
      trackedFollowing.add(info.handle.toLowerCase());
      trackedEntries.set(Store.normalizeHandle(info.handle), entry);
      tempBtn.classList.add("xf-tracked");
      flash(tempBtn, "✓", "Saved");
      return;
    }

    setBusy(tempBtn, true);
    const ok = await performVerifiedFollow(nativeBtn, info.userId);
    setBusy(tempBtn, false);

    if (!ok) {
      // The follow did not go through (likely rate-limited) - do NOT record it,
      // so it can't pollute the cleanup list.
      flash(tempBtn, "✕", "Follow failed", true);
      return;
    }

    const entry = await Store.track(info);
    trackedFollowing.add(info.handle.toLowerCase());
    trackedEntries.set(Store.normalizeHandle(info.handle), entry);
    tempBtn.classList.add("xf-tracked");
    flash(tempBtn, "✓", "Tracked");
  }

  function setBusy(el, busy) {
    el.dataset.xfBusy = busy ? "1" : "";
    el.classList.toggle("xf-busy", busy);
    if (busy) {
      el._xfPrev = el.innerHTML;
      el.innerHTML = '<span class="xf-spinner" aria-hidden="true"></span>';
    } else if (el._xfPrev != null) {
      el.innerHTML = el._xfPrev;
      el._xfPrev = null;
    }
  }

  function flash(el, glyph, label, isError) {
    const prev = el._xfPrev != null ? el._xfPrev : el.innerHTML;
    el._xfPrev = null;
    const cls = isError ? "xf-error" : "xf-flash";
    el.innerHTML = '<span class="xf-temp-glyph">' + glyph + "</span>";
    el.title = label;
    el.classList.add(cls);
    setTimeout(() => {
      el.classList.remove(cls);
      el.innerHTML = prev;
    }, isError ? 1800 : 1100);
  }

  function ensureControlWrap(btn) {
    const parent = btn.parentElement;
    if (!parent) return null;
    if (parent.classList && parent.classList.contains("xf-control-wrap")) {
      return parent;
    }

    const wrap = document.createElement("span");
    wrap.className = "xf-control-wrap";
    wrap.setAttribute("data-xf", "wrap");
    parent.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    return wrap;
  }

  function wrapChild(wrap, selector) {
    if (!wrap) return null;
    for (const child of wrap.children) {
      if (child.matches && child.matches(selector)) return child;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Injection / scanning
  // -------------------------------------------------------------------------

  function injectIntoFollowButton(btn) {
    const info = extractUser(btn);
    if (!info.handle) {
      // X often renders the button before the surrounding user text/link is
      // available. Do not mark it skipped permanently; a later scan can resolve
      // the handle once the card finishes hydrating.
      return;
    }
    const wrap = ensureControlWrap(btn);
    if (!wrap) return;

    let marker = wrapChild(wrap, ".xf-marker");
    let tempBtn = wrapChild(wrap, ".xf-temp-btn");
    const entry = trackedEntryFor(info.handle);
    const tracked = !!entry;
    const due = tracked && markerIsDue(entry);
    setDueHighlight(btn, due);

    // If they already follow you, don't show a temp-follow action. Only keep the
    // amber marker if you had temp-followed them earlier and they're still
    // pending cleanup.
    if (userFollowsViewer(btn)) {
      if (tempBtn) tempBtn.remove();
      if (tracked && cachedSettings.showMarkers) {
        if (!marker) {
          wrap.appendChild(buildMarker(info.handle, entry));
        } else {
          applyMarkerState(marker, info.handle, entry);
        }
      } else if (marker) {
        marker.remove();
      }
      return;
    }

    if (marker) marker.remove();

    if (!tempBtn) {
      tempBtn = buildTempButton(btn);
      wrap.appendChild(tempBtn);
    }
    if (tracked) tempBtn.classList.add("xf-tracked");
    else tempBtn.classList.remove("xf-tracked");
  }

  function updateUnfollowMarker(btn, showMarkers) {
    const info = extractUser(btn);
    const entry = info.handle ? trackedEntryFor(info.handle) : null;
    const isTracked = !!entry;
    setDueHighlight(btn, isTracked && markerIsDue(entry));
    const wrap = ensureControlWrap(btn);
    if (!wrap) return;

    const tempBtn = wrapChild(wrap, ".xf-temp-btn");
    if (tempBtn) tempBtn.remove();

    const marker = wrapChild(wrap, ".xf-marker");

    if (isTracked && showMarkers) {
      if (!marker) {
        wrap.appendChild(buildMarker(info.handle, entry));
      } else {
        applyMarkerState(marker, info.handle, entry);
      }
    } else if (marker) {
      marker.remove();
    }
  }

  let scanQueued = false;
  let cachedSettings = { ...Store.DEFAULT_SETTINGS };

  function scan() {
    scanQueued = false;
    document.querySelectorAll(SEL.follow).forEach(injectIntoFollowButton);
    document.querySelectorAll(SEL.unfollow).forEach((b) =>
      updateUnfollowMarker(b, cachedSettings.showMarkers)
    );
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  function installNavigationWatcher() {
    const notify = () => setTimeout(queueScan, 250);
    const wrap = (method) => {
      const original = history[method];
      history[method] = function () {
        const result = original.apply(this, arguments);
        notify();
        return result;
      };
    };

    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", notify);
  }

  // -------------------------------------------------------------------------
  // Native unfollow hook (capture phase, before X handles the click)
  // -------------------------------------------------------------------------

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      const unfollowBtn = target.closest(SEL.unfollow);
      if (unfollowBtn) {
        const info = extractUser(unfollowBtn);
        pendingUnfollow = info.handle
          ? { handle: info.handle.toLowerCase(), userId: info.userId }
          : null;
        return;
      }

      const confirmBtn = target.closest(SEL.confirm);
      if (confirmBtn && pendingUnfollow) {
        const { handle, userId } = pendingUnfollow;
        pendingUnfollow = null;
        verifyUnfollowThenMark(handle, userId);
      }
    },
    true
  );

  /**
   * Mark a tracked user as cleaned - but only after confirming the unfollow
   * actually went through. Like follows, X can reject an unfollow (rate limit),
   * and we don't want to wrongly hide someone you're still following.
   */
  async function verifyUnfollowThenMark(handle, userId) {
    if (!handle) return;
    const follows = await Store.getFollows();
    if (!follows[handle]) return; // not one of ours; ignore

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (followFailureToast()) return; // unfollow rejected
      if (followState(userId, null) === "not-following") {
        const changed = await Store.markUnfollowed(handle);
        if (changed) {
          trackedFollowing.delete(handle);
          trackedEntries.delete(handle);
        }
        return;
      }
    }
    // Couldn't confirm - leave the entry as-is rather than mislabel it.
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  async function refreshCacheFromStorage() {
    const [follows, settings] = await Promise.all([
      Store.getFollows(),
      Store.getSettings(),
    ]);
    cachedSettings = settings;
    trackedEntries = new Map();
    trackedFollowing = new Set(
      Object.values(follows)
        .filter((f) => f.status === "following")
        .map((f) => {
          const key = Store.normalizeHandle(f.handle);
          trackedEntries.set(key, f);
          return key;
        })
    );
  }

  async function init() {
    await refreshCacheFromStorage();
    queueScan();

    const observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    installNavigationWatcher();

    // Safety net for X virtualized lists: occasionally rescan visible DOM so a
    // missed mutation or late-hydrated user card recovers without a page reload.
    setInterval(queueScan, 2500);

    // Keep the in-memory cache fresh when storage changes (e.g. from the popup
    // or another tab) and re-render markers/buttons accordingly.
    Store.onChanged(async () => {
      await refreshCacheFromStorage();
      // Re-evaluate tracked state on existing temp buttons.
      document.querySelectorAll('.xf-temp-btn').forEach((tb) => {
        const native = tb.parentElement?.querySelector(
          '[data-testid$="-follow"], [data-testid="follow"], [data-testid$="-unfollow"], [data-testid="unfollow"]'
        );
        if (!native) return;
        const info = extractUser(native);
        tb.classList.toggle(
          "xf-tracked",
          !!(info.handle && trackedFollowing.has(info.handle.toLowerCase()))
        );
      });
      queueScan();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
