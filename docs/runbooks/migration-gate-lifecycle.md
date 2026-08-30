# Migration gate lifecycle procedures

The migration gate (`migrationGate.mode`) decides whether the chart renders the
runtime Secret's source as a **Helm hook** or as an **ordinary manifest**.

Helm tracks those two categories separately and offers **no supported in-place
transition between them**. That is a property of Helm, not a bug in this chart,
and it cannot be papered over in a template. Every crossing of that boundary
needs an operator procedure.

> **Three operations are NOT safe as a bare `helm upgrade` / `helm rollback`:**
>
> 1. the first conversion of a pre-fix ordinary source into `hook` mode;
> 2. rolling back from a hook-mode revision to a pre-conversion revision;
> 3. leaving `hook` mode — **hook mode is sticky** for a source identity.
>
> Running a bare `helm rollback` across a conversion boundary can abort partway
> through reconciliation and leave the release manifest and live Secret source
> ownership out of sync.

Chart reference: [`helm/teslasync/README.md`](../../helm/teslasync/README.md).

Throughout, set these once:

```bash
RELEASE=teslasync
NS=teslasync
GATE_MODE=$(kubectl -n "$NS" get job -l app.kubernetes.io/component=migrate \
  -o jsonpath='{.items[0].metadata.annotations.teslasync\.io/migration-gate}')
echo "current gate mode: ${GATE_MODE}"

if kubectl -n "$NS" get externalsecret "$RELEASE" >/dev/null 2>&1; then
  TARGET=$(kubectl -n "$NS" get externalsecret "$RELEASE" \
    -o jsonpath='{.spec.target.name}')
  TARGET=${TARGET:-$RELEASE}
else
  # In chart-managed mode the source Secret is also the target Secret.
  TARGET=$RELEASE
fi
echo "runtime Secret: ${TARGET}"
```

---

## Preflight: remove a pre-fix ExternalSecret ownerReference

**Who needs this:** any release whose ExternalSecret ever reconciled with
`creationPolicy: Owner` — that is, any release installed before this chart
started rendering `Orphan` unconditionally.

**Why the rendered value is not enough.** The chart now renders
`creationPolicy: Orphan` in every mode. That governs **future** reconciles. It
does **not** retroactively strip an ownerReference that an earlier
`Owner`-managed reconcile already wrote onto the live Secret, and External
Secrets Operator does not retract references it has already set. If you convert
to hook mode with the old reference still present, `before-hook-creation` deletes
the ExternalSecret and Kubernetes garbage-collects the target Secret through that
stale reference — before ESO ever gets a chance to reconcile the new CR.

`deletionPolicy: Retain` does not help. Per the ESO API reference it only governs
what happens when data fields are deleted **from the provider**.

### 1. Inspect

```bash
kubectl -n "$NS" get secret "$TARGET" \
  -o jsonpath='{.metadata.ownerReferences}' | jq .
```

If the output is empty or `null`, there is nothing to do — skip to Procedure 1.

Expect an entry like:

```json
[{"apiVersion":"external-secrets.io/v1","kind":"ExternalSecret",
  "name":"teslasync","uid":"...","blockOwnerDeletion":true,"controller":true}]
```

### 2. Back up before touching anything

```bash
kubectl -n "$NS" get secret "$TARGET" -o yaml > "backup-secret-${TARGET}.yaml"
kubectl -n "$NS" get externalsecret "$RELEASE" -o yaml > "backup-es-${RELEASE}.yaml"
```

Store both outside the cluster for the duration of the change.

### 3. Remove ONLY the ExternalSecret ownership

Do not blank the whole list — another controller may legitimately own this
object. Filter to exactly the ExternalSecret entry and write back the remainder:

```bash
REMAINING=$(kubectl -n "$NS" get secret "$TARGET" -o json \
  | jq -c '[.metadata.ownerReferences // [] | .[]
            | select(.kind != "ExternalSecret")]')

kubectl -n "$NS" patch secret "$TARGET" --type=merge \
  -p "{\"metadata\":{\"ownerReferences\":${REMAINING}}}"
```

### 4. Verify the Secret survived and is intact

```bash
kubectl -n "$NS" get secret "$TARGET" \
  -o jsonpath='{.metadata.ownerReferences}'      # expect empty or non-ES owners
kubectl -n "$NS" get secret "$TARGET" \
  -o jsonpath='{.data.DATABASE_PASS}' | wc -c    # expect > 0

diff <(kubectl -n "$NS" get secret "$TARGET" -o json | jq -S '.data') \
     <(jq -S '.data' <(kubectl create --dry-run=client -o json -f "backup-secret-${TARGET}.yaml"))
```

Confirm ESO still reconciles the now-unowned Secret:

```bash
kubectl -n "$NS" annotate externalsecret "$RELEASE" force-sync="$(date +%s)" --overwrite
kubectl -n "$NS" get externalsecret "$RELEASE" \
  -o jsonpath='{.status.conditions}' | jq .       # expect Ready=True, SecretSynced
```

