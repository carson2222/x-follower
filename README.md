# Temp Follow for X

A small Chromium extension for tracking temporary follows on X/Twitter.

It adds a compact clock button next to X's native Follow button. Clicking it uses
the real X follow control, waits until the follow actually succeeds, and then
saves the account locally with a timestamp. The popup shows who is due for
manual review after a configurable number of days.

This is a personal workflow tool. It does not use X APIs, does not run bulk
automation, and does not send data to any server.

## Features

- Adds a compact temp-follow control next to native Follow buttons.
- Records follows only after X confirms the account is followed.
- Shows an amber pending marker for accounts still waiting for cleanup.
- Hides the temp-follow control for accounts that already follow you, unless
  they were previously temp-followed and still need cleanup.
- Tracks native unfollow confirmation and marks records as cleaned only after
  the unfollow state is confirmed.
- Popup groups records by age and shows a Due view based on the cleanup window.
- Toolbar badge shows how many tracked follows are due.
- Stores everything in `chrome.storage.local`.

## Install Locally

1. Open `brave://extensions`, `chrome://extensions`, or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository folder, the one containing `manifest.json`.
5. Open or refresh `https://x.com`.

No hosting or build step is required for local use.

## Use

1. Click the clock button next to a Follow button.
2. Wait for the button to confirm. If X rejects the action, nothing is saved.
3. Open the extension popup to review tracked follows.
4. Open profiles manually when they are due and unfollow as needed.
5. The extension marks entries as cleaned after the native unfollow completes.

The default cleanup window is 3 days. Change it from the gear icon in the popup.

## UI States

- Teal clock button: available temp-follow action.
- Amber small marker: account is tracked and pending cleanup.
- Red flash: follow failed, usually because X rejected or rate-limited it.
- Spinner: waiting for X's UI state to settle.

## Project Structure

| Path | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 extension config. |
| `src/content/content.js` | Injects controls into X and verifies follow/unfollow state changes. |
| `src/content/content.css` | Styles injected controls. |
| `src/lib/storage.js` | Shared local-storage wrapper. |
| `src/popup/` | Popup UI for review and settings. |
| `src/background/background.js` | Updates the toolbar badge count. |
| `scripts/gen-icons.mjs` | Generates committed PNG icons without dependencies. |

## Privacy

The extension stores data only in browser-local extension storage. It does not
make network requests, collect analytics, or send data anywhere.

See [PRIVACY.md](PRIVACY.md) for the full short policy.

## Limitations

- X is a single-page app and its DOM can change. Selectors may need maintenance.
- This extension does not know who follows you back unless that state is visible
  in X's current UI.
- It is intentionally manual. It does not mass-follow, mass-unfollow, scrape X,
  or call private endpoints.
- Browser extension storage is tied to the installed extension and browser
  profile. Removing the extension may remove its data.

## Development

Validate the extension files:

```sh
node --check src/lib/storage.js
node --check src/content/content.js
node --check src/popup/popup.js
node --check src/background/background.js
node --check scripts/gen-icons.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
```

Regenerate icons:

```sh
node scripts/gen-icons.mjs
```

After editing files, reload the extension from the browser extensions page and
refresh X.

## Contributing

Small fixes are welcome. Keep the extension local-first, dependency-free, and
manual. Avoid analytics, remote services, private X API calls, and bulk actions.

## Disclaimer

This project is not affiliated with X Corp. Use it responsibly and at your own
risk. X may change its UI or restrict account actions at any time.

## License

MIT. See [LICENSE](LICENSE).
