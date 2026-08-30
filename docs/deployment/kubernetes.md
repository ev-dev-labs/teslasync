# Kubernetes deployment

The Helm chart under `helm/teslasync` is the canonical way to run TeslaSync on Kubernetes. It deploys the same architecture you'd get from Docker Compose — API, three worker binaries, data plane, observability — but with Kubernetes-native primitives: Deployments, Services, ConfigMaps, Secrets, optional Ingress or IngressRoute, optional HorizontalPodAutoscalers.

This page is the deployment guide. For the runtime architecture itself, see [Architecture](/guide/architecture). For every configuration knob, see [Configuration](/guide/configuration).

## When Kubernetes is the right choice

Choose Kubernetes when:

- You want multiple API replicas behind a load balancer
- You want managed certificates, ingress rate limiting, network policies, pod security
- You already operate a cluster and adding one more workload is easier than running a separate host
- You want to scale horizontally as your fleet grows past the point where one host is comfortable

If none of the above apply, [Docker Compose](/deployment/docker) is simpler and faster to operate.

## The 30-second walkthrough

```bash
# from the repo root
helm lint helm/teslasync
helm template teslasync helm/teslasync -f values.yaml
helm upgrade --install teslasync helm/teslasync \
  -n teslasync --create-namespace \
  -f values.yaml
kubectl rollout status deployment/teslasync-api -n teslasync
```

That gets you a running deployment. The interesting work is in your `values.yaml` — what's published below is the contract for that file.

## Core values

The minimum useful `values.yaml` for a same-origin deployment behind a forward-auth proxy:

```yaml
image:
  repository: ghcr.io/ev-dev-labs/teslasync-api
  # tag defaults to chart appVersion

web:
  enabled: true
  service:
    type: ClusterIP

service:
  type: ClusterIP

config:
  apiEndpoint: "http://teslasync-api.teslasync.svc.cluster.local:8080"
  browserApiBase: ""
  webEndpoint: "https://teslasync.example.com"
  forwardAuthHeader: "X-Authentik-Username"
```

A few things worth understanding before tuning the rest.

### `apiEndpoint` vs `browserApiBase`

This trips people up.

- **`apiEndpoint`** is the URL **Nginx in the web container** uses when it proxies `/api/*` to the API service. It's always an internal cluster DNS name. Always `http://` (TLS is at the ingress, not internal).
- **`browserApiBase`** is the URL the **browser** sees in JavaScript. For same-origin deployments, leave it **empty** — the SPA hits `/api/...` on its own origin and Nginx forwards it internally. For separate-origin deployments (API on its own subdomain), set it to the API's URL and configure CORS via `CORS_ORIGINS`.

Most installs are same-origin. Empty `browserApiBase` is the default to choose first.

### Services should be `ClusterIP`

API and web services are `ClusterIP` unless you have a specific reason to expose them at L4. The ingress (or IngressRoute) handles external traffic. Data services (postgres, redis, mosquitto) are always `ClusterIP`.

### `forwardAuthHeader` must match your proxy

| Provider                | Header value                    |
| ----------------------- | ------------------------------- |
| Authentik               | `X-Authentik-Username`          |
| Authelia                | `Remote-User`                   |
| oauth2-proxy            | `X-Auth-Request-User`           |
| Keycloak / custom proxy | `X-Forwarded-User`              |

A wrong header value produces 401 on every request once the user is "logged in". The forward-auth proxy strips and re-injects the header, so spoofing from outside the cluster is blocked at the ingress.

## Optional components

The chart can deploy or skip each of these. Toggle in `values.yaml`:

| Component                   | Helm key                                                 | Purpose                                            |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Vehicle Command Proxy       | `commandProxy.enabled` / `commandProxy.external.url`     | Signs commands for vehicles that require it        |
| Fleet Telemetry server      | `fleetTelemetry.enabled`                                 | Tesla streaming endpoint, low-latency live data    |
| Jaeger                      | `jaeger.enabled`                                         | OpenTelemetry trace UI                             |
| Ollama                      | `ollama.enabled`                                         | Local LLM inference for Helix AI                   |
| MongoDB                     | `mongodb.enabled`                                        | Optional raw signal capture for debugging          |

For data services (PostgreSQL, Redis, Mosquitto), the chart can either deploy embedded versions or point at external instances you operate separately. Production deployments usually point at managed Postgres (`postgresql.enabled: false`, then provide `postgresql.external.*`) and managed Redis. The chart's embedded data services are fine for small to medium installs.

