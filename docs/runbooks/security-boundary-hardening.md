# Security Boundary Hardening

This runbook records the production boundary controls maintained by TeslaSync.
It applies to the web ingress, the `/api/v1` authenticated route group, local
diagnostic helpers, and the dedicated Security workflow.

## Deploying browser headers

The web pod emits CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy`, and `Permissions-Policy`. The CSP permits:

- the hashed first-paint bootstrap in `web/index.html`;
- Vite-owned local scripts and styles;
- Google font CSS/font files, HTTPS map tiles, dashcam media blobs, SSE, and
  HTTPS/WSS browser API or OTLP endpoints.

It deliberately does **not** permit `script-src 'unsafe-inline'`, plugins, or
framing. The inline stylesheet's hash and `style-src-attr 'unsafe-inline'`
remain required for the existing React/Vite style-attribute surface. When
editing either inline block in `web/index.html`, regenerate its SHA-256 source
expression and update both Nginx configurations and the Traefik middleware:

```powershell
@'
from pathlib import Path
import base64, hashlib, re
html = Path("web/index.html").read_text(encoding="utf-8")
for tag in ("script", "style"):
    for body in re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", html, re.S | re.I):
        print(tag, "sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode())
'@ | python -
```

HSTS is **not** sent by the HTTP-only web or API pods. The chart's Traefik
`IngressRoute` attaches the chart-managed security middleware at its TLS entry
point. For ingress-nginx, configure HSTS on the **controller ConfigMap** (not
per-Ingress annotations):

```yaml
data:
  hsts: "true"
  hsts-max-age: "63072000"
  hsts-include-subdomains: "true"
  hsts-preload: "false"
```

The standard Ingress only emits `ssl-redirect`/`force-ssl-redirect` when
`ingress.tls` is configured, preserving the plain-HTTP chart default. Do not
enable HSTS for a plain-HTTP development endpoint. Preload stays disabled
until every subdomain is HTTPS-ready.

## Authenticated mutations

Every private `/api/v1` route passes through ForwardAuth, then:

1. origin/fetch-metadata CSRF validation for `POST`, `PUT`, `PATCH`, and
   `DELETE`; configured `CORS_ORIGINS` are the trusted TLS-edge origins, and
   open-mode local development permits only loopback origins;
2. a 120 unsafe-request-per-authenticated-principal-per-minute backstop
   (transport peer fallback captured before `RealIP`);
3. existing lower per-route limits and sudo/typed-confirmation controls.

The middleware allows headerless API clients, but rejects browser requests
with a mismatched `Origin` or `Sec-Fetch-Site: cross-site`. Public health,
RUM, web-error, share, and webhook routes are deliberately outside this route
group and retain their explicit token/signature/body/rate-limit controls.

ForwardAuth remains the only production identity provider integration. Do not
put session or sudo tokens in browser storage. TeslaSync's own session and
impersonation cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the
request was observed through TLS.

The web proxy preserves the browser `Host` (including a non-default port) for
direct Compose traffic, but strips browser-provided `X-Forwarded-For`,
`True-Client-IP`, and `X-Forwarded-Host` before the API hop. CSRF relies on
configured concrete origins rather than those forwarded values.

For standard Helm Ingress TLS, `configmap.yaml` derives `CORS_ORIGINS` from
the configured `ingress.tls[].hosts` as `https://<host>` when
`config.webEndpoint` is empty. Set `config.webEndpoint` explicitly for a
non-443 public port or split origin. Traefik IngressRoute TLS refuses to
render without `config.webEndpoint`, because route rules are not a safe source
of a single browser origin.

## Privacy-safe diagnostics and exports

`web/src/lib/privacy.ts` is the browser-side boundary for support/error
payloads and local generic exports. It removes tokens, VINs, emails, and
precise coordinate pairs from free-form diagnostics and recursively redacts
known sensitive fields. Client CSV serializers also neutralize spreadsheet
formula prefixes (`=`, `+`, `-`, `@`).

Do not add an external error, screenshot, clipboard, or support-bundle sink
without calling the privacy helpers first. Server-side data exports are an
intentional owner-controlled feature; their job lifecycle and deletion
controls must not be replaced by browser masking. Optional API diagnostic body
capture independently redacts credential, VIN, email, location, and subject
keys before records enter the asynchronous log queue.

## Trusted Types assessment

Trusted Types is not enabled yet. Production source includes
`document.write()` for certificate/report print documents, and the HTML shell
has an inline first-paint bootstrap. Enabling
`require-trusted-types-for 'script'` now would break those sinks without a
reviewed Trusted Types policy and end-to-end browser coverage.

The current CSP removes executable inline scripts through a pinned hash. A
future Trusted Types rollout must first replace print-document sinks with
DOM-node construction or a narrowly reviewed policy, add Chromium E2E coverage
for print/certificate paths, then add a report-only policy before enforcing.

## Security gate

`.github/workflows/security.yml` blocks pull requests and weekly scans on:

- Go dependency vulnerabilities (`govulncheck`);
- dependency and filesystem-secret findings (`Trivy fs`, excluding generated
  caches and `node_modules`);
- Helm IaC misconfigurations (`Trivy config`);
- checkout secret leaks (pinned OSS `gitleaks` container, with no organization
  license or PR secret);
- Go and JavaScript/TypeScript CodeQL findings.

Release images are separately Cosign keylessly signed and carry CycloneDX SBOM
attestations in `.github/workflows/release.yml`. Verify release artifacts with
`cosign verify` and `cosign verify-attestation --type cyclonedx` before
promoting an image.

All third-party GitHub Actions in the Security workflow are full-commit-SHA
pinned with version comments. Scanner images use multi-architecture manifest
digests rather than tags: Trivy 0.74.0 and Gitleaks v8.27.2. Dependabot's
`github-actions` configuration updates the action pins; `renovate.json` has
regex managers for the digest-pinned scanner environment variables. The
workflow runs `scripts/check-security-workflow-pins.mjs` and its negative
controls before any scan.
