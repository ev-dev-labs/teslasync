# Release verification

How a consumer — or you, during an incident — proves that a published
TeslaSync image is the artifact this repository built, and nothing else.

Policy: `ops/release/supply-chain.yaml`
Gate: `go run ./cmd/ops-gate -check supply-chain`
Producer: `.github/workflows/release.yml`

## What every published image carries

| Artifact | Produced by | Proves |
|---|---|---|
| Cosign signature (keyless, GitHub OIDC) | `cosign sign` | These bytes were signed by a workflow in this repository. |
| CycloneDX SBOM attestation | `syft` + `cosign attest` | Exactly which Go modules, OS packages, and JS dependencies landed in the final layer. |
| SPDX SBOM (artifact) | `syft` | The same inventory in the SPDX format, for tooling that needs it. |
| SLSA build provenance | `actions/attest-build-provenance` | *Which* workflow file, commit, and runner produced these bytes. |
| Vulnerability status | `trivy` + the `vulnerability-report` job | The fixable CVE counts at build time, published in the release notes. |

All of them are bound to the image **digest**, never to a tag. Re-tagging
cannot transplant an attestation onto different bytes.

## Verify a release

Set the version you are checking:

```bash
IMAGE=ghcr.io/ev-dev-labs/teslasync-api
VERSION=1.4.2
```

### 1. Signature

```bash
cosign verify "${IMAGE}:${VERSION}" \
  --certificate-identity-regexp="github.com/ev-dev-labs/teslasync" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

A failure here means the image was not signed by this repository's
release workflow. Stop; do not deploy it.

### 2. SBOM

```bash
cosign verify-attestation \
  --type cyclonedx \
  --certificate-identity-regexp="github.com/ev-dev-labs/teslasync" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
  "${IMAGE}:${VERSION}" \
  | jq -r '.payload' | base64 -d | jq '.predicate' > sbom.cdx.json

# e.g. "is the vulnerable version of X in this image?"
jq -r '.components[] | "\(.name) \(.version)"' sbom.cdx.json | grep -i some-package
```

This is the fastest way to answer "are we affected?" when a CVE lands —
faster than rebuilding, and it reflects what actually shipped rather
than what `go.mod` currently says.

### 3. Build provenance

```bash
gh attestation verify "oci://${IMAGE}:${VERSION}" --repo ev-dev-labs/teslasync
```

The signature says *someone in this repo* signed it. Provenance says
*which workflow, at which commit, on which runner*. Check the reported
workflow path is `.github/workflows/release.yml` and the commit is one
you recognise.

### 4. Vulnerability status

Read the **🛡️ Vulnerability status** table in the GitHub release notes,
or download the `vulnerability-status-<version>` artifact from the
release run.

Policy (from `ops/release/supply-chain.yaml`):

- **Fails the release:** any *fixable* `CRITICAL`.
- **Reported, not blocking:** `HIGH`, `MEDIUM`, and every unfixable
  finding.

`ignore_unfixed: true` is deliberate. An unfixable CRITICAL in a base
image would otherwise block every release indefinitely while providing
no path to remediation — so it is surfaced and tracked instead of
silently jamming the pipeline.

## Artifact promotion — the bytes you verify are the bytes we scanned

Ordering a vulnerability gate before the push is necessary but not
sufficient. An earlier version of this workflow had exactly that
ordering — `build-scan` → `vulnerability-report` → `docker` — and still
published bytes that were never scanned, because the `docker` job
**re-built** the image from source with `push: true` instead of
promoting the artifact the scan had assessed.

Two builds are not one artifact. An unpinned base tag, an evicted
BuildKit cache entry, or any non-reproducible layer makes the pushed
image differ from the scanned one. The cosign signature and the SLSA
provenance would then describe an image nobody assessed — which is worse
than no attestation at all, because it reads as assurance.

The pipeline now promotes one artifact end to end:

1. `build-scan` builds **once** with `push: false` and
   `outputs: type=docker,dest=/tmp/promote/<image>.tar`. Nothing touches
   a registry.
2. It records the archive's **config digest** (which commits to every
   layer `diff_id`) and the archive's SHA-256, then scans the archive
   itself with `trivy --input`.
3. The archive is uploaded as `image-<image>-<version>` — the image name
   and version in the artifact name keep parallel matrix legs isolated.
4. `vulnerability-report` aggregates every leg and produces the single
   verdict. A fixable CRITICAL stops the run here, before any public
   tag exists.
5. `docker` downloads that artifact, re-checks the archive SHA-256, and
   `crane push`es it. `:latest` is a **tag on the same manifest**, never
   a second build.
6. It then asserts `DIGEST CONTINUITY`: the archive's config digest must
   equal the config digest of the pushed manifest. If they ever diverge
   the job fails before signing.
7. cosign, the SBOM attestation, and the provenance subject all bind to
   `steps.promote.outputs.digest` — the digest that was actually pushed.

Two gates keep this honest:

- `go run ./cmd/ops-gate -check workflows` parses the workflow's action
  steps and fails if the scan job sets `with.push: true`, if a publish
  job invokes a build action at all, if the uploaded and downloaded
  artifact names differ, or if the continuity marker is missing.
- `go run ./cmd/ops-gate -check supply-chain` requires `crane push` and
  `DIGEST CONTINUITY` to be present in the release run blocks.

## Immutability

Everything the release workflow pulls is pinned:

- Third-party actions are pinned to a full 40-character commit SHA with
  a trailing `# vX.Y.Z` comment so the pin stays reviewable.
- Scanner container images are pinned by `@sha256:` digest.

`go run ./cmd/ops-gate -check supply-chain` fails on any mutable
reference. Images this workflow *builds* are exempt from digest pinning
for the obvious reason: their digest does not exist until the build
produces it.

The separate `scripts/check-security-workflow-pins.go` owns
`.github/workflows/security.yml`. The two gates are deliberately
independent so neither can be weakened by a change to the other.

## Exceptions

A vulnerability exception must carry an ID, a reason, and an **expiry
date**:

```yaml
vulnerability_policy:
  exceptions:
    - id: CVE-2026-12345
      reason: No upstream fix; not reachable from any request path.
      expires: "2026-12-31"
```

The gate fails on an expired entry, so an exception cannot quietly
become permanent.

## When verification fails

1. Do not deploy the image.
2. Capture the exact command output — signature failures are the one
   class of finding that must never be reproduced "later from memory".
3. Check whether the release run itself is intact
   (`gh run view <run-id>`); a re-run with different inputs is a much
   more likely explanation than a compromise, but it must be confirmed,
   not assumed.
4. Escalate per `docs/runbooks/` before overriding anything.
