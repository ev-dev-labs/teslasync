# ADR-009 — Live data: SSE strategy per platform + mobile push (FCM/APNs)

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

TeslaSync is real-time: the web app consumes **Server-Sent Events** (`/api/v1/.../live`,
SSE hub backed by Redis Pub/Sub) for live vehicle signals and FSM state. Native apps must
match this liveness, but mobile OSes aggressively suspend background work (Doze, iOS
background limits), so a long-held SSE stream is not a valid background-notification channel.

## Decision

- **Foreground live data:** all platforms consume the existing SSE endpoints via the shared
  networking layer (KMP/Ktor SSE for Android+Apple; a C# SSE client for Windows). Reconnect
  with backoff, resume on app foreground, mark cross-pod values >2 min stale (matches the
  backend live-state contract). SSE drives live UI **only while the app is foreground/active**.
- **Background notifications:** use **push**, not held streams:
  - Android → **FCM**; iOS → **APNs**; Windows → **WNS** (or FCM where applicable).
  - Routed through the existing `notification-worker`; the apps register device tokens via a
    new additive `/api/v1/devices` registration endpoint (ADR-003 contract; P1 adds it).
- **Historical/series data** comes from REST (`signal_log`-backed endpoints), never from SSE
  replay — SSE is not durable (matches backend contract).

## Consequences

- ✅ Live, battery-respecting apps; notifications survive app suspension.
- ✅ One SSE client abstraction in the shared core; Windows mirrors it.
- ⚠️ Requires backend-additive: device-registration endpoint + push fan-out in
  `notification-worker` (APNs/FCM/WNS credentials in config — ADR-justified additive change).
- ⚠️ Push provider setup (APNs keys, FCM project, WNS) is per-platform store/console work;
  P5 covers credential provisioning + Helm/config wiring (follow `helm-docker.instructions.md`).

## Alternatives rejected

- **Background SSE/WebSocket for notifications:** killed by Doze/iOS; drains battery; unreliable.
- **Polling for notifications:** high latency + battery cost vs. push.
