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
helm repo add teslasync https://teslasync-labs.github.io/teslasync/helm
helm repo update
helm install teslasync teslasync/teslasync \
  --set tesla.clientId=YOUR_CLIENT_ID \
  --set tesla.clientSecret=YOUR_CLIENT_SECRET

# Method 2: OCI Registry (no repo add needed)
helm install teslasync oci://ghcr.io/teslasync-labs/charts/teslasync \
  --set tesla.clientId=YOUR_CLIENT_ID \
  --set tesla.clientSecret=YOUR_CLIENT_SECRET
```

## Installation

### From Helm Repository

```bash
helm repo add teslasync https://teslasync-labs.github.io/teslasync/helm
helm repo update
helm install teslasync teslasync/teslasync -f values.yaml

# Search available versions
helm search repo teslasync --versions
```

### From OCI Registry

```bash
helm install teslasync oci://ghcr.io/teslasync-labs/charts/teslasync \
  -f values.yaml

# Install specific version
helm install teslasync oci://ghcr.io/teslasync-labs/charts/teslasync --version 0.7.1
```

### From Source

```bash
git clone https://github.com/teslasync-labs/teslasync.git
cd teslasync
helm install teslasync ./helm/teslasync -f my-values.yaml
```

## Configuration

The following table lists all configurable parameters and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Backend replicas | `1` |
| `image.repository` | Backend image repository | `ghcr.io/teslasync-labs/teslasync` |
| `image.pullPolicy` | Backend image pull policy | `IfNotPresent` |
| `image.tag` | Backend image tag (defaults to chart appVersion) | `""` |
| `web.enabled` | Enable frontend deployment | `true` |
| `web.image.repository` | Frontend image repository | `ghcr.io/teslasync-labs/teslasync-web` |
| `web.image.pullPolicy` | Frontend image pull policy | `IfNotPresent` |
| `web.image.tag` | Frontend image tag | `""` |
| `web.replicaCount` | Frontend replicas | `1` |
| `web.service.type` | Frontend service type | `ClusterIP` |
| `web.service.port` | Frontend service port | `80` |
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
| `tesla.clientId` | Tesla API client ID | `""` |
| `tesla.clientSecret` | Tesla API client secret | `""` |
| `tesla.redirectUri` | Tesla OAuth redirect URI | `http://localhost:8080/api/v1/auth/callback` |
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
        - path: /api
          pathType: Prefix
          service: backend
        - path: /
          pathType: Prefix
          service: web
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com
```

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
        - path: /api
          pathType: Prefix
          service: backend
        - path: /
          pathType: Prefix
          service: web
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com
```

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
                    ┌────────────┴────────────┐
                    │                         │
               /api │                    /    │
                    ▼                         ▼
          ┌─────────────────┐      ┌──────────────────┐
          │  TeslaSync API  │      │  TeslaSync Web   │
          │    (backend)    │      │   (frontend)     │
          └───────┬─────┬───┘      └──────────────────┘
                  │     │
       ┌──────────┘     └──────────┐
       ▼                           ▼
┌──────────────┐          ┌────────────────┐
│  PostgreSQL  │          │     Redis      │
│   (PG 17)    │          │   (caching)    │
└──────────────┘          └────────────────┘
       │
       ▼
┌──────────────┐          ┌────────────────┐
│   Grafana    │◄─────────│  MQTT Broker   │
│ (dashboards) │          │  (telemetry)   │
└──────────────┘          └────────────────┘
```

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
