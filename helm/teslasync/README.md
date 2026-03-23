# TeslaSync Helm Chart

<!-- badges -->
![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square)
![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square)
![AppVersion: 1.0.0](https://img.shields.io/badge/AppVersion-1.0.0-informational?style=flat-square)

Helm chart for deploying TeslaSync — a Tesla fleet intelligence platform.

## Prerequisites

- Kubernetes 1.24+
- Helm 3.12+
- PV provisioner support (for PostgreSQL, Redis, Grafana persistence)
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
| `image.repository` | Backend image repository | `ghcr.io/ev-dev-labs/teslasync` |
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
| `resources.limits.memory` | Backend memory limit | `256Mi` |
| `resources.requests.cpu` | Backend CPU request | `100m` |
| `resources.requests.memory` | Backend memory request | `128Mi` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `1` |
| `autoscaling.maxReplicas` | Maximum replicas | `3` |
| `autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization | `80` |
| `nodeSelector` | Node selector labels | `{}` |
| `tolerations` | Pod tolerations | `[]` |
| `affinity` | Pod affinity rules | `{}` |
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
| `fleetTelemetry.port` | Fleet Telemetry server port | `4443` |
| `postgresql.enabled` | Deploy bundled PostgreSQL | `true` |
| `postgresql.auth.username` | PostgreSQL username | `teslasync` |
| `postgresql.auth.password` | PostgreSQL password | `teslasync` |
| `postgresql.auth.database` | PostgreSQL database name | `teslasync` |
| `postgresql.primary.persistence.size` | PostgreSQL PVC size | `10Gi` |
| `redis.enabled` | Deploy bundled Redis | `true` |
| `redis.auth.enabled` | Enable Redis authentication | `false` |
| `redis.master.persistence.size` | Redis PVC size | `1Gi` |
| `mqtt.enabled` | Deploy bundled MQTT broker | `true` |
| `mqtt.service.port` | MQTT service port | `1883` |
| `grafana.enabled` | Deploy bundled Grafana | `true` |
| `grafana.adminUser` | Grafana admin username | `admin` |
| `grafana.adminPassword` | Grafana admin password | `teslasync` |
| `grafana.service.port` | Grafana service port | `3000` |
| `notificationWorker.enabled` | Deploy notification worker | `true` |
| `notificationWorker.replicaCount` | Notification worker replicas | `1` |
| `notificationWorker.image.repository` | Notification worker image | `ghcr.io/your-org/teslasync-notification-worker` |
| `notificationWorker.resources.limits.memory` | Worker memory limit | `128Mi` |
| `encryption.key` | Custom encryption key for sensitive data | `""` |

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

- **Rolling update strategy** — pods are replaced one at a time for zero-downtime deployments.
- **Database migrations** run automatically on startup via init containers.
- **PVCs are retained** on uninstall so your data is not lost.

## Rollback

```bash
# View release history
helm history teslasync

# Roll back to a specific revision
helm rollback teslasync [REVISION]
```

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
