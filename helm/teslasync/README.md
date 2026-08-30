# TeslaSync Helm Chart

<!-- badges -->
![Version: 0.6.2](https://img.shields.io/badge/Version-0.6.2-informational?style=flat-square)
![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square)
![AppVersion: 1.1.0](https://img.shields.io/badge/AppVersion-1.1.0-informational?style=flat-square)

Helm chart for deploying TeslaSync — a Tesla fleet intelligence platform.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.12+
- PV provisioner support (for PostgreSQL, Redis, Mosquitto, Grafana, and optional MongoDB/Tempo persistence)
- Optional: Traefik for IngressRoute support

## Quick Start

```bash
# Method 1: Helm Repository
helm repo add teslasync https://ev-dev-labs.github.io/teslasync/helm
helm repo update
helm install teslasync teslasync/teslasync \
  --set tesla.clientId=YOUR_CLIENT_ID \
  --set tesla.clientSecret=YOUR_CLIENT_SECRET

# Method 2: OCI Registry (no repo add needed)
helm install teslasync oci://ghcr.io/ev-dev-labs/charts/teslasync \
  --set tesla.clientId=YOUR_CLIENT_ID \
  --set tesla.clientSecret=YOUR_CLIENT_SECRET
```

## Installation

### From Helm Repository

```bash
helm repo add teslasync https://ev-dev-labs.github.io/teslasync/helm
helm repo update
helm install teslasync teslasync/teslasync -f values.yaml

# Search available versions
helm search repo teslasync --versions
```

### From OCI Registry

```bash
helm install teslasync oci://ghcr.io/ev-dev-labs/charts/teslasync \
  -f values.yaml

# Install specific version
helm install teslasync oci://ghcr.io/ev-dev-labs/charts/teslasync --version 0.7.1
```

### From Source

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
helm install teslasync ./helm/teslasync -f my-values.yaml
```

## Configuration

The following table lists all configurable parameters and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Backend replicas | `1` |
| `image.repository` | Backend image repository | `ghcr.io/ev-dev-labs/teslasync-api` |
| `image.pullPolicy` | Backend image pull policy | `IfNotPresent` |
| `image.tag` | Backend image tag (defaults to chart appVersion) | `""` |
| `web.enabled` | Enable frontend deployment | `true` |
| `web.image.repository` | Frontend image repository | `ghcr.io/ev-dev-labs/teslasync-web` |
| `web.image.pullPolicy` | Frontend image pull policy | `IfNotPresent` |
| `web.image.tag` | Frontend image tag | `""` |
| `web.replicaCount` | Frontend replicas | `1` |
| `web.service.type` | Frontend service type | `ClusterIP` |
| `web.service.port` | Frontend service port | `80` |
| `web.service.annotations` | Frontend service annotations | `{}` |
| `web.service.nodePort` | Frontend NodePort (when type: NodePort) | `""` |
| `web.service.loadBalancerIP` | Frontend LB IP (when type: LoadBalancer) | `""` |
| `web.service.externalTrafficPolicy` | Frontend external traffic policy | `""` |
| `web.resources.limits.cpu` | Frontend CPU limit | `200m` |
| `web.resources.limits.memory` | Frontend memory limit | `128Mi` |
| `web.resources.requests.cpu` | Frontend CPU request | `50m` |
| `web.resources.requests.memory` | Frontend memory request | `64Mi` |
| `fleetTelemetry.image` | Optional complete Fleet Telemetry image override | `""` |
| `fleetTelemetry.imageRepository` | Event-time-preserving Fleet Telemetry image | `ghcr.io/ev-dev-labs/teslasync-fleet-telemetry` |
| `fleetTelemetry.imageTag` | Fleet Telemetry image tag (defaults to chart appVersion) | `""` |
| `imagePullSecrets` | Image pull secrets | `[]` |
| `nameOverride` | Override chart name | `""` |
| `fullnameOverride` | Override full release name | `""` |
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Service account name | `""` |
| `podAnnotations` | Pod annotations | `{}` |
| `podSecurityContext.runAsNonRoot` | Run as non-root user | `true` |
| `podSecurityContext.runAsUser` | User ID to run as | `1000` |
| `podSecurityContext.fsGroup` | Filesystem group | `1000` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |
| `securityContext.readOnlyRootFilesystem` | Read-only root filesystem | `true` |
| `securityContext.capabilities.drop` | Dropped capabilities | `[ALL]` |
| `service.type` | Backend service type | `ClusterIP` |
| `service.port` | Backend service port | `8080` |
| `service.annotations` | Backend service annotations | `{}` |
| `service.nodePort` | Backend NodePort (when type: NodePort) | `""` |
| `service.loadBalancerIP` | Backend LB IP (when type: LoadBalancer) | `""` |
| `service.externalTrafficPolicy` | Backend external traffic policy | `""` |
| `ingress.enabled` | Enable ingress | `false` |
| `ingress.className` | Ingress class name | `""` |
| `ingress.annotations` | Ingress annotations | `{}` |
| `ingress.hosts` | Ingress host rules | See `values.yaml` |
| `ingress.tls` | Ingress TLS configuration | `[]` |
| `resources.limits.cpu` | Backend CPU limit | `500m` |
| `resources.limits.memory` | Backend memory limit | `512Mi` |
| `resources.requests.cpu` | Backend CPU request | `100m` |
| `resources.requests.memory` | Backend memory request | `128Mi` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `1` |
| `autoscaling.maxReplicas` | Maximum replicas | `5` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization | `80` |
| `nodeSelector` | Node selector labels | `kubernetes.io/hostname: carbon` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |
| `nodeRecovery.enforcePersistentState` | Reject ephemeral bundled stateful services | `true` |
| `nodeRecovery.dependencyWait.maxAttempts` | Five-second dependency checks before retry | `120` |
| `config.logLevel` | Application log level | `info` |
| `config.pollInterval` | Vehicle polling interval | `30s` |
| `config.apiEndpoint` | Internal API endpoint for Nginx proxy_pass and frontend API base URL. Nginx proxies `/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, `/metrics` to this address. Also injected into the frontend at runtime via Nginx `sub_filter` as `window.__TESLASYNC_API_BASE__`. Defaults to auto-derived `http://<release>-api:<port>` if empty. | `""` |
| `config.webEndpoint` | Public frontend URL for CORS | `""` |
| `tesla.clientId` | Tesla API client ID | `""` |
| `tesla.clientSecret` | Tesla API client secret | `""` |
| `tesla.redirectUri` | Tesla OAuth redirect URI | `http://localhost:8080/api/v1/auth/callback` |
| `tesla.apiBaseUrl` | Fleet API base URL (NA/EU/CN) | `https://fleet-api.prd.na.vn.cloud.tesla.com` |
| `fleetTelemetry.enabled` | Enable Fleet Telemetry status monitoring | `false` |
| `fleetTelemetry.host` | Fleet Telemetry server hostname | `` |
| `fleetTelemetry.service.port` | Fleet Telemetry server port | `4443` |
| `postgresql.enabled` | Deploy bundled PostgreSQL | `true` |
| `postgresql.auth.username` | PostgreSQL username | `teslasync` |
| `postgresql.auth.password` | PostgreSQL password when chart-managed secrets are enabled | `""` |
| `postgresql.auth.database` | PostgreSQL database name | `teslasync` |
| `postgresql.persistence.size` | PostgreSQL PVC size | `50Gi` |
| `redis.enabled` | Deploy bundled Redis | `true` |
| `redis.persistence.size` | Redis PVC size | `1Gi` |
| `mqtt.enabled` | Deploy bundled MQTT broker | `true` |
| `mqtt.service.port` | MQTT service port | `1883` |
| `grafana.enabled` | Deploy bundled Grafana | `true` |
| `grafana.adminUser` | Grafana admin username | `admin` |
| `grafana.adminPassword` | Grafana admin password when chart-managed secrets are enabled | `""` |
| `grafana.service.port` | Grafana service port | `3000` |
| `notificationWorker.enabled` | Deploy notification worker | `true` |
| `notificationWorker.replicaCount` | Notification worker replicas | `1` |
| `notificationWorker.image.repository` | Notification worker image | `ghcr.io/ev-dev-labs/teslasync-notification-worker` |
| `notificationWorker.resources.limits.memory` | Worker memory limit | `128Mi` |
| `encryption.key` | Custom encryption key for sensitive data | `""` |

## Secrets and the migration hook

The database migration Job runs as a `pre-install,pre-upgrade` Helm hook and
reads `DATABASE_PASS` from the runtime Secret through `envFrom`.

**Helm applies hooks before the release's ordinary manifests.** Any Secret
source the chart renders as an ordinary manifest therefore does not exist yet
when that Job is scheduled. With `externalSecrets.enabled=true` this produced a
failure that pointed nowhere: on a fresh install the ExternalSecret had not been
applied, External Secrets Operator had not been asked to fetch anything, and the
Job's pod sat in `CreateContainerConfigError` until the hook timed out.

Hook weights alone do not fix it. Weights only order resources that are
themselves hooks, and an ExternalSecret *existing* says nothing about whether
ESO has reached the provider and written the target Secret. The contract has two
halves — make the source exist before the hook, then wait for the data.

| `migrationGate.mode` | Ordering | Readiness wait | Valid when |
|---|---|---|---|
| `auto` (default) | resolves per secret source | resolves per secret source | always |
| `hook` | the secret source is rendered as a hook at weight `-10` (the Job is `0`) | yes | **requires** a chart-rendered source (`externalSecrets.enabled` or `secrets.create`) |
| `require` | none — the source lives outside this release | yes (this is the enforcement) | **requires** that no source is chart-rendered (`secrets.existingSecret`, or a GitOps-applied ExternalSecret) |
| `none` | none | no | NOT a general escape hatch — see below |

`auto` resolves to `hook` when `externalSecrets.enabled=true` or
`secrets.create=true`, and to `none` for `secrets.existingSecret` and the default
pre-provisioned Secret, where there is nothing for the chart to order.

The `hook`/`require` split is not a preference — the wrong one is a guaranteed
failure, so the chart refuses to render it:

* `require` **with** a chart-rendered source fails every fresh install by
  construction. An ordinary manifest cannot be applied until all pre-install
  hooks have completed, so the migration Job would wait the full
  `timeoutSeconds` for a Secret whose source Helm is holding back until the Job
  finishes.
* `hook` **without** a chart-rendered source has nothing to order.

In `require` mode the chart does **not** look the Secret up at render time. A
`lookup` would make rendering depend on cluster state and on the Helm client
holding RBAC to read Secrets, which many GitOps service accounts deliberately do
not have — and `internal/ops` forbids cluster lookups in the chart helpers for
the same reason. `require` is enforced where it can be enforced honestly: at the
hook boundary, by the readiness wait, which fails the migration Job (and so the
release) within `migrationGate.timeoutSeconds`.

The readiness wait is an initContainer that mounts the target Secret with
`optional: true` and polls its own mounted files, so it needs no API access and
no extra RBAC. On timeout it names the Secret, the missing keys, and the
`kubectl get externalsecret` command that shows why ESO has not synced.

```yaml
externalSecrets:
  enabled: true
  secretStoreRef:
    name: production-secrets
    kind: ClusterSecretStore
  dataFrom:
    - extract:
        key: teslasync/production
  target:
    creationPolicy: ""    # empty -> Orphan in hook mode (see below)

migrationGate:
  mode: auto            # -> hook
  timeoutSeconds: 300   # must exceed worst-case ESO reconciliation
  pollIntervalSeconds: 5
  requiredKeys:
    - DATABASE_PASS
```

### Lifecycle guarantees in `hook` mode

`hook` mode changes how two objects are managed, and both changes carry a
lifecycle hazard that the chart closes explicitly.

**1. Converting an existing ordinary manifest into a hook must not destroy it.**
Upgrading a release that previously rendered the Secret (or ExternalSecret) as an
ordinary manifest is a two-step self-destruct without protection:
`before-hook-creation` deletes and recreates the object during pre-upgrade, and
then Helm reconciles the ordinary manifests, finds the object in the **old**
release manifest but not the new one, and deletes the object it just created.

The chart therefore emits `helm.sh/resource-policy: keep` on every hook-rendered
secret source. Helm's `kube.Client.Update` calls `info.Get()` and skips the
deletion when the **live** object carries that annotation, while
`kube.Client.Delete` — the path hook delete policies use — never consults it. So
the conversion is protected and `before-hook-creation` still works.

**2. Recreating the ExternalSecret must not garbage-collect its target Secret.**
`before-hook-creation` deletes the ExternalSecret on every upgrade. Per the ESO
API reference, `creationPolicy: Owner` "sets `.metadata.ownerReferences`. If the
ExternalSecret is deleted, the Secret will also be deleted" — so with the ESO
default, that upgrade would pull the credentials out from under every running
pod.

`deletionPolicy: Retain` does **not** prevent this. It "specifies what happens to
the Secret when data fields are deleted **from the provider**"; it says nothing
about deletion of the ExternalSecret object itself. Treating it as CR-deletion
protection is the trap.

The chart therefore renders `creationPolicy: Orphan` **in every
`migrationGate.mode`**, not only in hook mode. `Owner` is a time bomb in every
mode: a release installed today under `none` or `require` stamps an
ownerReference onto the target, and the day it later enters hook mode the
`before-hook-creation` delete collects the Secret through that pre-existing
reference. Setting `externalSecrets.target.creationPolicy` to anything other than
`""` or `Orphan` is a **render-time error in all modes**.

> ⚠️ **This governs future reconciles only.** Rendering `Orphan` does **not**
> retroactively strip an ownerReference that an earlier `Owner`-managed reconcile
> already wrote onto a live Secret, and ESO does not retract references it has
> already set. A release that ran with `Owner` before this change **must**
> complete the one-time preflight in
> [docs/runbooks/migration-gate-lifecycle.md](../../docs/runbooks/migration-gate-lifecycle.md)
> — which inspects the target's `ownerReferences`, removes only the
> ExternalSecret entry, verifies the Secret survives, and backs out safely —
> before its first conversion into hook mode.

### Lifecycle transitions are operator procedures, not values changes

Helm tracks hook resources and ordinary manifests separately and offers **no
supported in-place transition between them**. That is a property of Helm; the
chart cannot template it away. Three operations are therefore **not** safe as a
bare `helm upgrade` / `helm rollback`:

1. **First conversion** of a pre-fix ordinary source into `hook` mode.
2. **Rollback** from a hook-mode revision to any pre-conversion revision — you
   must back up and inspect the source object, delete the hook source
   immediately before `helm rollback` so Helm sees `NotFound` and recreates the
   ordinary target, then verify the runtime Secret and workloads. Retention
   differs by source kind: an ExternalSecret's orphaned target survives, while a
   chart-managed Secret **is** the credential and deleting it opens an outage
   window.
3. **Leaving hook mode.** `hook` mode is **sticky** for a source identity.
   Flipping `migrationGate.mode` to `none` or `require` in values is not a
   supported transition — the render stops emitting the object while the live
   object persists as a kept hook resource that nothing manages. Use the staged
   path (delete the hook source, hand the source to GitOps, upgrade to
   `require`) or install under a new release name.

`none` is **not a general escape hatch**. It does not make the ordering race
safe; it only stops the chart from managing it, and for a chart-rendered source
it is a known-broken fresh install.

Full procedures, verification steps, and back-outs:
[docs/runbooks/migration-gate-lifecycle.md](../../docs/runbooks/migration-gate-lifecycle.md).
They are registered in `ops/runbooks/dependencies.yaml` and enforced by
`go run ./cmd/ops-gate -check runbooks`, so the warnings, the commands, and the
cross-links from the generic Upgrading/Rollback sections above cannot drift away.

### Uninstall and manual cleanup

`resource-policy: keep` and `creationPolicy: Orphan` both trade automatic cleanup
for safety, so `helm uninstall` deliberately leaves objects behind (the orphaned
target Secret in every mode; the kept source as well in `hook` mode):

```bash
# 1. the hook-rendered secret source (Secret or ExternalSecret)
kubectl delete externalsecret <release>-teslasync   # externalSecrets mode
kubectl delete secret        <release>-teslasync    # secrets.create mode

# 2. the target Secret, orphaned by creationPolicy: Orphan
kubectl delete secret <target-name>

# 3. nothing else — the migration Job is removed by hook-succeeded
```

For the chart-managed Secret this preserves the original intent of
`helm.sh/resource-policy: keep`, which the chart still emits in every mode.

The effective contract is recorded on the Job as
`teslasync.io/migration-gate`, so it is auditable after the fact:

```bash
kubectl get job -l app.kubernetes.io/component=migrate \
  -o jsonpath='{.items[0].metadata.annotations.teslasync\.io/migration-gate}'
```

`go run ./cmd/ops-gate -verify-helm-render <render.yaml>` asserts the invariant
over `helm template` output and fails on a non-hook secret source, an equal or
higher hook weight, a missing or unbounded wait, or a non-optional Secret mount.

## Using External Services

You can disable bundled services and point TeslaSync at your own infrastructure.

### External PostgreSQL

```yaml
postgresql:
  enabled: false
  external:
    host: my-postgres.example.com
    port: 5432
    username: teslasync
    password: secretpassword
    database: teslasync
```

### External Redis

```yaml
redis:
  enabled: false
  external:
    host: my-redis.example.com
    port: 6379
```

### External MQTT Broker

```yaml
mqtt:
  enabled: false
  external:
    host: my-mqtt.example.com
    port: 1883
```

## Ingress Configuration

TeslaSync uses a **single-route ingress** architecture. All external traffic is routed to `teslasync-web` (Nginx), which serves static files directly and proxies API paths (`/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, `/metrics`) to `teslasync-api` over the internal Kubernetes network. There is no need to configure a separate `/api` path in your ingress — Nginx handles the API routing internally.

This design offers several advantages for homelab and production deployments:
- **Fewer ingress rules** — a single route simplifies configuration and debugging
- **Internal API traffic** — API requests stay on the cluster network, reducing ingress controller load
- **Fewer external hops** — after the initial page load, all API calls go directly from Nginx to the API pod without traversing the ingress controller again

### Standard Kubernetes Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: teslasync.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com
```

> **Note:** Only a single `/` path pointing to `web` is needed. Do **not** add a separate `/api/` path — Nginx proxies API traffic internally to `teslasync-api`.

### Traefik IngressRoute

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls: "true"
  hosts:
    - host: teslasync.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com
```

If you are using a Traefik `IngressRoute` CRD directly, only one route is needed:

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: teslasync
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`teslasync.example.com`)
      kind: Rule
      services:
        - name: teslasync-web
          port: 80
  tls:
    secretName: teslasync-tls
```

> **Important:** There is no `/api` route in the IngressRoute. All API traffic is proxied internally by Nginx.

## API Routing

TeslaSync uses Nginx as both a static file server and a reverse proxy for API traffic. This keeps API requests on the internal Kubernetes network and eliminates the need for multiple ingress routes.

### Traffic Flow

```
Browser → Traefik/Ingress → teslasync-web (Nginx :80)
                              ├── /index.html, /assets/*   → served directly (static files)
                              ├── /api/*                   → proxy_pass → teslasync-api:8080
                              ├── /.well-known/*            → proxy_pass → teslasync-api:8080
                              ├── /healthz, /readyz         → proxy_pass → teslasync-api:8080
                              ├── /metrics                  → proxy_pass → teslasync-api:8080
                              └── teslasync-api:8080        → Tesla Fleet API (outbound only)
```

### How It Works

1. **Single ingress route** — The ingress controller (Traefik, Nginx Ingress, etc.) routes all traffic for your domain to the `teslasync-web` service (Nginx on port 80).

2. **Nginx serves static files** — Requests for the React SPA (`/`, `/index.html`, `/assets/*`) are served directly from the Nginx container's filesystem.

3. **Nginx proxies API requests** — Requests matching `/api/`, `/.well-known/`, `/healthz`, `/readyz`, or `/metrics` are forwarded via `proxy_pass` to `teslasync-api:8080` over the internal Kubernetes cluster network.

4. **Frontend API base URL** — The `config.apiEndpoint` value is injected into the frontend at runtime via Nginx `sub_filter`, setting `window.__TESLASYNC_API_BASE__` so the React app knows where to send API requests.

5. **Auto-derived endpoint** — If `config.apiEndpoint` is left empty (the default), the chart automatically derives it as `http://<release>-api:<port>` based on the release name and service port.

### Why Internal Routing?

- **Homelab optimization** — Most homelabs run a single ingress controller (often Traefik). Routing API traffic internally avoids doubling the load on that controller.
- **Reduced latency** — API calls between Nginx and the Go backend use cluster-internal DNS (`teslasync-api.namespace.svc.cluster.local`), avoiding TLS termination and external routing overhead.
- **Simplified ingress** — One route instead of two means fewer things to debug when something goes wrong.

## Upgrading

```bash
helm upgrade teslasync teslasync/teslasync -f values.yaml
```

- **Workload-aware update strategy** — stateless API/web workloads use
  `RollingUpdate`; the API switches to `Recreate` while it owns Fleet
  Telemetry, and stable-ID MQTT workers always use `Recreate`.
- **Database migrations** run through the chart's pre-install/pre-upgrade Job.
- **PVCs are retained** on uninstall so your data is not lost.

> ⚠️ **Not for migration-gate transitions.** A bare `helm upgrade` is only safe
> while the secret source stays in the same Helm category. The FIRST upgrade
> that moves a source into `hook` mode crosses Helm's hook/ordinary manifest
> boundary and needs the explicit procedure in
> [docs/runbooks/migration-gate-lifecycle.md](../../docs/runbooks/migration-gate-lifecycle.md).

## Rollback

```bash
# View release history
helm history teslasync

# Roll back to a specific revision
helm rollback teslasync [REVISION]
```

> ⚠️ **Stop before rolling back across a migration-gate conversion.** If the
> current revision renders the secret source as a Helm hook and the target
> revision rendered it as an ordinary manifest, the command above leaves the
> release believing it manages an ordinary source that is in fact still a kept
> hook resource — and the live object is managed by nobody.
>
> You must back up and inspect the source object, delete the hook source
> immediately before the rollback so Helm sees `NotFound` and recreates the
> ordinary target, then verify the runtime Secret and the workloads. Retention
> differs between a chart-managed Secret (deleting it deletes the live
> credentials) and an ExternalSecret (its orphaned target survives).
>
> Full procedure, including the back-out:
> [docs/runbooks/migration-gate-lifecycle.md](../../docs/runbooks/migration-gate-lifecycle.md)
> — Procedure 2.
>
> Check which category you are in before running anything:
>
> ```bash
> kubectl get job -l app.kubernetes.io/component=migrate \
>   -o jsonpath='{.items[0].metadata.annotations.teslasync\.io/migration-gate}'
> ```

## Node reboot recovery

The default chart targets TeslaSync's self-hosted homelab topology:
single-instance stateful services on retained PVCs, with workloads pinned to
the `carbon` node. Startup probes allow WAL, AOF, and MQTT session replay to
finish, and dependency init containers hold consumers until PostgreSQL and
Mosquitto are reachable.

This protects a same-node reboot with the same disk. It is not permanent-node
or disk-failure high availability; local-path storage cannot move its data to
another host. Use the preflight, planned-drain, recovery-order, and integrity
checks in
[docs/runbooks/kubernetes-node-reboot.md](../../docs/runbooks/kubernetes-node-reboot.md).

## Testing

Run the built-in chart tests to verify a release is healthy:

```bash
helm test teslasync
```

## Uninstalling

```bash
helm uninstall teslasync
```

> **Note:** PVCs are retained after uninstall. Delete them manually if you no longer need the data:
>
> ```bash
> kubectl delete pvc -l app.kubernetes.io/instance=teslasync
> ```

## Architecture

```
                        ┌────────────────────┐
                        │     Ingress /       │
                        │   IngressRoute      │
                        └────────┬───────────┘
                                 │
                          all traffic (single route)
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │   TeslaSync Web      │
                      │   (Nginx :80)        │
                      │                      │
                      │  static files:       │
                      │   served directly    │
                      │                      │
                      │  /api/*, /.well-     │
                      │  known/*, /healthz,  │
                      │  /readyz, /metrics:  │
                      │   proxy_pass ──────────────┐
                      └──────────────────────┘     │
                                                    │ internal k8s
                                                    │ network
                                                    ▼
                      ┌──────────────────────┐
                      │   TeslaSync API      │
                      │   (Go :8080)         │
                      │   + API suspend      │
                      └───────┬─────┬────────┘
                              │     │
                   ┌──────────┘     └──────────┐
                   ▼                           ▼
            ┌──────────────┐          ┌────────────────┐
            │  PostgreSQL  │          │     Redis      │
            │   (PG 17)    │          │   (caching)    │
            └──────┬───────┘          └────────────────┘
                   │
                   ▼                  ┌────────────────┐
            ┌──────────────┐          │  MQTT Broker   │
            │   Grafana    │◄─────────│  (telemetry +  │
            │ (dashboards) │          │   events)      │
            └──────────────┘          └───────┬────────┘
                                              │
                                      ┌───────▼────────┐
                                      │  Notification  │
                                      │    Worker      │
                                      └────────────────┘
```

> **Note:** All external traffic enters through a single ingress route to Nginx. Nginx proxies API paths internally to `teslasync-api` over the Kubernetes cluster network. The API service is never directly exposed via ingress.

## Troubleshooting

### Pods stuck in `CrashLoopBackOff`

Check pod logs for startup errors:

```bash
kubectl logs -l app.kubernetes.io/name=teslasync --tail=50
```

Common causes:
- Missing Tesla API credentials (`tesla.clientId` / `tesla.clientSecret`)
- PostgreSQL not ready — wait for the database pod to become healthy first
- Incorrect external database connection parameters

### Database connection refused

If using the bundled PostgreSQL, ensure the PVC was provisioned:

```bash
kubectl get pvc -l app.kubernetes.io/instance=teslasync
```

If using an external database, verify connectivity from inside the cluster:

```bash
kubectl run pg-test --rm -it --image=postgres:16 -- \
  psql -h my-postgres.example.com -U teslasync -d teslasync
```

### Ingress not routing traffic

- Verify the ingress controller is installed and the `className` matches.
- Check ingress resource status: `kubectl describe ingress teslasync`.
- Ensure DNS points to the ingress controller's external IP.
- Ensure only a single `/` path is configured — do not add a separate `/api` path. Nginx handles API proxying internally to `teslasync-api`.
- If using Traefik IngressRoute, verify the route points to `teslasync-web` (port 80), not `teslasync-api`.

### Grafana dashboards missing

Dashboards are provisioned automatically from ConfigMaps. If they're missing:

```bash
kubectl rollout restart deployment teslasync-grafana
```

### PVC stuck in `Pending`

Your cluster may not have a default `StorageClass`. Set one explicitly:

```yaml
postgresql:
  primary:
    persistence:
      storageClass: my-storage-class
```
