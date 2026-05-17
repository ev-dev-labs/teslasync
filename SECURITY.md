# Security Policy

TeslaSync handles sensitive vehicle data — GPS positions, driving patterns, battery state, account credentials, and the keys to issue commands to real cars. Security isn't a feature of the platform; it's a load-bearing constraint on every design decision. This document describes how to report security issues, what TeslaSync does to protect data, and what you as an operator have to configure for the protections to hold.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@ev-dev-labs.com** with:

- A description of the issue
- Steps to reproduce
- The version (git SHA or release tag) you observed it on
- Any logs, screenshots, or proof-of-concept that help us validate

We acknowledge reports within 48 hours and work with you on coordinated disclosure before any public discussion. We'll credit you in the release notes when the fix ships unless you ask us not to.

## Threat model in plain words

TeslaSync's threat model has three concentric circles:

1. **Tesla account credentials and tokens** — if these leak, an attacker can read your fleet's state and (on accounts with command permissions) issue commands to real vehicles. Highest sensitivity.
2. **Personal data** — VINs, GPS coordinates, driver names, addresses, alert/automation rules, charging cost data. Sensitive; leakage damages privacy and may violate local data-protection law.
3. **Operational data** — logs, metrics, traces, schema, audit trail. Lower sensitivity but still useful to an attacker for reconnaissance.

The platform is designed so that compromise of one circle doesn't automatically expose the others. The forward-auth boundary, the encrypted token store, the Helix redaction decorator, and the audit log each address a different layer.

## What the platform protects, and how

### Tesla OAuth tokens

- Stored in the `tokens` table in PostgreSQL
- Encrypted at rest with **AES-GCM** using a wrapping key sourced from `ENCRYPTION_KEY`
- In production, the API **refuses to start** if `ENCRYPTION_KEY` is missing — there's no quiet fallback to plaintext storage
- Refresh tokens are rotated automatically by the token-refresh worker; expired refresh tokens trigger re-auth flows rather than silent failure
- TOTP secrets (when 2FA is enabled) are encrypted with the same scheme

For dev environments, `ENCRYPTION_KEY` may be unset — the platform logs a clear warning and stores tokens in plaintext so developers can iterate. Never deploy this configuration outside a local machine.

### Authentication

TeslaSync uses **forward-auth**. The platform itself does not implement login UI; that's delegated to a reverse-proxy auth provider (Authentik, Authelia, oauth2-proxy, Keycloak, or a custom proxy). The proxy authenticates the user and injects an identity header. TeslaSync reads that header and looks up / creates the User.

This design has two consequences:

- The platform's auth is **as strong as your proxy configuration**. If the proxy is misconfigured (header injectable from outside, exemption rules too loose), TeslaSync inherits that weakness.
- Spoofing the identity header from outside the cluster is blocked at the ingress level — the proxy strips any incoming header before injecting its own. Verify your ingress does this.

A small number of routes are **intentionally** public:

- `/healthz`, `/readyz` — health probes (no sensitive data)
- Tesla OAuth callback — the protocol requires it
- `/.well-known/appspecific/com.tesla.3p.public-key.pem` — Tesla's partner-key flow requires it
- Drive-sharing token URLs — protected by a per-share random token
- Automation webhook receivers — protected by webhook secrets

Each public route has its own protection. "Public" means "bypasses forward-auth", not "unprotected".

### API keys

For programmatic access (CI, scripts, integrations), the platform supports HMAC-signed API keys with scoped permission levels. Keys are stored hashed (not plaintext). Revoke via the API keys page in Settings.

### Network security

The recommended deployment looks like this:

```
Internet
  │
  ▼  HTTPS (TLS 1.2+ enforced at ingress)
Reverse proxy / ingress
  │  ├─ /.well-known → web (no auth)
  │  └─ everything else → ForwardAuth → web
  ▼
Web container (Nginx + React)
  │
  ▼  internal cluster network (HTTP)
API service (ClusterIP, not externally reachable)
  │
  ▼  internal cluster network
postgres, redis, mosquitto (ClusterIP)
```

What this means in practice:

- Only the ingress is externally reachable
- The API, workers, and data services are never directly exposed
- East-west traffic is plain HTTP because TLS termination at the ingress is the correct boundary; mTLS between internal services is supported via service mesh if you operate one
- CORS is restricted by `CORS_ORIGINS` for separate-origin deployments; same-origin deployments don't need CORS

For Docker Compose deployments, the equivalent is: front the stack with Nginx / Caddy / Traefik on the host, expose only the proxy port, and don't publish the API or data-service ports to the host.

### Data protection at rest

- **PostgreSQL** holds the bulk of the data. Encrypt the underlying disk if your threat model includes disk theft (cloud providers do this by default; bare-metal deployments may need to opt in).
- **Redis L2 cache** holds live signal state and Helix rate-limit counters. No long-term sensitive material; an attacker with Redis access learns "current state of the fleet", not credentials.
- **MQTT broker** holds in-flight messages briefly. No persistence beyond what the subscriber consumes.
- **MongoDB** (optional) holds raw signal captures for debugging. Only enable when actively debugging; the data is verbose and sensitive.

