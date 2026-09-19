# Package retention

The Maintenance workflow inventories all seven GHCR packages listed in
`ops/release/package-retention.json`, including `charts/teslasync`.
It applies to existing versions as well as future publications.

Stable releases retain the newest 10 releases **or** anything published/updated
within 90 days. Prereleases retain the newest 5 **or** anything within 14 days.
Newest means the most recent package creation/update across the release's
components, not semantic version order. A version must fall outside both
protections before it becomes a deletion candidate.
The count floor also applies to each individual package; a less frequently
published package cannot lose its rollback history to newer releases of other
components. Those retained versions protect matching components everywhere.

## Review and enable deletion

1. Add deployed and required rollback versions to `protectedVersions` in the
   policy. The workflow cannot discover installations in your homelab.
2. Run Maintenance with `delete_packages` left false. Scheduled weekly runs
   are also always dry-runs.
3. Review the job summary and the `package-retention-report` artifact. Its JSON
   lists every package version, tag, keep/delete decision, and reason.
4. To delete, manually run Maintenance with `delete_packages` true. Optional
   `protected_versions` adds comma-separated pins for that run; use the policy
   file for durable pins. The workflow recomputes the plan against live data,
   rather than executing the previous report.

The workflow token needs package admin access for deletion on **each** package.
Grant this repository access in the package's Actions access settings as needed.
An inaccessible, missing, empty, or malformed inventory aborts cleanup before
deletion. HTTP failures are reported, not ignored.

## Safety boundaries

Release decisions are shared across all packages. An alias such as `latest`
protects every release tag on its digest, across the entire release. Pins and
shared release digests propagate protection as well. Versions with unknown tags
are retained.

**Untagged manifests, signatures, SBOMs, attestations, and other auxiliary
artifacts are deliberately retained.** The GitHub package-version API alone
does not establish an OCI reference graph; this policy does not attempt orphan
garbage collection. Consequently, retention is not a strict cap on the total
number of package versions or total storage.

The script inventories everything again before deletion and checks candidate
digests/tags. Do not retag or publish packages during a deletion run: GitHub
does not support conditional deletes, so these checks cannot eliminate races
with external publishers. Release tags must remain immutable.

Deletion across packages is not atomic. On the first failure the run stops;
the results JSONL records successful deletions and the failure. Inspect the
partial result and fix permissions or the reported error before retrying.
Remaining versions are re-inventoried on retry.

GitHub releases and Git tags are never deleted. Their historical package links
may stop working after expiration. Existing running containers are not stopped,
but deleted images cannot be pulled for recreation or rollback. Retaining an
image does not make rollback safe across incompatible database migrations.
