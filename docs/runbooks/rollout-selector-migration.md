# Rollout selector migration: `legacy` → `disjoint`

**One-time, per-release, zero-downtime if the steps run in order.**

Source of truth: `ops/rollout/stages.yaml` → `selector_migration`.
Enforced by `go run ./cmd/ops-gate -check rollout`, which rejects any
ordering where pods are deleted while a controller that owns them is
still alive.

## Why this migration exists

A Deployment's `spec.selector` is a **superset match**: a pod is adopted
if it carries every label in the selector, extra labels notwithstanding.
With `rollout.selectorMode: legacy` the stable Deployment selects on
`app.kubernetes.io/{name,instance,component}` only — labels a canary pod
also carries. So the stable Deployment, its HPA (which reads pod metrics
through that selector), and its PDB would all silently adopt canary
pods: the stable set would scale on canary CPU and count canary pods
toward `minAvailable`.

`disjoint` mode adds `teslasync.io/rollout: stable` to the stable
selector, making the two sets provably non-overlapping. The **Service**
selector deliberately does *not* include the rollout label, so it keeps
fronting both and replica-share traffic splitting still works.

The chart refuses to render a canary in `legacy` mode rather than
producing the overlap silently.

## Why it needs a procedure at all

`spec.selector` is **immutable**. `helm upgrade --set
rollout.selectorMode=disjoint` against an installed release fails with
`field is immutable`. The Deployment must be replaced.

## ⚠️ The obvious procedure is wrong (do not use)

```bash
# DO NOT DO THIS — it never converges
kubectl delete deployment $REL-api --cascade=orphan
helm upgrade $REL … --set rollout.selectorMode=disjoint
kubectl delete pod -l '…,!teslasync.io/rollout'      # ← pods come straight back
```

`--cascade=orphan` orphans the pods **and the ReplicaSet**. The
ReplicaSet is still a live controller with a non-zero replica count, so
the moment you delete the old pods it recreates every one of them. The
Service keeps fronting both revisions, and the loop never terminates.

The controller must be removed **before** the pods it owns.

## Procedure

```bash
NS=teslasync          # namespace
REL=teslasync         # helm release name
```

### 1. Orphan the Deployment

```bash
kubectl -n "$NS" delete deployment "$REL-api" --cascade=orphan
```

Removes the Deployment but leaves the ReplicaSet **and** the pods
running. Traffic is uninterrupted.

### 2. Remove the orphaned ReplicaSet — **do not skip**

```bash
kubectl -n "$NS" delete rs \
  -l app.kubernetes.io/instance="$REL",app.kubernetes.io/component=api \
  --cascade=orphan
```

This is the step the naive procedure omits. `--cascade=orphan` again, so
the pods keep running — but nothing controls them any more, which is
exactly what makes step 5 stick.

Confirm nothing owns the pods:

```bash
kubectl -n "$NS" get pod -l app.kubernetes.io/component=api \
  -o custom-columns=NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].kind
# OWNER should be <none> for the old pods
```

### 3. Upgrade to disjoint selectors

```bash
helm upgrade "$REL" helm/teslasync -n "$NS" --set rollout.selectorMode=disjoint
```

Creates the new Deployment. Its pods carry
`teslasync.io/rollout=stable`; the orphans do not.

### 4. Wait for the new pods to be Ready

```bash
kubectl -n "$NS" rollout status deployment/"$REL-api" --timeout=5m
```

Do not remove old capacity before the new pods pass readiness.

### 5. Delete the orphaned pods

```bash
kubectl -n "$NS" delete pod \
  -l 'app.kubernetes.io/instance='"$REL"',app.kubernetes.io/component=api,!teslasync.io/rollout'
```

The `!teslasync.io/rollout` term is load-bearing: it matches only the
un-labelled orphans, never the new stable pods. Nothing owns them, so
nothing recreates them.

Each pod drains gracefully — the preStop hook fires, readiness flips to
503, and the 90s grace period holds the full shutdown budget.

## Downtime and rollback

**Downtime:** none. Between steps 3 and 5 the Service fronts both the
orphaned pods and the new stable pods. That is the same overlap any
rolling update produces, and both revisions run the same image.

**Rollback before step 5:** re-run `helm upgrade` with
`rollout.selectorMode=legacy` and delete the disjoint Deployment. The
orphaned pods are still serving, so this is a no-downtime abort.

**Rollback after step 5:** the old pods are gone; this is now a normal
Helm revision rollback (`helm rollback $REL <rev>`), which recreates
capacity from scratch and therefore has a brief reduced-capacity window.

## Alternative: foreground deletion (accepts downtime)

If the overlap in steps 3–5 is unacceptable — for instance during an
incident where two revisions must not both write — delete with the
default foreground cascade instead, which removes the pods with the
Deployment:

```bash
kubectl -n "$NS" delete deployment "$REL-api"      # cascade=foreground (default)
helm upgrade "$REL" helm/teslasync -n "$NS" --set rollout.selectorMode=disjoint
```

**This has real downtime** — the API is unavailable from the delete until
the new pods pass readiness (typically 30–60s with the startup probe).
Announce it, and prefer the zero-downtime path unless you have a reason
not to.

## Verify

```bash
kubectl -n "$NS" get pod -l app.kubernetes.io/component=api \
  -L teslasync.io/rollout
# every pod should show `stable`

helm template "$REL" helm/teslasync --set rollout.selectorMode=disjoint \
  | go run ./cmd/ops-gate -verify-helm-render -
```

Then re-run the post-deploy smoke gate against the release.