### Back out

The patch is reversible and the Secret was never deleted:

```bash
kubectl -n "$NS" apply -f "backup-secret-${TARGET}.yaml"
```

If the Secret was somehow lost, recreate it from the backup and then force a
sync as above. Do **not** proceed to Procedure 1 until step 4 passes.

---

## Procedure 1 — First conversion (ordinary source -> hook mode)

**When:** a release that previously rendered its Secret source as an ordinary
manifest moves to `migrationGate.mode=hook` (including via `auto`, which resolves
to `hook` as soon as `externalSecrets.enabled=true` or `secrets.create=true`).

**What Helm does.** The pre-upgrade hook deletes and recreates the source, then
Helm reconciles the ordinary manifests, finds the object in the **old** release
manifest but not the new one, and would delete the object it just created. The
chart renders `helm.sh/resource-policy: keep` on every hook source precisely so
`kube.Client.Update` skips that deletion. You do not need to do anything about
that — but you do need the preflight above if ESO ever ran with `Owner`.

### Steps

```bash
# 0. Complete the preflight above if an ExternalSecret ownerReference exists.

# 1. Record the pre-conversion revision. You need this number for Procedure 2.
helm -n "$NS" history "$RELEASE"
PRE_CONVERSION_REVISION=<pick the last ordinary-mode revision>

# 2. Back up the current source object.
kubectl -n "$NS" get externalsecret "$RELEASE" -o yaml > "pre-conversion-es.yaml"   # external mode
kubectl -n "$NS" get secret "$RELEASE"         -o yaml > "pre-conversion-secret.yaml" # chart-managed mode

# 3. Confirm the render before applying it.
helm -n "$NS" template "$RELEASE" helm/teslasync -f your-values.yaml \
  | grep -A4 'kind: ExternalSecret' | grep -E 'resource-policy|creationPolicy'

# 4. Upgrade.
helm -n "$NS" upgrade "$RELEASE" helm/teslasync -f your-values.yaml --wait
```

### Verify

```bash
kubectl -n "$NS" get externalsecret "$RELEASE" \
  -o jsonpath='{.metadata.annotations}' | jq .   # hook + resource-policy: keep
kubectl -n "$NS" get secret "$TARGET" -o jsonpath='{.metadata.ownerReferences}'  # expect empty
kubectl -n "$NS" get job -l app.kubernetes.io/component=migrate
kubectl -n "$NS" rollout status deploy/"$RELEASE"-api
```

---

## Procedure 2 — Rollback across a conversion boundary

**When:** the current revision is hook mode and you need to return to any
revision from before the conversion.

**Why a bare `helm rollback` is dangerous here.** The target revision's manifest
contains the source as an **ordinary** resource, while the current hook-mode
release manifest does not contain it. Because the live hook object exists,
Helm's target-side update fails before it reaches resource-policy handling:
`Error: no Secret with the name "..." found` (or `no ExternalSecret with the
name "..." found`). The rollback can abort after partially reconciling other
resources and records a failed target revision. **Delete the hook source first
so Helm sees NotFound and cleanly recreates the ordinary target.**

### Steps

```bash
# 1. Back up and inspect the live source object FIRST. This is the only copy.
kubectl -n "$NS" get externalsecret "$RELEASE" -o yaml > "rollback-backup-es.yaml"
kubectl -n "$NS" get secret "$RELEASE"         -o yaml > "rollback-backup-secret.yaml"
kubectl -n "$NS" get secret "$TARGET"          -o yaml > "rollback-backup-target.yaml"

# 2. Confirm the target Secret is NOT owned by the ExternalSecret. If it is,
#    deleting the CR in step 3 destroys your credentials. Run the preflight.
kubectl -n "$NS" get secret "$TARGET" -o jsonpath='{.metadata.ownerReferences}'

# 3. Delete the hook source IMMEDIATELY BEFORE the rollback, so Helm sees
#    NotFound and recreates it as an ordinary manifest resource.
kubectl -n "$NS" delete externalsecret "$RELEASE"   # external mode
kubectl -n "$NS" delete secret "$RELEASE"           # chart-managed mode ONLY

# 4. Roll back.
helm -n "$NS" rollback "$RELEASE" "$PRE_CONVERSION_REVISION" --wait
```

### Retention differs by source kind — read this before step 3

* **ExternalSecret source.** The *target* Secret is orphaned
  (`creationPolicy: Orphan`), so deleting the CR does not remove the
  credentials. ESO recreates and re-reconciles the target after the rollback
  recreates the CR. This is the safe case, provided the preflight has removed
  any legacy ownerReference.
* **Chart-managed Secret source (`secrets.create=true`).** The source **is** the
  credential. Deleting it in step 3 deletes the live credentials, and any pod
  that restarts before the rollback completes fails to start. The content is
  fully chart-rendered, so the rollback recreates it — but keep
  `rollback-backup-secret.yaml` to hand and treat the window as an outage
  window. If you cannot accept the window, scale the workloads down first.

