# Privacy Policy

Temp Follow for X is local-only.

## Data Stored

The extension stores temporary-follow records in `chrome.storage.local`:

- X handle
- display name when visible
- numeric user id when visible in X's DOM
- followed timestamp
- cleanup/unfollow timestamp
- local status (`following` or `unfollowed`)
- extension settings, such as cleanup window

## Data Sharing

No data is sent to the developer, third parties, analytics services, or any
external server.

## Network Requests

The extension does not make its own network requests. It only interacts with the
current X page by clicking native UI controls and reading visible DOM state.

## Permissions

- `storage`: save local follow records and settings.
- `alarms`: refresh the toolbar badge count periodically.
- `https://x.com/*` and `https://twitter.com/*`: inject the content script on X.

## Removing Data

Use the popup to remove entries, or remove the extension from the browser to
delete extension-local storage for that browser profile.
