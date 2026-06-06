# TeslaSync.App.UITests — WinAppDriver UI automation (P2/W9-0002)

End-to-end UI automation for the packaged TeslaSync WinUI app. Every test is tagged
`[Trait("Category", "UIAutomation")]` and drives the **real app** out-of-process through the Windows
UI Automation tree via **WinAppDriver** (the W3C WebDriver endpoint on `http://127.0.0.1:4723`).

## Why a dependency-free driver client

`Drivers/WinAppDriverClient.cs` speaks the WebDriver HTTP protocol directly with `HttpClient` +
`System.Text.Json` — there is **no Appium/Selenium NuGet dependency**. No WinAppDriver/Appium client
is pinned in `apps/versions.lock.md`, and a self-contained client keeps `dotnet build` deterministic
and green even on an offline runner. The client negotiates both the legacy `desiredCapabilities` and
the W3C `capabilities` session shapes, so it works against classic WinAppDriver and an Appium 2
Windows driver alike.

## Required runner

The suite **executes** only when all of the following are present; otherwise every test fails fast
with an explicit reason (it is never silently skipped), and the gate ends `STATUS=BLOCKED`:

| Requirement | Notes |
|---|---|
| Windows 10 1809+ / Windows 11 | Developer Mode enabled |
| .NET 10 SDK | `dotnet` on PATH |
| Windows App SDK 2.1.3 | ADR-012 / `apps/versions.lock.md` |
| WinAppDriver 1.2.1+ | https://github.com/microsoft/WinAppDriver/releases — or set `TESLASYNC_UIA_DRIVER_URL` to an Appium 2 Windows-driver endpoint |
| Deployed packaged app | gives the app an AUMID; or a built `TeslaSync.App.exe` for an unpackaged launch |

Overrides: `TESLASYNC_UIA_APP` (explicit AUMID / exe path) and `TESLASYNC_UIA_DRIVER_URL`
(driver endpoint).

## Running

```powershell
# From the repo root — locates/starts WinAppDriver, resolves the app, runs the suite, archives artifacts.
./apps/windows/run-ui-automation.ps1            # add -InstallDriver to winget-install WinAppDriver

# Or directly (a WinAppDriver endpoint + a resolvable app must already be available):
dotnet test apps/windows/TeslaSync.App.UITests -c Release --filter Category=UIAutomation
```

Failure screenshots, the UIA source tree, a run log, and the `.trx` land under
`TeslaSync.App.UITests/artifacts/` (git-ignored).

## Determinism & isolation

- `Fixtures/FakeApiServer.cs` is an in-process loopback (`127.0.0.1`) fake TeslaSync API. It serves
  seeded JSON, a fake OIDC token exchange, and an SSE stream, selecting the response shape
  (success / empty / error / loading / offline / live-stale) from the requested state. Because it only
  ever binds loopback, the suite **can never reach production TeslaSync or Tesla APIs**.
- `Fixtures/TestProfile.cs` injects a deterministic environment (fake tokens, a throwaway profile
  directory, reduced motion) so a run cannot read or mutate real user state.

## Coverage

| Suite | What it asserts |
|---|---|
| `ShellNavigationTests` | launch, NavigationView groups, command palette, DeepLink, back/forward, title-bar + resize, theme, keyboard nav |
| `AuthenticationFlowTests` | signed-out guard, fake sign-in callback, token-refresh failure re-auth, sign-out cleanup |
| `ComponentStateTests` | buttons / info-bar / nav live today; dialogs, tables, tabs, charts (+accessible table), maps, forms, feedback states ledgered to W7 |
| `PageStateMatrixTests` | representative route per group × loading / empty / error / cached-offline / refreshing / live-stale / success |
| `PlatformPolishTests` | Toast activation route, JumpList activation route, taskbar status, settings persistence |
| `AccessibilityTreeTests` | AutomationProperties names, control types/roles, focus order, keyboard-only path, HighContrast run |

### Parity ledger (W7 page bodies pending)

W7 generated page bodies do not exist yet — the shell renders `RoutePendingView` for every route, so
per-state **page-body** assertions (and the components that only mount on a page) are recorded as
explicit parity-ledger entries in the artifacts log instead of being skipped. They activate
automatically once the W7 page modules register with `ShellPageFactory`.
