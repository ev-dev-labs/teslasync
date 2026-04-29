# Kubernetes Deployment

TeslaSync ships a Helm chart under `helm/teslasync` for Kubernetes deployments.

## Install from source

```bash
helm lint helm/teslasync
helm template teslasync helm/teslasync -f values.yaml
helm upgrade --install teslasync helm/teslasync -n teslasync --create-namespace -f values.yaml
```

## Core values

```yaml
image:
  repository: ghcr.io/ev-dev-labs/teslasync-api

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

## Recommended Traefik IngressRoute

Expose the web service. Let web/Nginx proxy `/api/` internally to `config.apiEndpoint`.

```yaml
ingressRoute:
  enabled: true
  entryPoints:
    - websecure
  routes:
    - kind: Rule
      match: "Host(`teslasync.example.com`) && PathPrefix(`/.well-known`)"
      middlewares:
        - name: default-headers
          namespace: traefik
      services:
        - name: teslasync-web
          port: 80

    - kind: Rule
      match: "Host(`teslasync.example.com`)"
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

You do not need a public `PathPrefix('/api')` route directly to `teslasync-api` when web/Nginx proxying is configured.

## ForwardAuth

Set the header your auth proxy injects:

```yaml
config:
  forwardAuthHeader: "X-Authentik-Username"
```

Common values:

| Provider | Header |
|---|---|
| Authentik | `X-Authentik-Username` |
| Authelia | `Remote-User` |
| oauth2-proxy | `X-Auth-Request-User` |
| Keycloak/proxy custom | `X-Forwarded-User` |

## Database and dependencies

The chart can deploy embedded dependencies or point at external services. Keep data services internal and use `ClusterIP` unless you intentionally expose them.

- PostgreSQL/TimescaleDB for main data
- Redis for live cache
- Mosquitto for MQTT
- MongoDB optional raw signal capture
- Grafana/Prometheus optional observability
- Jaeger optional tracing when `jaeger.enabled` and `config.openTelemetry.enabled` are enabled
- Vehicle Command Proxy optional signed-command support through `commandProxy.enabled` or `commandProxy.external.url`

## Validate

```bash
helm lint helm/teslasync
helm template teslasync helm/teslasync -f values.yaml
kubectl get pods -n teslasync
kubectl rollout status deployment/teslasync-api -n teslasync
kubectl rollout status deployment/teslasync-web -n teslasync
kubectl logs deployment/teslasync-api -n teslasync
```

## Production checklist

- HTTPS enabled
- `/.well-known` route public for Tesla key verification
- App and `/api` behind auth middleware
- API/web services are `ClusterIP`
- `browserApiBase` empty for same-origin deployments
- Backups configured and tested
- Metrics scraped internally, not anonymously exposed
