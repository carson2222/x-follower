/*
 * storage.js - single source of truth for all persisted data.
 *
 * Loaded as a classic script in two places:
 *   1. The content script (declared before content.js in manifest.json)
 *   2. The popup (via a <script> tag in popup.html)
 *
 * It attaches a small `XFStore` API onto the global scope. Everything is
 * persisted in `chrome.storage.local`, which is plenty for this amount of
 * data and survives browser restarts.
 *
 * Data model
 * ----------
 * follows: a map keyed by the lowercased handle so each user appears once.
 *   {
 *     [handleLower]: {
 *       handle:      "elonmusk",      // canonical handle (without @)
 *       displayName: "Elon Musk",     // best-effort, may be null
 *       userId:      "44196397",      // numeric id from the button testid, may be null
 *       followedAt:  1699999999999,   // epoch ms when temp-followed
 *       unfollowedAt:null,            // epoch ms when later unfollowed, else null
 *       status:      "following"      // "following" | "unfollowed"
 *     }
 *   }
 *
 * settings:
 *   { cleanupDays: 3, showMarkers: true, followOnTrack: true }
 */
(function (global) {
  "use strict";

  const KEYS = {
    FOLLOWS: "xf_follows",
    SETTINGS: "xf_settings",
  };

  const DEFAULT_SETTINGS = {
    cleanupDays: 3, // a user becomes "due for cleanup" this many days after temp-follow
    showMarkers: true, // show the little badge next to tracked users on X
    followOnTrack: true, // also trigger the real Follow when temp-following
  };

  const DAY_MS = 24 * 60 * 60 * 1000;

  function normalizeHandle(handle) {
    if (!handle) return "";
    return String(handle).trim().replace(/^@+/, "").toLowerCase();
  }

  async function readKey(key, fallback) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (res) => {
        resolve(res && res[key] != null ? res[key] : fallback);
      });
    });
  }

  async function writeKey(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }

  const XFStore = {
    KEYS,
    DAY_MS,
    DEFAULT_SETTINGS,
    normalizeHandle,

    async getFollows() {
      return readKey(KEYS.FOLLOWS, {});
    },

    async getSettings() {
      const saved = await readKey(KEYS.SETTINGS, {});
      return { ...DEFAULT_SETTINGS, ...saved };
    },

    async setSettings(patch) {
      const current = await this.getSettings();
      const next = { ...current, ...patch };
      await writeKey(KEYS.SETTINGS, next);
      return next;
    },

    /**
     * Upsert a temp-followed user. If the user already exists we refresh the
     * followedAt timestamp and flip them back to "following" (useful if you
     * re-follow someone you previously cleaned up).
     */
    async track({ handle, displayName = null, userId = null }) {
      const key = normalizeHandle(handle);
      if (!key) return null;
      const follows = await this.getFollows();
      const existing = follows[key] || {};
      const entry = {
        handle: existing.handle || String(handle).replace(/^@+/, ""),
        displayName: displayName || existing.displayName || null,
        userId: userId || existing.userId || null,
        followedAt: Date.now(),
        unfollowedAt: null,
        status: "following",
      };
      follows[key] = entry;
      await writeKey(KEYS.FOLLOWS, follows);
      return entry;
    },

    /** Mark an existing tracked user as unfollowed. No-op if untracked. */
    async markUnfollowed(handle) {
      const key = normalizeHandle(handle);
      if (!key) return false;
      const follows = await this.getFollows();
      if (!follows[key]) return false;
      follows[key].status = "unfollowed";
      follows[key].unfollowedAt = Date.now();
      await writeKey(KEYS.FOLLOWS, follows);
      return true;
    },

    /** Remove a user from the list entirely. */
    async remove(handle) {
      const key = normalizeHandle(handle);
      if (!key) return false;
      const follows = await this.getFollows();
      if (!follows[key]) return false;
      delete follows[key];
      await writeKey(KEYS.FOLLOWS, follows);
      return true;
    },

    /** Delete every entry already marked as unfollowed. Returns count removed. */
    async clearUnfollowed() {
      const follows = await this.getFollows();
      let removed = 0;
      for (const key of Object.keys(follows)) {
        if (follows[key].status === "unfollowed") {
          delete follows[key];
          removed++;
        }
      }
      await writeKey(KEYS.FOLLOWS, follows);
      return removed;
    },

    /** True if the entry is still followed and old enough to be cleaned up. */
    isDue(entry, settings) {
      if (!entry || entry.status !== "following") return false;
      const days = settings ? settings.cleanupDays : DEFAULT_SETTINGS.cleanupDays;
      return Date.now() - entry.followedAt >= days * DAY_MS;
    },

    /** Whole number of days since a timestamp. */
    daysSince(ts) {
      return Math.floor((Date.now() - ts) / DAY_MS);
    },

    /** Subscribe to changes of our keys. Returns an unsubscribe function. */
    onChanged(callback) {
      const listener = (changes, area) => {
        if (area !== "local") return;
        if (changes[KEYS.FOLLOWS] || changes[KEYS.SETTINGS]) callback(changes);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };

  global.XFStore = XFStore;
})(typeof globalThis !== "undefined" ? globalThis : self);
