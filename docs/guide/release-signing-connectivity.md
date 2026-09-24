# Release signing connectivity on ARC

The release must reach Fulcio and Rekor using verified HTTPS before it builds
or publishes. Do not disable signing, certificate verification, or the preflight
to work around a failed connection.

## Confirmed incident: 2026-09-22

Controlled comparison:
https://github.com/ev-dev-labs/teslasync/actions/runs/35759784107
(commit `7a651006c`).

| Probe | ARC | GitHub-hosted control |
| --- | --- | --- |
| Fulcio system DNS | `34.36.164.164` | `34.36.164.164` |
| Google public DNS comparison | Same A record; no AAAA | Same A record; no AAAA |
| Fulcio verified HTTPS, TLS 1.2 and 1.3 | curl exit 35, wrong version number | HTTP 200, verification result 0 |
| Fulcio TLS ClientHello response | 256 bytes of `ff`, not TLS | TLS record |
| Credential-free HTTP HEAD to Fulcio ports 80 and 443 | HTTP 302 to `https://www.safebrowse.io/warn.html` | No HTTP redirect |
| Rekor verified HTTPS | HTTP 200, verification result 0 | HTTP 200, verification result 0 |

ARC had no configured HTTP/HTTPS/ALL proxy environment variables or Fulcio hosts
override. Its resolver was `10.43.0.10`; public DNS was queried only for comparison,
never used to override routing. The Windows workstation independently failed
Fulcio TLS with `SEC_E_INVALID_TOKEN`.

This identifies a SafeBrowse network-filter rejection on the ARC path, not DNS
sinkholing, an IPv6 preference, a missing CA, or a TLS-version mismatch. The
response identifies the filter service, not the exact physical appliance or
provider account enforcing it.

## Administrator action

The owner of the ARC network's SafeBrowse-backed web/threat protection policy must
review the blocked-site event for `fulcio.sigstore.dev`, observed at
2026-09-22 17:18:39 UTC, and correct the false-positive/domain block for outbound
TCP 443. The observed destination was `34.36.164.164`; use the domain in policy,
not a pinned IP that can change. If policy has no per-domain exception, submit
the false positive to the network protection provider.

Keep protection enabled globally. Do not substitute public DNS, a proxy, another
runner, or `curl -k`. No ARC network-filter administration configuration was found
in this repository; the policy change requires the network administrator.

## Verification and recovery

After the administrator fixes the policy:

```sh
gh workflow run release.yml --ref typograpghy -f runner=arc-runner
```

This is a **real release dispatch**, not a diagnostic-only success path. The
ordinary signing preflight and every release gate remain enabled. While
connectivity is broken, preflight fails before builds or publication; once
restored, the release proceeds.

Both signing endpoints must return HTTP 200 with certificate verification successful.
Monitor the returned run with `gh run watch <id> --exit-status` through signing,
attestation, tagging, and Helm publication. A hosted diagnostic pass alone is
not release success.

Prefer rerunning failed jobs on the chosen release SHA rather than making
unrelated commits or dispatching concurrent releases. Branch prerelease versions
include the SHA; earlier promoted images from `9c66fc197` must not be mistaken
for a completed signed release. The incident diagnostic runs stopped before
version calculation and produced no new release images or tags.
