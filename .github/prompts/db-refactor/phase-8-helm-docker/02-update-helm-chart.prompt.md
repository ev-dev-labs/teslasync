---
description: "Phase 8 — Switch Helm chart postgres to timescale/timescaledb-ha:pg17 + init scripts"
---

# 🔵 Helm-Docker 02 — Helm Chart Cutover

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 2 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `helm/teslasync/values.yaml`, `helm/teslasync/templates/*postgres*.yaml`, `helm/teslasync/templates/configmap-*.yaml` |
| Depends on | `01-update-docker-compose` |
| Blocks | `03-validate-fresh-deploy` |
| ADR refs | ADR-007 |

## Single Goal

Mirror the docker-compose change in the Helm chart: image switch, PGDATA path, init-script ConfigMap mounted into postgres pod. Bump chart appVersion.

## What's Being Established

Production-bound chart must match local dev. The init script becomes a ConfigMap mounted as `/docker-entrypoint-initdb.d/00-init-timescaledb.sql`.

## Recommendation

### `helm/teslasync/values.yaml`

```yaml
postgresql:
  enabled: true
  image:
    repository: timescale/timescaledb-ha
    tag: pg17
    pullPolicy: IfNotPresent
  auth:
    username: teslasync
    password: changeme   # OVERRIDE in prod via --set or sealed-secret
    database: teslasync
  persistence:
    enabled: true
    size: 50Gi
    storageClass: ""     # default StorageClass
    pgdataPath: /home/postgres/pgdata/data
  initScripts:
    enabled: true
    # Mounted at /docker-entrypoint-initdb.d/, runs once on empty PGDATA
    extensions:
      - timescaledb
      - vector
      - pg_stat_statements
  resources:
    limits:
      memory: 4Gi
      cpu: 2000m
    requests:
      memory: 1Gi
      cpu: 500m
```

### `helm/teslasync/templates/configmap-postgres-init.yaml` (new)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "teslasync.fullname" . }}-postgres-init
  labels: {{- include "teslasync.labels" . | nindent 4 }}
data:
  00-init-timescaledb.sql: |
    {{- range .Values.postgresql.initScripts.extensions }}
    CREATE EXTENSION IF NOT EXISTS {{ . }};
    {{- end }}
    ALTER DATABASE {{ .Values.postgresql.auth.database }} SET timescaledb.telemetry_level = 'off';
```

### `helm/teslasync/templates/postgres-deployment.yaml` (or statefulset) — key diffs

```yaml
spec:
  template:
    spec:
      containers:
        - name: postgres
          image: "{{ .Values.postgresql.image.repository }}:{{ .Values.postgresql.image.tag }}"
          env:
            - name: PGDATA
              value: {{ .Values.postgresql.persistence.pgdataPath | quote }}
            # ... existing POSTGRES_USER/PASSWORD/DB env unchanged ...
          volumeMounts:
            - name: pgdata
              mountPath: /home/postgres/pgdata
            - name: init-scripts
              mountPath: /docker-entrypoint-initdb.d
              readOnly: true
      volumes:
        - name: pgdata
          persistentVolumeClaim:
            claimName: {{ include "teslasync.fullname" . }}-pgdata
        - name: init-scripts
          configMap:
            name: {{ include "teslasync.fullname" . }}-postgres-init
```

### `Chart.yaml`

```yaml
appVersion: "0.X.0"   # bump
version:    "0.X.0"   # bump
```

## Suggested Fix

1. Edit `values.yaml` postgres section
2. Create `templates/configmap-postgres-init.yaml`
3. Edit `templates/postgres-deployment.yaml` (image, PGDATA, init-scripts mount)
4. Bump `Chart.yaml` versions
5. Run `helm lint helm/teslasync` and `helm template helm/teslasync`
6. Commit

## Acceptance Criteria

- [ ] values.yaml has `postgresql.image.repository: timescale/timescaledb-ha` + `tag: pg17`
- [ ] values.yaml has `postgresql.persistence.pgdataPath: /home/postgres/pgdata/data`
- [ ] values.yaml has `postgresql.initScripts.extensions: [timescaledb, vector, pg_stat_statements]`
- [ ] `templates/configmap-postgres-init.yaml` exists and renders the 3 CREATE EXTENSION lines
- [ ] postgres-deployment template references both volumes (pgdata + init-scripts)
- [ ] `helm lint helm/teslasync` exits 0
- [ ] `helm template helm/teslasync` succeeds and contains the new image string
- [ ] `Chart.yaml` version + appVersion bumped
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync

helm lint helm/teslasync 2>&1 | Tee-Object -FilePath .github\prompts\db-refactor\logs\phase-8-02-helm-lint.log
# Expected: exit 0

helm template test helm/teslasync 2>&1 |
  Tee-Object -FilePath .github\prompts\db-refactor\logs\phase-8-02-helm-template.log

# Verify renders
Select-String -Path .github\prompts\db-refactor\logs\phase-8-02-helm-template.log -Pattern "timescale/timescaledb-ha:pg17"
# Expected: ≥ 1 hit

Select-String -Path .github\prompts\db-refactor\logs\phase-8-02-helm-template.log -Pattern "CREATE EXTENSION IF NOT EXISTS timescaledb"
# Expected: 1 hit
```

## Out of Scope

- Don't actually deploy (prompt 03 in fresh local; production is Phase 11)
- Don't refactor other Helm templates
- Don't change ingress/service/web/grafana templates

## Commit When Done

```powershell
cd D:\repos\teslasync
git add helm/teslasync/
git add -f .github/prompts/db-refactor/logs/phase-8-02-helm-*.log
git commit -m "infra(db-refactor): switch Helm chart postgres to timescale/timescaledb-ha:pg17

ADR-007: postgres image + PGDATA path + init-scripts ConfigMap to
match docker-compose. helm lint + template render verified.
Chart version bumped.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-007
- Phase 8 prompt 01 (docker-compose mirror)
