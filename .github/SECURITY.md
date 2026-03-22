# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | ✅        |
| < latest | ❌       |

## Reporting a Vulnerability

If you discover a security vulnerability in TeslaSync, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please:

1. Email: security@ev-dev-labs.github.io (or use GitHub's private vulnerability reporting)
2. Use [GitHub Security Advisories](https://github.com/ev-dev-labs/teslasync/security/advisories/new) to report privately

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 7 days
- **Fix**: Depending on severity, typically within 30 days
- **Disclosure**: Coordinated with reporter after fix is released

## Security Best Practices

When deploying TeslaSync:

1. Always use TLS in production (reverse proxy with HTTPS)
2. Change all default passwords (PostgreSQL, Grafana, Redis)
3. Set strong `TESLA_CLIENT_SECRET`
4. Restrict network access to management ports (8080, 5432, 6379)
5. Keep Docker images updated (Dependabot handles this automatically)
6. Review Trivy scan results in the Security tab
