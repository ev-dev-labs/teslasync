# Kubernetes Deployment

TeslaSync includes a Helm chart for deploying to Kubernetes clusters. The chart is located in `helm/teslasync/` and supports full customization of all components.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Kubernetes](https://kubernetes.io/) | 1.25+ | Container orchestration |
| [Helm](https://helm.sh/) | 3.12+ | Package manager for Kubernetes |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | 1.25+ | Kubernetes CLI |

## Helm Chart Structure

```
helm/teslasync/
├── Chart.yaml                          # Chart metadata
├── values.yaml                         # Default configuration
└── templates/
    ├── deployment.yaml                 # Backend API Deployment
    ├── deployment-web.yaml             # Frontend Deployment
    ├── deployment-notification.yaml    # Notification Worker Deployment
    ├── deployment-redis.yaml           # Redis Deployment
    ├── deployment-postgresql.yaml      # PostgreSQL Deployment
    ├── deployment-mosquitto.yaml       # MQTT Deployment
    ├── deployment-grafana.yaml         # Grafana Deployment
    ├── service.yaml                    # Backend + Web Services
    ├── ingress.yaml                    # Ingress (optional)
    ├── ingressRoute.yaml               # Traefik IngressRoute (optional)
    ├── configmap.yaml                  # Non-sensitive configuration
    ├── configmap-nginx.yaml            # Nginx proxy config
    ├── secret.yaml                     # Sensitive data (credentials, encryption key)
    ├── serviceaccount.yaml             # RBAC ServiceAccount
    ├── hpa.yaml                        # Horizontal Pod Autoscaler
    ├── pdb.yaml                        # Pod Disruption Budget
    └── _helpers.tpl                    # Template helpers
```

## Quick Install

### Method 1: Helm Repository (recommended)

```bash
# Add the TeslaSync Helm repository
helm repo add teslasync https://ev-dev-labs.github.io/teslasync/helm
helm repo update

# Install
helm install teslasync teslasync/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET

# Upgrade to latest
helm repo update
helm upgrade teslasync teslasync/teslasync

# Search available versions
helm search repo teslasync --versions
```

### Method 2: OCI Registry

```bash
# Install directly from GHCR (no repo add needed)
helm install teslasync oci://ghcr.io/ev-dev-labs/charts/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET

# Install a specific version
helm install teslasync oci://ghcr.io/ev-dev-labs/charts/teslasync --version 0.7.1
```

### Method 3: From Source

```bash
# Clone the repo and install from local chart
git clone https://github.com/ev-dev-labs/teslasync.git
helm install teslasync ./teslasync/helm/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET

# Or use a values file
helm install teslasync ./teslasync/helm/teslasync -f my-values.yaml
```

## Configuration

### Key Values

The `values.yaml` file contains all configurable parameters. Here are the most important ones:

```yaml
# Image configuration
image:
  repository: ghcr.io/ev-dev-labs/teslasync
  tag: latest
  pullPolicy: IfNotPresent

webImage:
  repository: ghcr.io/ev-dev-labs/teslasync-web
  tag: latest
  pullPolicy: IfNotPresent

# Replica counts
replicaCount: 1
webReplicaCount: 1

# Tesla API credentials (REQUIRED)
tesla:
  clientId: ""
  clientSecret: ""
  redirectUri: "http://localhost:8080/api/v1/auth/callback"
  apiBaseUrl: "https://fleet-api.prd.na.vn.cloud.tesla.com"

# Service configuration
service:
  type: ClusterIP
  port: 8080

webService:
  type: ClusterIP
  port: 80

# Ingress configuration
ingress:
  enabled: false
  className: nginx
  annotations: {}
  hosts:
    - host: teslasync.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []

# PostgreSQL sub-chart
postgresql:
  enabled: true
  auth:
    username: teslasync
    password: teslasync
    database: teslasync
  primary:
    persistence:
      size: 10Gi

# Redis sub-chart
redis:
  enabled: true
  architecture: standalone
  auth:
    enabled: false

# MQTT
mqtt:
  enabled: true
  host: mosquitto
  port: 1883

# Resource limits
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi

webResources:
  limits:
    cpu: 200m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 32Mi
```

### Custom Values File

Create a `my-values.yaml` for your deployment:

```yaml
# my-values.yaml
tesla:
  clientId: "your-client-id"
  clientSecret: "your-client-secret"
  redirectUri: "https://teslasync.example.com/api/v1/auth/callback"

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
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com

postgresql:
  auth:
    password: "secure-database-password"
  primary:
    persistence:
      size: 50Gi

resources:
  limits:
    cpu: "1"
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 256Mi
```

> **Note:** Only a single `/` path is needed in the ingress — Nginx handles routing API requests to the backend internally.

Install with the custom values:

```bash
helm upgrade --install teslasync helm/teslasync -f my-values.yaml
```

## Deployment Templates

### Backend Deployment

The backend deployment (`templates/deployment.yaml`) runs the Go API server:

- **Replicas:** Configurable (default 1)
- **Port:** 8080
- **Health checks:** Liveness on `/healthz`, readiness on `/readyz`
- **Environment:** Injected from ConfigMap and Secret
- **Resources:** Configurable CPU/memory limits

### Frontend Deployment

The web deployment (`templates/deployment-web.yaml`) serves the React SPA and proxies API traffic:

- **Replicas:** Configurable (default 1)
- **Port:** 80 (Nginx)
- **Health checks:** HTTP GET on `/`
- **Resources:** Lightweight (32M–128M memory)
- **Reverse proxy:** Forwards `/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, `/metrics` to `teslasync-api` over the internal cluster network

### Ingress

The ingress template (`templates/ingress.yaml`) exposes TeslaSync externally using a **single-route** pattern. All traffic routes to `teslasync-web` (Nginx), which serves static files and proxies API requests internally to `teslasync-api`:

```bash
# Enable ingress with custom domain
helm upgrade --install teslasync helm/teslasync \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=teslasync.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

> **Note:** Only a single `/` path pointing to the web service is needed. Nginx handles routing `/api/*`, `/.well-known/*`, `/healthz`, `/readyz`, and `/metrics` to the API pod internally over the Kubernetes cluster network.

#### Traefik IngressRoute

If using Traefik's native `IngressRoute` CRD, only one route is required:

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

#### Standard Kubernetes Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: teslasync
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - teslasync.example.com
      secretName: teslasync-tls
  rules:
    - host: teslasync.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: teslasync-web
                port:
                  number: 80
```

> **Important:** Do not add a separate `/api` path to the ingress. API traffic is proxied internally by Nginx to `teslasync-api:8080`, keeping API requests on the cluster network and reducing ingress controller load.

### Secrets

Sensitive data is stored in a Kubernetes Secret (`templates/secret.yaml`):

- Tesla client ID and secret
- Database password
- JWT secret (if auth is enabled)

```bash
# View the generated secret
kubectl get secret teslasync -o yaml
```

## Operations

### Install

```bash
helm upgrade --install teslasync helm/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=teslasync.example.com
```

### Upgrade

```bash
# Update the image tag
helm upgrade teslasync helm/teslasync \
  --set image.tag=v1.2.0 \
  --set webImage.tag=v1.2.0

# Or reuse existing values
helm upgrade teslasync helm/teslasync --reuse-values \
  --set image.tag=v1.2.0
```

### Uninstall

```bash
helm uninstall teslasync
```

::: warning
Uninstalling the Helm release will delete all Kubernetes resources **except** PersistentVolumeClaims. Your data in PostgreSQL is preserved unless you manually delete the PVC.
:::

### Status & Debugging

```bash
# Check release status
helm status teslasync

# View all resources
kubectl get all -l app.kubernetes.io/instance=teslasync

# Check pod logs
kubectl logs -l app=teslasync -f

# Describe a pod for troubleshooting
kubectl describe pod -l app=teslasync

# Port-forward for local access
kubectl port-forward svc/teslasync 8080:8080
kubectl port-forward svc/teslasync-web 3000:80
```

## Scaling

### Horizontal Scaling

```bash
# Scale backend replicas
kubectl scale deployment teslasync --replicas=3

# Scale frontend replicas
kubectl scale deployment teslasync-web --replicas=2
```

::: tip
When scaling the backend, ensure `DATABASE_MAX_CONNS` is adjusted per replica to avoid exhausting the PostgreSQL connection limit. For example, with 3 replicas and a PostgreSQL max of 100 connections, set `DATABASE_MAX_CONNS=25` per replica.
:::

### Autoscaling

Add an HPA (Horizontal Pod Autoscaler):

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: teslasync
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: teslasync
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## Monitoring in Kubernetes

### Prometheus ServiceMonitor

If you're using the Prometheus Operator, create a ServiceMonitor:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: teslasync
spec:
  selector:
    matchLabels:
      app: teslasync
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

### Grafana

Deploy Grafana alongside TeslaSync and import the dashboards from `grafana/dashboards/`:

```bash
# Copy dashboard JSON files
kubectl create configmap grafana-dashboards \
  --from-file=grafana/dashboards/
```

## Make Targets

```bash
make helm-install     # Install/upgrade the Helm chart
make helm-uninstall   # Uninstall the Helm release
```