## Ingress

Two patterns, depending on which controller you use.

### Traefik with IngressRoute

The recommended pattern. Two routes — the `/.well-known` path public for Tesla key verification, everything else behind auth.

```yaml
ingressRoute:
  enabled: true
  entryPoints:
    - websecure
  routes:
    # Tesla public-key route MUST bypass auth
    - kind: Rule
      match: "Host(`teslasync.example.com`) && PathPrefix(`/.well-known`)"
      priority: 100
      middlewares:
        - name: default-headers
          namespace: traefik
      services:
        - name: teslasync-web
          port: 80

    - kind: Rule
      match: "Host(`teslasync.example.com`)"
      priority: 10
      middlewares:
        - name: authentik-auth
          namespace: authentik
        - name: default-headers
          namespace: traefik
      services:
        - name: teslasync-web
          port: 80
  tls:
    enabled: true
    secretName: teslasync-tls
```

The `priority` matters. The well-known route must be evaluated first so it doesn't fall through to the auth route.

You do **not** need a public `PathPrefix('/api')` route directly to `teslasync-api` — web/Nginx handles `/api` internally.

### Standard Ingress (nginx-ingress, others)

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: teslasync.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: teslasync-tls
      hosts:
        - teslasync.example.com
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "https://authentik.example.com/outpost.goauthentik.io/auth/nginx"
    nginx.ingress.kubernetes.io/auth-snippet: |
      proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
```

Verify the well-known path is reachable without going through the auth challenge — most providers' nginx-ingress snippets let you exempt specific paths.

## Auth — ForwardAuth

The chart doesn't deploy your auth proxy; it integrates with the one you operate. The two pieces that matter:

1. The reverse proxy / ingress middleware authenticates the user and injects a header (`X-Authentik-Username`, `Remote-User`, etc.)
2. TeslaSync reads `FORWARD_AUTH_HEADER` from its config and uses that header to resolve / create the User record

A correctly-configured chain produces requests where the API sees the authenticated user from the start of every request, without needing to validate session cookies or tokens itself.

If you want to delay rolling out auth, you can run with a fixed header in dev (`X-Forwarded-User: admin`) — but never expose such a deployment to the internet.

## Helix AI configuration

Helix is off-by-default per feature, so the chart can install with no AI configuration and Helix is simply invisible. To enable the infrastructure, inject provider credentials via secrets and set the env vars on the API + workers:

```yaml
secrets:
  openai:
    apiKey: <secretRef>
  anthropic:
    apiKey: <secretRef>
  azureOpenAI:
    endpoint: <secretRef>
    apiKey: <secretRef>
    deployment: <secretRef>

config:
  ai:
    provider: "ollama"           # or openai / azure / anthropic
    dailyBudgetUsd: 5
    rateLimitPerMin: 60
    redactionEnabled: true
```

Don't put cloud API keys in `values.yaml` directly — reference cluster Secrets. Most teams maintain a separate `secrets.yaml` (encrypted with sops, sealed-secrets, or your secrets management tool of choice) and pass both files to Helm.

Full Helix env reference: [Configuration → Helix AI settings](/guide/configuration#helix-ai-settings).

## Storage

PostgreSQL with TimescaleDB and pgvector is non-negotiable — the platform's first migration installs both extensions. The chart's embedded postgres uses the `timescale/timescaledb-ha:pg17` image which has them preinstalled. If you point at an external Postgres, ensure both extensions are available:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
```

For production-grade Postgres, run the database with persistent volumes backed by your fastest available storage class. Telemetry writes are bursty; a slow disk turns into back-pressure that propagates to the ingest worker.

## Homelab node reboot recovery

The default Helm values target the self-hosted `carbon` node and preserve
PostgreSQL, Redis, Mosquitto, Grafana, and optional MongoDB/Tempo state on
PVCs. Recovery probes tolerate storage replay, and MQTT-dependent workloads
wait for the broker instead of entering a delayed CrashLoop. API workloads
also wait for Redis so live-state hydration and cross-pod fanout are available
from the first request after a reboot.

This is same-node reboot protection, not permanent node or disk-loss high
availability. Follow
[the Kubernetes node reboot runbook](../runbooks/kubernetes-node-reboot.md)
before planned maintenance and after an unexpected restart.

## Scaling

Three things scale independently:

