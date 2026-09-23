# Commands

Sidebar group **Commands**. In the app, expand this section in the left nav (or search `/explore`).

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Send Commands | `/commands` | Send a remote command (wake, lock, climate, port, …). | Renders an empty state when no data is available — the page is not hidden. |
| Command History | `/command-history` | Audit log of every command sent and its result. | Renders an empty state when no data is available — the page is not hidden. |
| Command Reliability | `/command-reliability` | Grade every recorded attempt for the selected vehicle and date range, including older commands beyond the recent-history page; compare success, retries, and recurring failures. | Renders an empty state when no data is available — the page is not hidden. |

The Send Commands page keeps vehicle readiness and execution controls; historical
attempts belong in Command History and Command Reliability rather than a second
activity card. Reliability's date picker filters the backend history query,
which reads cursor-paged attempts instead of stopping after the first page.

[← All groups](./catalogue.md)
