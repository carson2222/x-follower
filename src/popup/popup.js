/*
 * popup.js - the review & cleanup panel.
 *
 * Lets you see everyone you temp-followed, grouped by how long ago, and:
 *   - open their profile (in a new tab) so you can unfollow them, or
 *   - mark them cleaned / remove them straight from the list.
 *
 * The native unfollow hook in content.js will also auto-mark people as cleaned
 * when you unfollow them on X, so this list stays honest.
 */
(function () {
  "use strict";

  const Store = globalThis.XFStore;

  const els = {
    summary: document.getElementById("summary"),
    list: document.getElementById("list"),
    tabs: document.getElementById("tabs"),
    batchControls: document.getElementById("batchControls"),
    openDue: document.getElementById("openDue"),
    batchSize: document.getElementById("batchSize"),
    settingsToggle: document.getElementById("settingsToggle"),
    settingsPanel: document.getElementById("settingsPanel"),
    cleanupDays: document.getElementById("cleanupDays"),
    showMarkers: document.getElementById("showMarkers"),
    followOnTrack: document.getElementById("followOnTrack"),
    clearUnfollowed: document.getElementById("clearUnfollowed"),
  };

  let state = {
    filter: "due",
    follows: {},
    settings: { ...Store.DEFAULT_SETTINGS },
  };

  function setSettingsOpen(open) {
    els.settingsPanel.hidden = !open;
    els.settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---- helpers ------------------------------------------------------------

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.55 17.6 4.4 12.45l1.4-1.4 3.75 3.75 8.25-8.25 1.4 1.4z"/></svg>';

  function profileUrl(handle) {
    return "https://x.com/" + encodeURIComponent(handle);
  }

  // Compact relative time for the meta line (keeps rows on one line).
  function shortRel(ts) {
    const d = Store.daysSince(ts);
    if (d <= 0) return "today";
    if (d === 1) return "1d ago";
    if (d < 7) return d + "d ago";
    if (d < 30) return Math.floor(d / 7) + "w ago";
    return Math.floor(d / 30) + "mo ago";
  }

  function dayBucketLabel(days) {
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return days + " days ago";
    if (days < 14) return "Last week";
    if (days < 30) return Math.floor(days / 7) + " weeks ago";
    if (days < 60) return "Last month";
    return Math.floor(days / 30) + " months ago";
  }

  function bucketOrder(days) {
    // Stable sortable rank so groups appear oldest-first (most urgent on top).
    return days;
  }

  function entriesForFilter() {
    const all = Object.values(state.follows);
    let list;
    switch (state.filter) {
      case "due":
        list = all.filter((e) => Store.isDue(e, state.settings));
        break;
      case "following":
        list = all.filter((e) => e.status === "following");
        break;
      case "unfollowed":
        list = all.filter((e) => e.status === "unfollowed");
        break;
      default:
        list = all;
    }
    // Oldest first (the ones most overdue for cleanup bubble to the top).
    return list.sort((a, b) => a.followedAt - b.followedAt);
  }

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  // ---- rendering ----------------------------------------------------------

  function render() {
    const all = Object.values(state.follows);
    const following = all.filter((e) => e.status === "following");
    const due = following.filter((e) => Store.isDue(e, state.settings));
    els.summary.textContent =
      following.length + " following · " + due.length + " due to clean";

    const batchSize = Number(els.batchSize.value);
    els.batchControls.hidden = state.filter !== "due";
    els.openDue.disabled = due.length === 0;
    els.openDue.textContent = "Open oldest " + Math.min(due.length, batchSize);

    const entries = entriesForFilter();
    els.list.innerHTML = "";

    if (entries.length === 0) {
      els.list.appendChild(renderEmpty());
      return;
    }

    let currentBucket = null;
    for (const entry of entries) {
      const days = Store.daysSince(entry.followedAt);
      const label = dayBucketLabel(days);
      if (label !== currentBucket) {
        currentBucket = label;
        els.list.appendChild(el("div", "xf-group-head", label));
      }
      els.list.appendChild(renderRow(entry, days));
    }
  }

  function renderEmpty() {
    const wrap = el("div", "xf-empty");
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/><path fill="currentColor" d="M12.75 7a.75.75 0 0 0-1.5 0v5c0 .27.14.52.37.65l3.5 2a.75.75 0 1 0 .76-1.3l-3.13-1.79V7Z"/></svg>';
    const msg = {
      due: "Nothing due yet. Temp-follow people on X and they'll show up here when it's time to prune.",
      following: "You haven't temp-followed anyone yet.",
      unfollowed: "No cleaned-up users yet.",
      all: "No temp follows recorded. Hit the clock button on X to start.",
    }[state.filter];
    wrap.appendChild(el("div", null, msg));
    return wrap;
  }

  function renderRow(entry, days) {
    const row = el("div", "xf-row");

    const main = el("div", "xf-row-main");
    const handleLink = el("a", "xf-handle");
    handleLink.href = profileUrl(entry.handle);
    handleLink.target = "_blank";
    handleLink.rel = "noopener";
    handleLink.textContent = "@" + entry.handle;
    if (entry.displayName) {
      const name = el("span", "xf-name", " · " + escapeHtml(entry.displayName));
      handleLink.appendChild(name);
    }
    main.appendChild(handleLink);

    const meta = el("div", "xf-meta");
    let chip;
    if (entry.status === "unfollowed") {
      chip = '<span class="xf-chip xf-chip--cleaned">cleaned</span>';
    } else if (Store.isDue(entry, state.settings)) {
      chip = '<span class="xf-chip xf-chip--due">due</span>';
    } else {
      chip = '<span class="xf-chip xf-chip--following">following</span>';
    }
    const when =
      entry.status === "unfollowed" && entry.unfollowedAt
        ? "cleaned " + shortRel(entry.unfollowedAt)
        : "followed " + shortRel(entry.followedAt);
    meta.innerHTML = chip + "<span>" + escapeHtml(when) + "</span>";
    main.appendChild(meta);

    row.appendChild(main);
    row.appendChild(renderActions(entry));
    return row;
  }

  function renderActions(entry) {
    const actions = el("div", "xf-actions");

    if (entry.status === "following") {
      const open = el("a", "xf-act xf-act--primary", "Open");
      open.href = profileUrl(entry.handle);
      open.target = "_blank";
      open.rel = "noopener";
      open.title = "Open profile to unfollow";
      actions.appendChild(open);

      const done = el("button", "xf-act xf-act--icon", CHECK_SVG);
      done.title = "Mark as cleaned (unfollowed)";
      done.addEventListener("click", async () => {
        await Store.markUnfollowed(entry.handle);
        await reload();
      });
      actions.appendChild(done);
    }

    const del = el("button", "xf-act xf-act--icon xf-act--danger", "\u2715");
    del.title = "Remove from list";
    del.addEventListener("click", async () => {
      await Store.remove(entry.handle);
      await reload();
    });
    actions.appendChild(del);

    return actions;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  // ---- data ---------------------------------------------------------------

  async function reload() {
    const [follows, settings] = await Promise.all([
      Store.getFollows(),
      Store.getSettings(),
    ]);
    state.follows = follows;
    state.settings = settings;
    syncSettingsInputs();
    render();
  }

  function syncSettingsInputs() {
    els.cleanupDays.value = state.settings.cleanupDays;
    els.showMarkers.checked = !!state.settings.showMarkers;
    els.followOnTrack.checked = !!state.settings.followOnTrack;
  }

  // ---- events -------------------------------------------------------------

  function wireEvents() {
    els.tabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".xf-tab");
      if (!tab) return;
      state.filter = tab.dataset.filter;
      els.tabs.querySelectorAll(".xf-tab").forEach((t) =>
        t.classList.toggle("xf-tab--active", t === tab)
      );
      render();
    });

    els.batchSize.addEventListener("change", render);

    els.openDue.addEventListener("click", () => {
      const batchSize = Number(els.batchSize.value);
      const due = Object.values(state.follows)
        .filter((entry) => Store.isDue(entry, state.settings))
        .sort((a, b) => a.followedAt - b.followedAt)
        .slice(0, batchSize);
      for (const entry of due) chrome.tabs.create({ url: profileUrl(entry.handle) });
    });

    els.settingsToggle.addEventListener("click", () => {
      setSettingsOpen(els.settingsPanel.hidden);
    });

    els.cleanupDays.addEventListener("change", async () => {
      let v = parseInt(els.cleanupDays.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      await Store.setSettings({ cleanupDays: v });
      await reload();
    });

    els.showMarkers.addEventListener("change", async () => {
      await Store.setSettings({ showMarkers: els.showMarkers.checked });
    });

    els.followOnTrack.addEventListener("change", async () => {
      await Store.setSettings({ followOnTrack: els.followOnTrack.checked });
    });

    els.clearUnfollowed.addEventListener("click", async () => {
      const n = await Store.clearUnfollowed();
      if (n > 0) await reload();
    });

    Store.onChanged(reload);
  }

  setSettingsOpen(false);
  wireEvents();
  reload();
})();
