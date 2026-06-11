/*
 * background.js - lightweight service worker.
 *
 * Its only job is to keep the toolbar icon badge in sync with the number of
 * temp-followed users that are "due" for cleanup, so you get a glanceable
 * reminder without opening the popup.
 *
 * Kept self-contained (reads chrome.storage directly) so the service worker has
 * zero import/lifecycle surprises.
 */

const KEYS = { FOLLOWS: "xf_follows", SETTINGS: "xf_settings" };
const DEFAULT_SETTINGS = { cleanupDays: 3, showMarkers: true, followOnTrack: true };
const DAY_MS = 24 * 60 * 60 * 1000;

async function getLocal(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res && res[key] != null ? res[key] : fallback;
}

async function updateBadge() {
  const [follows, savedSettings] = await Promise.all([
    getLocal(KEYS.FOLLOWS, {}),
    getLocal(KEYS.SETTINGS, {}),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...savedSettings };
  const now = Date.now();

  let due = 0;
  for (const entry of Object.values(follows)) {
    if (
      entry.status === "following" &&
      now - entry.followedAt >= settings.cleanupDays * DAY_MS
    ) {
      due++;
    }
  }

  const text = due > 0 ? (due > 99 ? "99+" : String(due)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#ffb020" });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[KEYS.FOLLOWS] || changes[KEYS.SETTINGS])) {
    updateBadge();
  }
});

// "Due" status is time-based, so re-evaluate periodically even without changes.
chrome.alarms.create("xf-refresh", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "xf-refresh") updateBadge();
});

updateBadge();