### Verify

```bash
kubectl -n "$NS" get externalsecret "$RELEASE" \
  -o jsonpath='{.metadata.annotations}' | jq .   # expect NO helm.sh/hook keys
kubectl -n "$NS" get secret "$TARGET" -o jsonpath='{.data.DATABASE_PASS}' | wc -c
helm -n "$NS" get manifest "$RELEASE" | grep -c 'kind: ExternalSecret'  # expect 1
kubectl -n "$NS" rollout status deploy/"$RELEASE"-api
kubectl -n "$NS" rollout status deploy/"$RELEASE"-web
```

### Back out

If the rollback fails after step 3, re-apply the backup and roll forward again:

```bash
kubectl -n "$NS" apply -f "rollback-backup-es.yaml"      # or the secret backup
helm -n "$NS" rollback "$RELEASE"                        # back to the hook revision
```

---

## Procedure 3 — Leaving hook mode (hook -> none/require)

**Hook mode is sticky for a source identity.** Once a release has rendered a
given object name as a hook, switching `migrationGate.mode` to `none` or
`require` in values is **not** a supported in-place transition:

* If the source remains chart-rendered, the new revision emits it as an ordinary
  manifest. The live object exists but the current hook-mode release manifest
  does not contain it, so Helm hard-fails with `no Secret with the name "..."
  found` (or the corresponding ExternalSecret error), potentially after other
  resources were partially reconciled.
* If the source is disabled in the same values change, the new render stops
  emitting it and the kept hook object remains outside release ownership.

Neither outcome is a valid hand-off.

The chart cannot detect this — it has no view of the previous release — so the
transition is **prohibited as a bare values change**. Use one of the two paths
below.

### Path A (preferred) — staged, same release, explicit hand-off

```bash
# 1. Back up.
kubectl -n "$NS" get externalsecret "$RELEASE" -o yaml > "leaving-hook-es.yaml"
kubectl -n "$NS" get secret "$TARGET"          -o yaml > "leaving-hook-target.yaml"

# 2. Confirm the target is orphaned, so the next step cannot take it with it.
kubectl -n "$NS" get secret "$TARGET" -o jsonpath='{.metadata.ownerReferences}'

# 3. Delete the hook source, then move to require in the SAME change window.
#    require means the source now lives outside this release, so apply your
#    own ExternalSecret (or provision the Secret) before the upgrade.
kubectl -n "$NS" delete externalsecret "$RELEASE"
kubectl -n "$NS" apply -f your-gitops-externalsecret.yaml

# 4. Upgrade with externalSecrets.enabled=false and migrationGate.mode=require.
helm -n "$NS" upgrade "$RELEASE" helm/teslasync -f your-values.yaml --wait
```

`require` keeps the readiness wait, so if the out-of-band Secret is missing the
migration Job fails within `migrationGate.timeoutSeconds` with a named
diagnostic rather than starting against empty credentials.

### Path B — new release name

If you cannot take the window in Path A, install a new release with a different
name (and therefore a different source identity), cut traffic over, and uninstall
the old one. This avoids the transition entirely.

### Unsupported

Changing `migrationGate.mode` from `hook` to `none` on an existing release
**without** deleting the hook source first is unsupported. `none` is not a
general escape hatch: it does not make the ordering race safe, it only stops the
chart from managing it, and for a chart-rendered source it is a known-broken
fresh install.

---

## Uninstall

`resource-policy: keep` and `creationPolicy: Orphan` both trade automatic cleanup
for safety, so `helm uninstall` deliberately leaves objects behind:

```bash
helm -n "$NS" uninstall "$RELEASE"

kubectl -n "$NS" delete externalsecret "$RELEASE"   # kept hook source, external mode
kubectl -n "$NS" delete secret "$RELEASE"           # kept hook source, chart-managed mode
kubectl -n "$NS" delete secret "$TARGET"            # orphaned target Secret
```

---

## Escalation

If the target Secret is lost at any point, the platform cannot connect to the
database and every API pod fails readiness. A failed transition can also leave a
partially reconciled Helm revision. Restore from the backup taken in the relevant
step, or re-drive ESO:

```bash
kubectl -n "$NS" apply -f "<the backup you took>"
kubectl -n "$NS" annotate externalsecret "$RELEASE" force-sync="$(date +%s)" --overwrite
kubectl -n "$NS" get externalsecret "$RELEASE" -o jsonpath='{.status.conditions}' | jq .
```

Owner: platform on-call. Escalate to the release owner listed in
`ops/epics.yaml` for OPS-06 if Helm reports `no Secret with the name` /
`no ExternalSecret with the name`, if a rollback is partially reconciled, or if
the release manifest and live cluster disagree about who manages the source.
