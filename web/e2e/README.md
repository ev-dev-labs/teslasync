# Frontend quality harness

The suite reads its critical routes from `routeRegistry.ts` and verifies that
they still exist in the application's generated route registry.

## Commands

Run from `web/`:

```sh
npm run e2e:routes
npm run e2e:list
npm run e2e:quality
npm run e2e:a11y
npm run e2e:performance
npm run e2e:cross-browser
npm run e2e:visual
```

Local suite commands build once, start one preview, wait up to 120 seconds for
the preview itself, run Playwright with `E2E_BASE_URL`, and always stop the
specific preview process. Build time is therefore outside Playwright's
web-server readiness timeout. Set
`E2E_BASE_URL=https://host.example` to use an existing deployment. API mocks
are enabled by default; set `E2E_MOCKS=0` for production smoke tests and
`E2E_STORAGE_STATE=path/to/state.json` for an authenticated browser context.
Storage-state files must never be committed.

`e2e:performance` and `e2e:a11y` are deliberately serial one-worker projects.
The authenticated CI smoke sets `E2E_SENSITIVE=1`, which disables traces,
videos, screenshots, HTML/JSON reports, and raw artifact upload. If no
storage-state secret is supplied, the variable is omitted rather than pointed
at a nonexistent file.

Mocked runs replace `navigator.sendBeacon` before application boot. Only the
reviewed `/api/v1/web-vitals` and `/api/v1/web-errors` RUM endpoints are
captured in-process. Acceptance requires the current origin, exact pathname,
no query/hash, `application/json`, a nonempty payload under 64 KiB, and the
endpoint-specific schema. Invalid payloads return `false` and are recorded as
sanitized violations; raw messages, routes, URLs, tokens, and user data are
never retained in failures. Blob, string, ArrayBuffer/view, FormData, and URL
search parameter bodies are handled explicitly.

Fetch/XHR fallbacks still pass through the strict API route mock. A pre-
navigation Playwright `request` listener records every `/api/` request and its
fulfilled/continued/aborted disposition, independent of the browser's finite
Performance Resource Timing buffer. Completion dispatches `pagehide`, waits
for late keepalive work, and then rejects any unmatched or escaped request.
The local wrapper and CI jobs also fail if Vite logs a proxy error or
`ECONNREFUSED`.

## Updating visual baselines

Visual changes require explicit review:

```sh
npm run e2e:update-visual
npm run e2e:visual
```

The committed baselines are generated on Windows and the visual CI job uses
`windows-latest` to avoid cross-platform font rasterization noise. Timestamp,
latency, tooltip, transition, and caret output is stabilized or masked. Never
update snapshots merely to make an unexplained diff pass.

Documentation screenshots are separate from regression baselines:

```sh
npm run screenshots:docs
```

From the repository root, `npm run screenshots` invokes the same portable
docs capture. `npm run e2e:update-baselines` is the only root command that
rewrites regression images.

## Tracked accessibility debt

`axeBaseline.ts` records exact selectors, owners, and tracking IDs for reviewed
debt. Every unlisted axe rule or selector fails. Current debt is limited to
`color-contrast` on `/`, `/vehicles`, and `/data-repair`, plus one
`definition-list` finding on `/`.

CI build topology:

- `contract`: 0 frontend builds
- `chromium-quality`: 1 build shared by responsive, smoke, performance, and axe
- each `cross-browser` matrix job: 1 build
- `visual`: 1 build
- authenticated production smoke: 0 builds
