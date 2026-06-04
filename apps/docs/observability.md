# App Observability — Crash / Analytics / Diagnostics (ADR-016)

> **Scope:** Pins the concrete crash-reporting, product-analytics, and
> diagnostic-logging sink for the three TeslaSync native apps (Windows, Android,
> Apple) and defines the **PII-redaction contract** every app logger must honor.
> This document resolves the ADR-016 default ("self-hosted Sentry") into a
> binding, per-platform choice and is the authoritative specification consumed by
> the **P1/S11** shared diagnostics module and every platform crash-reporter
> init (P2/P3/P4). Live wiring + dashboards land in **P5/H7**.
>
> **Status:** Decision (pinned). Supersedes nothing.
> **ADR refs:** ADR-016 (in-app telemetry/observability).

---

## 1. Final choice — crash + analytics sink

**Decision:** Adopt the ADR-016 default — a **single self-hosted Sentry**
deployment serves as the unified sink for **both** crash reporting **and**
product analytics across all three platforms. This keeps every byte of crash,
breadcrumb, and event data in-house (matching the project's self-hosted ethos),
gives one redaction/retention control plane, and avoids any third-party ad/SDK
data egress. We deliberately do **not** split per-platform native crash backends
(App Center / Crashlytics / MetricKit-only) because that would fragment
dashboards, duplicate symbolication pipelines, and—in Crashlytics' case—route
data through a third party, all of which ADR-016 rejects.

**Per-platform SDK** (all point at the same self-hosted Sentry DSN/endpoint,
configured at build time — never hard-coded; see §4):

| Platform | Crash SDK | Analytics path | Symbol artifact |
|---|---|---|---|
| **Apple** (iOS / watchOS) | `sentry-cocoa` (Swift Package Manager); MetricKit hooks feed supplementary crash/diagnostic payloads into the same sink | Sentry custom events via shared `Telemetry` abstraction (P1/S11) | dSYM upload on CI release |
| **Android** (+ Wear OS) | `sentry-android` / `sentry-kotlin-multiplatform` | Sentry custom events via shared `Telemetry` | R8 `mapping.txt` upload on CI release |
| **Windows** | `sentry-dotnet` (WinUI 3 / .NET) | Sentry custom events via shared `Telemetry` | PDB upload on CI release |
| **Shared core (KMP)** | `CrashReporter` `expect/actual` + `Telemetry` abstraction (P1/S11) binds each platform `actual` sink to the SDKs above | — | — |

**Why Sentry over GlitchTip/Bugsnag-OSS:** Sentry is self-hostable, has
first-party SDKs for all three target ecosystems (Cocoa, Android/KMP, .NET),
native symbolication for dSYM/mapping/PDB, and supports custom events for the
analytics taxonomy in §5 — letting one sink cover crash **and** analytics. P5/H7
may substitute a compatible self-hosted backend (e.g. GlitchTip) **only** behind
the same shared abstraction and DSN-via-config rule; no app code changes if the
endpoint is swapped.

---

## 2. PII redaction contract

**Canonical deny-list (forbidden keys / patterns).** No field whose key matches,
or whose value matches the pattern for, any entry below may ever be emitted to a
log line, a breadcrumb, a crash report, or an analytics event:

| Class | Forbidden keys (case-insensitive) | Value patterns to scrub |
|---|---|---|
| **VIN** | `vin`, `vehicle_id`, `vehicleIdentificationNumber` | 17-char `[A-HJ-NPR-Z0-9]{17}` |
| **Tokens / secrets** | `token`, `access_token`, `refresh_token`, `id_token`, `authorization`, `bearer`, `api_key`, `client_secret`, `password`, `cookie`, `session` | JWT `eyJ[A-Za-z0-9_-]+\.[...]`, `Bearer ...`, long opaque hex/base64 |
| **Precise location** | `lat`, `latitude`, `lon`, `lng`, `longitude`, `coords`, `gps`, `address` | decimal-degree pairs |
| **Contact PII** | `email`, `phone`, `name`, `user_id` | RFC-5322 email, E.164 phone |

**Single-logger rule (binding).** Only the **shared redacting logger** in the
KMP core (`apps/shared/core/.../diagnostics/**`, authored in P1/S11) may emit
logs, breadcrumbs, crashes, or events. Direct calls to `println`,
`NSLog`/`os_log`, `android.util.Log`, `System.Diagnostics`/`Console`, or a raw
Sentry SDK from feature code are **prohibited**. Redaction is applied
**centrally** (one scrub pass over keys + value patterns) — never relied upon
per-call — so a new call site cannot leak by forgetting to sanitize. Crash
breadcrumbs pass through the same scrubber before reaching the sink.

**Redaction examples:**

```text
# Logger input  (feature code hands structured fields to the shared logger)
Logger.info("drive.sync", { vin: "5YJ3E1EA7KF000001",
                            lat: 37.4220, lon: -122.0841,
                            token: "eyJhbGciOiJIUzI1NiIsIn...",
                            email: "owner@example.com",
                            drive_id: 4412, distance_m: 18230 })

# Emitted to sink  (deny-list keys replaced with [REDACTED]; non-PII kept)
[INFO] drive.sync vin=[REDACTED] lat=[REDACTED] lon=[REDACTED]
       token=[REDACTED] email=[REDACTED] drive_id=4412 distance_m=18230

# Crash breadcrumb input
breadcrumb: "GET /api/v1/vehicles?token=eyJhbGci... near 37.42,-122.08"
# After scrub
breadcrumb: "GET /api/v1/vehicles?token=[REDACTED] near [REDACTED]"
```

Non-PII operational fields (`drive_id`, `distance_m` in SI, status codes,
durations, screen names) are retained — they are required for diagnosability and
carry no personal data. Redaction behavior is proven by the P1/S11 test suite
(planted-PII records → assert `[REDACTED]`).

---

## 3. Opt-out / consent & store obligations

- **Default OFF, opt-in.** `DiagnosticsConsent.granted` defaults to `false`. The
  shared `Logger` / `Telemetry` / `CrashReporter` sinks **no-op** until consent
  is granted. Local diagnostic logging that never leaves the device may run, but
  **no upload** of crash, breadcrumb, or analytics data occurs without consent.
- **Settings toggle.** Each app exposes a Settings → Privacy toggle
  ("Share diagnostics & usage"). Turning it **off** stops all new ingestion
  **and purges any locally queued** crash/event payloads (verified in P1/S11 and
  end-to-end in P5/H7).
- **iOS ATT.** Analytics is first-party and not used for cross-app tracking, so
  it does not require an `App Tracking Transparency` prompt; we will **not**
  present an ATT prompt. If any future signal were used for tracking, ATT would
  be required first. The in-app consent toggle remains the gate regardless.
- **Play Data Safety.** The Android Data Safety form must declare: app activity
  (product interactions) + crash logs + diagnostics, **collected only with
  consent**, **not shared** with third parties, encrypted in transit, user can
  request deletion (toggle-off purge).
- **App Store / Microsoft Store privacy labels.** App Store privacy nutrition
  labels and the Microsoft Store privacy disclosure must reflect actual
  collection: "Diagnostics" and "Usage Data", **not linked to identity**, **not
  used for tracking**. These store disclosures are authored alongside the P5
  release/packaging prompts and must match this document.

---

## 4. Self-hosting plan (deferred to P5)

- **Where it runs:** the self-hosted Sentry (or compatible OSS sink) is deployed
  in the existing cluster via **Helm**, alongside the TeslaSync chart, with the
  ingestion endpoint exposed internally and behind TLS.
- **No hard-coded DSNs.** The sink DSN/endpoint is injected per platform at
  **build time** from configuration (Helm-managed config / CI release secrets /
  per-app build config) — never committed in source. Swapping the backend is a
  config change, not a code change, because all sinks sit behind the P1/S11
  abstraction.
- **Symbolication:** CI release builds upload dSYM (Apple), `mapping.txt` + R8
  (Android), and PDB (Windows) so crashes resolve to source lines.
- **Pointer:** infra stand-up, DSN wiring, symbol-upload pipelines, consent
  end-to-end verification, and crash-free-rate dashboards are owned by
  **P5/H7** (`H7-0001-crash-analytics-wiring`) with the shared dashboard doc at
  `apps/shared/observability/dashboards.md`. This P0 doc pins the **decision**;
  H7 turns it **on**.

---

## 5. Event taxonomy (minimal product analytics)

Typed, schema-bound events only — **no free-form PII payloads**, **no
third-party analytics or ad SDKs**. The starting minimal set:

| Event | When | Allowed properties (non-PII only) |
|---|---|---|
| `screen_view` | A screen/route becomes active | `screen` (stable name, e.g. `vehicle_detail`), `platform`, `app_version` |
| `command_issued` | User triggers a vehicle/app command | `command` (enum, e.g. `climate_on`, `charge_start`), `surface`, `result` (`ok`/`error`), `duration_ms` |
| `error` | A handled error / failed operation surfaces | `code`, `domain`, `screen`, `recoverable` (bool) |

- Event **names and property keys are a fixed enum** defined in the shared
  `Telemetry` types (P1/S11); feature code cannot attach arbitrary maps.
- Every property value passes the §2 redaction scrubber before emission as a
  defense-in-depth backstop, even though the schema already forbids PII keys.
- The taxonomy may grow in later phases, but **only** by adding typed events to
  the shared schema — never by emitting raw strings or ad-SDK events.

---

## Acceptance summary

- Crash + analytics sink **pinned**: one self-hosted Sentry, per-platform SDKs
  (`sentry-cocoa`, `sentry-android`/KMP, `sentry-dotnet`) — §1.
- PII **deny-list** (VIN, tokens, lat/long, email/contact) + **single redacting
  logger** rule documented with examples — §2.
- **Consent** (default-off toggle, purge-on-revoke), **iOS ATT** stance, **Play
  Data Safety**, and **store privacy labels** noted — §3.
- **Self-host** plan via Helm + build-time DSN, **deferred to P5/H7** with
  pointer — §4.
- Minimal **event taxonomy** (`screen_view`, `command_issued`, `error`), no
  third-party ad SDKs — §5.
