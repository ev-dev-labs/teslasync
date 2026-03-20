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
├── Chart.yaml              # Chart metadata (name, version, appVersion)
├── values.yaml             # Default configuration values
└── templates/
    ├── deployment.yaml     # Backend Deployment
    ├── deployment-web.yaml # Frontend Deployment
    ├── service.yaml        # ClusterIP Service
    ├── ingress.yaml        # Ingress (optional)
    ├── configmap.yaml      # Non-sensitive configuration
    ├── secret.yaml         # Sensitive data (credentials)
    └── serviceaccount.yaml # RBAC ServiceAccount
```

## Quick Install

```bash
# Install with default values + required Tesla credentials
helm upgrade --install teslasync helm/teslasync \
  --set tesla.clientId=$TESLA_CLIENT_ID \
  --set tesla.clientSecret=$TESLA_CLIENT_SECRET

# Or use a values file
helm upgrade --install teslasync helm/teslasync \
  -f my-values.yaml
```

## Configuration

### Key Values

The `values.yaml` file contains all configurable parameters. Here are the most important ones:

```yaml
# Image configuration
image:
  repository: ghcr.io/teslasync-labs/teslasync
  tag: latest
  pullPolicy: IfNotPresent

webImage:
  repository: ghcr.io/teslasync-labs/teslasync-web
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

The web deployment (`templates/deployment-web.yaml`) serves the React SPA:

- **Replicas:** Configurable (default 1)
- **Port:** 80 (Nginx)
- **Health checks:** HTTP GET on `/`
- **Resources:** Lightweight (32M–128M memory)

### Ingress

The ingress template (`templates/ingress.yaml`) exposes TeslaSync externally:

```bash
# Enable ingress with custom domain
helm upgrade --install teslasync helm/teslasync \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=teslasync.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

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
