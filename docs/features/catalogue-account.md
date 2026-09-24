# Account

Sidebar group **Account**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Tesla Account | `/tesla-account` | Linked Tesla account, refresh-token status, and re-auth. | Empty until Tesla Fleet API is connected in Settings → Fleet Setup. |
| Active Orders | `/tesla-orders` | Active orders on your Tesla account. | Renders an empty state when no data is available — the page is not hidden. |
| Fleet API | `/fleet-api` | Fleet API rate-limit usage and registration details. | Empty until Tesla Fleet API is connected in Settings → Fleet Setup. |
| Region & API | `/tesla-region` | Switch Fleet API region (NA, EU, China). | Renders an empty state when no data is available — the page is not hidden. |
| Feature Flags | `/tesla-features` | Tesla feature-flag previews exposed by your firmware version. | Renders an empty state when no data is available — the page is not hidden. |
| Two-Factor Auth | `/account/2fa` | Enroll or disable two-factor authentication on your account. | Renders an empty state when no data is available — the page is not hidden. |
| Active Sessions | `/account/sessions` | Browser and device sessions — page through active devices (25, 50, or 100 per page) and revoke individual sessions or all other devices. Summary cards cover all sessions, not just the visible page. | Renders an empty state when no data is available — the page is not hidden. |
| Privacy | `/account/privacy` | Recently viewed pages, cookies, and analytics consent. | Renders an empty state when no data is available — the page is not hidden. |
| My Activity | `/me/activity` | Your recent page views and actions in this app. | Renders an empty state when no data is available — the page is not hidden. |

[← All groups](./catalogue.md)