| Layer       | How to scale                                                                   | Notes                                                                |
| ----------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| API         | `replicaCount` or HPA on CPU                                                    | Fleet Telemetry requires one API owner until vehicle leases exist    |
| Workers     | One replica per notification, export, and automation worker                    | Stable MQTT client IDs and in-memory state are single-owner           |
| Web         | `web.replicas` or HPA                                                          | Web is stateless; scale freely                                        |
| Postgres    | Vertical (more CPU / RAM / faster disk) — Timescale handles single-instance well | Read replicas possible but not required for typical fleet sizes  |
| Redis       | Vertical for typical loads; cluster mode if you have unusual scale              | Pub/Sub is the bottleneck on extreme fanout                          |

For multi-replica API without Fleet Telemetry ingestion, the L2 Redis cache
and Pub/Sub fanout keep request-serving replicas coherent. Fleet Telemetry
ingestion remains single-owner until vehicle ownership or leases exist.

## Verify after install

```bash
kubectl get pods -n teslasync
kubectl rollout status deployment/teslasync-api -n teslasync
kubectl rollout status deployment/teslasync-web -n teslasync
kubectl logs deployment/teslasync-api -n teslasync | grep -i migration
kubectl exec deployment/teslasync-api -n teslasync -- wget -qO- localhost:8080/healthz
kubectl exec deployment/teslasync-api -n teslasync -- wget -qO- localhost:8080/readyz
```

A healthy install logs `migrations applied`, `listening on :8080`, and `/healthz` + `/readyz` both return 200.

## Upgrading

```bash
helm upgrade teslasync helm/teslasync -n teslasync -f values.yaml
kubectl rollout status deployment/teslasync-api -n teslasync
```

The platform never drops data on upgrade unless a release notes call out a destructive migration. Migrations run automatically on the next API pod startup; rolling restart picks up the new version.

For zero-downtime rolling upgrades:

- Run with `replicas: 2+` for the API
- Pod Disruption Budget set to require at least 1 available
- Migrations should be backward-compatible within a single release (the platform follows this rule); if a release breaks the contract it'll be flagged

## Production checklist

Before pointing real users at the deployment:

- [ ] HTTPS enabled at the ingress with valid certificates
- [ ] `/.well-known` route exempt from auth and reachable publicly
- [ ] All app routes behind forward-auth
- [ ] `forwardAuthHeader` matches the proxy
- [ ] API and web Services are `ClusterIP`
- [ ] `browserApiBase: ""` for same-origin; otherwise CORS configured
- [ ] `ENCRYPTION_KEY` set in a cluster Secret (never plaintext in values.yaml)
- [ ] Tesla OAuth credentials in cluster Secrets
- [ ] Backups configured and at least one restore drill rehearsed
- [ ] Metrics scraped by an internal Prometheus; not exposed publicly without auth
- [ ] If Helix AI is enabled with a cloud provider, `AI_DAILY_BUDGET_USD` set to a sane value
- [ ] If you have signed-command vehicles, `commandProxy.enabled: true` (or `commandProxy.external.url`)
- [ ] Resource requests + limits set on API and worker pods
- [ ] Pod Disruption Budgets in place for any deployment running ≥2 replicas
- [ ] `nodeRecovery.enforcePersistentState: true` and every bundled PVC is `Bound`
- [ ] Same-node reboot procedure tested; an off-node backup covers disk/node loss
- [ ] NetworkPolicies restricting east-west traffic to what's needed

## When something goes wrong

The [Troubleshooting](/guide/troubleshooting) playbook applies — the failure modes are the same; only the commands differ:

```bash
kubectl logs deployment/teslasync-api -n teslasync --tail=200 | grep -i error
kubectl describe pod <pod-name> -n teslasync
kubectl exec -it deployment/teslasync-api -n teslasync -- /bin/sh
```

The X-Request-Id header from a failed request is the most useful breadcrumb — every log line for that request will carry it.

## Related

- [Docker Compose](/deployment/docker) — the simpler deployment when one host is enough
- [Configuration](/guide/configuration) — every env var, every default
- [Architecture](/guide/architecture) — the runtime view of how requests flow
- [Helix AI](/guide/helix-ai) — the off-by-default AI layer
- [Backup & Restore](/features/backup-restore) — recovery procedures
- [Kubernetes node reboot](../runbooks/kubernetes-node-reboot.md) — homelab reboot procedure and limits
- [Troubleshooting](/guide/troubleshooting) — the symptom-driven playbook
