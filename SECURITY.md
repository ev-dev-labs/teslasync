# Security Policy

## Reporting Security Vulnerabilities

**Please do NOT open public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability, please report it responsibly by emailing:

📧 **security@ev-dev-labs.com**

We will acknowledge your report within 48 hours and work with you to address the issue before any public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅ Active |
| 0.2.x   | ✅ Security fixes only |
| < 0.2   | ❌ End of life |

## Security Considerations

TeslaSync is **self-hosted software** that handles sensitive vehicle data. Please review these guidelines:

### Authentication & Authorization
- Tesla OAuth tokens are stored in PostgreSQL and can be **encrypted at rest** using AES-256-GCM via the `ENCRYPTION_KEY` environment variable
- API key authentication uses HMAC-SHA256 with three permission levels (read, read-write, admin)
- JWT tokens for user sessions expire after 24 hours

### Network Security
- Always deploy behind HTTPS (TLS 1.2+) in production
- Use the `CORS_ORIGINS` environment variable to restrict cross-origin requests
- MQTT broker should use authentication in production (`allow_anonymous false`)
- Redis should be password-protected in production

### Data Protection
- Vehicle GPS coordinates, driving patterns, and battery data are stored in PostgreSQL
- Position data is automatically cleaned up based on `POSITION_RETENTION_DAYS` (default: 90)
- API call logs are cleaned up after 30 days
- Data exports are rate-limited (10 requests/minute)

### Rate Limiting
| Endpoint | Limit |
|----------|-------|
| General API | 100 req/min per IP |
| Auth login/callback | 5 req/min per IP |
| Vehicle commands | 20 req/min per IP |
| Data exports | 10 req/min per IP |

### Input Validation
- Vehicle commands are whitelisted (21 allowed commands)
- Request body size is limited to 1MB globally
- Geofence coordinates validated (-90/90 lat, -180/180 lng)
- CSV imports limited to 10,000 rows per upload

### Docker & Kubernetes
- All containers run as non-root user (UID 1000)
- Security contexts drop all capabilities
- Read-only root filesystem enabled for the API container
- Pod security policies enforce `runAsNonRoot: true`

## Dependency Security

We use GitHub Dependabot and the CodeQL security workflow to monitor for vulnerabilities in dependencies. Security advisories are reviewed and patched promptly.