### Helix AI and data egress

If you've enabled Helix with a cloud provider, every call leaves your network. The platform mitigates this in three ways:

1. **Off by default** — every Helix feature is independently toggled per user. A fresh install never sends data to any AI provider.
2. **Redaction decorator** — by default (`AI_REDACTION_ENABLED=true`), VINs, GPS coordinates, driver names, and email addresses are stripped before the payload leaves your server. The redaction is applied automatically to every call.
3. **Provider choice** — `ollama` keeps inference local. Use it if you can't send data to a cloud provider for legal or policy reasons.

The redactor is on by default and can be turned off, but the configuration is deliberately explicit — there's no silent path to leaking data.

### Audit log

Every sensitive operation writes to `audit_logs`:

- User authentication events
- Settings changes
- Token rotations
- Helix AI calls (in `ai_call_log` specifically, with provider, model, tokens, cost, latency, error)
- Vehicle command executions
- Data export jobs

Retention default is 365 days for the row itself (`AUDIT_RETENTION_DAYS`), and the IP / User-Agent columns are redacted after 30 days (`AUDIT_IP_RETENTION_DAYS`) to minimise long-term PII. Tune both per your retention policy.

### Rate limiting

Three layers protect against abuse:

| Layer                  | Default              | Tune via                                         |
| ---------------------- | -------------------- | ------------------------------------------------ |
| Per-IP middleware      | (configurable)       | Middleware config                                |
| Per-feature Helix      | `AI_RATE_LIMIT_PER_MIN` per user | Env var                              |
| Per-feature daily cost | `AI_DAILY_BUDGET_USD` per Helix call total | Env var               |

Beyond our own limits, Tesla's own rate limits apply — exceeded limits surface to the user as `TESLA_API_RATE_LIMITED` with a `Retry-After` header where Tesla provides one.

### Input validation

- HTTP request body size capped (1 MB default, tunable)
- Geofence coordinates validated against valid lat/lng ranges
- CSV imports row-capped per upload
- All SQL is parameterised; no string concatenation anywhere in the codebase. Repository-level enforcement.
- JSON request shapes validated against typed structs; unknown fields rejected
- Output encoding handled by the standard library — no manual HTML/JSON construction

### Container security

The published container images run as a non-root user. Helm chart defaults:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: [ALL]`
- Read-only root filesystem for the API container where possible

If you build your own images, preserve these defaults.

## What you have to configure for the protections to hold

The platform's design assumes a few baseline operator commitments:

1. **Set `ENCRYPTION_KEY` in production.** Without it, Tesla tokens are stored in plaintext. The API refuses to start without it in production builds.
2. **Front the stack with HTTPS.** TLS 1.2 minimum; TLS 1.3 preferred.
3. **Configure forward-auth.** A naked deployment without an auth proxy in front is not a valid production configuration.
4. **Don't expose the API or data services externally.** Use `ClusterIP` / private bindings.
5. **Rotate `ENCRYPTION_KEY` carefully if you do.** Plan the rotation (re-encrypt existing tokens) before changing the key; otherwise tokens become unrecoverable.
6. **Keep dependencies current.** GitHub Dependabot and the CodeQL workflow flag vulnerabilities in the repository; act on the alerts.
7. **Audit your `srcExclude` and your ingress rules.** A misconfigured ingress that lets `/.well-known` go through auth breaks Tesla Fleet Telemetry. A misconfigured ingress that exempts more than `/.well-known` is a security hole.
8. **Set realistic Helix budgets and rate limits.** If you enable a cloud provider without `AI_DAILY_BUDGET_USD`, a runaway page can rack up a bill. The budget is the safety net.

## Supported versions for security fixes

| Version line | Security fixes |
| ------------ | -------------- |
| Latest minor | ✅ Active     |
| Previous minor | ✅ Security-only fixes |
| Older        | ❌ End of life — upgrade |

We aim to keep the upgrade path between adjacent minors safe and well-documented. If you're more than one minor behind, plan the upgrade — a clean upgrade is non-destructive but the longer you wait the more migrations land between you and current.

## Dependencies

- **GitHub Dependabot** opens PRs for vulnerable dependencies in both Go and JavaScript trees
- **CodeQL workflow** runs static analysis on every push to `main`
- We aim to close high-severity CVEs within days; lower-severity issues are batched into the next release

## Coordinated disclosure expectations

When you report an issue, we aim to:

- Acknowledge within 48 hours
- Confirm or refute the issue within 7 days
- Ship a patch for confirmed issues within 30 days (high severity) or the next planned release (lower severity)
- Coordinate disclosure timing with you, with a default 90-day embargo

If we can't meet a target, we'll tell you why and propose a new one. Silent stalling isn't acceptable from us.

## Related

- [Configuration](/guide/configuration) — every security-relevant env var
- [Architecture](/guide/architecture) — the trust boundaries between services
- [Helix AI](/guide/helix-ai) — redaction decorator, audit ledger, provider matrix
- [Kubernetes deployment](/deployment/kubernetes) — production-checklist for safe defaults
