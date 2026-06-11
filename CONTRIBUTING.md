# Contributing

This is intentionally a small browser extension. Keep changes boring and easy to
review.

## Principles

- Local-first: no servers, analytics, tracking, or remote config.
- Manual actions only: do not add bulk follow/unfollow automation.
- Use X's visible UI state rather than private APIs.
- Keep dependencies at zero unless there is a strong reason.
- Prefer small selector fixes and simple UI changes over large rewrites.

## Testing

Run syntax checks:

```sh
node --check src/lib/storage.js
node --check src/content/content.js
node --check src/popup/popup.js
node --check src/background/background.js
node --check scripts/gen-icons.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"
```

Manual browser test:

1. Load the repository folder as an unpacked extension.
2. Refresh `https://x.com`.
3. Confirm the clock action appears next to normal Follow buttons.
4. Confirm it does not appear for accounts that already show `Follows you`,
   unless they were previously tracked and need the amber pending marker.
5. Confirm the popup loads and settings stay collapsed by default.
