# Secret management

TeslaSync's Helm chart has three mutually exclusive secret modes. No mode
generates credentials during rendering, so repeated `helm template`, Argo CD,
and Flux reconciliations are deterministic.

## Chart-managed Secret

Chart-managed credentials are explicit opt-in for an interactive local
installation. Set `secrets.create=true` and provide strong PostgreSQL and,
when enabled, Grafana passwords. Blank values fail rendering; the chart never
falls back to `lookup` plus a newly generated value.

Known weak values such as `teslasync`, `changeme`, `password`, `postgres`, and
the configured username are rejected during template rendering.

```yaml
secrets:
  create: true
postgresql:
  auth:
    password: <strong-local-password>
grafana:
  adminPassword: <different-strong-local-password>
```

Do not put these values in a checked-in file or shell history. GitOps and
offline workflows must use an existing Secret or External Secrets Operator.

## Existing Kubernetes Secret

This is the default mode. With `secrets.create=false`,
`secrets.existingSecret=""`, and External Secrets disabled, every workload
references the release-scoped `<release>-teslasync` Secret without rendering
it. Provision that Secret before installation. Set `secrets.existingSecret`
for a differently named Secret managed by SOPS, Sealed Secrets, or another
GitOps process:

```yaml
secrets:
  existingSecret: teslasync-runtime
```

At minimum, the Secret needs `DATABASE_PASS`. Bundled Grafana also requires
`GRAFANA_ADMIN_PASSWORD`; Tesla Fleet API access requires `TESLA_CLIENT_ID` and
`TESLA_CLIENT_SECRET`. Add the integration keys documented in `values.yaml`
when those features are enabled.

## External Secrets Operator

Set `externalSecrets.enabled` to let
[External Secrets Operator](https://external-secrets.io/) materialize the
runtime Kubernetes Secret from Vault, AWS Secrets Manager, Azure Key Vault, or
Google Secret Manager. The chart creates an `ExternalSecret`; platform owners
create the `SecretStore` or `ClusterSecretStore` separately so cloud workload
identity and provider permissions remain outside the application release.

An extract-style remote object is the simplest setup:

```yaml
externalSecrets:
  enabled: true
  refreshInterval: 1h
  secretStoreRef:
    name: production-secrets
    kind: ClusterSecretStore
  target:
    name: teslasync-runtime
    creationPolicy: Owner
    deletionPolicy: Retain
  dataFrom:
    - extract:
        key: teslasync/production
```

The remote object must expose keys named like the environment variables:
`DATABASE_PASS`, `GRAFANA_ADMIN_PASSWORD`, `TESLA_CLIENT_ID`,
`TESLA_CLIENT_SECRET`, and any enabled optional integration keys.

For stores where secrets are separate objects, map them explicitly:

```yaml
externalSecrets:
  enabled: true
  secretStoreRef:
    name: production-secrets
    kind: ClusterSecretStore
  data:
    - secretKey: DATABASE_PASS
      remoteRef:
        key: teslasync/production/database-password
    - secretKey: TESLA_CLIENT_SECRET
      remoteRef:
        key: teslasync/production/tesla-client-secret
```

AWS Secrets Manager values remain protected by the KMS key configured on the
store. Vault, Azure Key Vault, and Google Secret Manager use their native
encryption and identity controls. Grant the External Secrets workload identity
read access only to the TeslaSync paths.

Environment variables are read when a pod starts. After rotating a remote
value, restart the affected TeslaSync workloads (or use a Secret-aware rollout
controller) after the ExternalSecret reports `Ready=True`.

## Verification

```bash
helm lint helm/teslasync --strict
helm template test helm/teslasync

# Repeated offline renders must be byte-identical and contain no Secret.
helm template test helm/teslasync > /tmp/render-1.yaml
helm template test helm/teslasync > /tmp/render-2.yaml
cmp /tmp/render-1.yaml /tmp/render-2.yaml
! grep -q '^kind: Secret$' /tmp/render-1.yaml

# Weak credentials must be refused.
helm template test helm/teslasync \
  --set secrets.create=true \
  --set-string postgresql.auth.password=teslasync
```
