{{/*
Expand the name of the chart.
*/}}
{{- define "teslasync.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars to comply with DNS naming spec.
*/}}
{{- define "teslasync.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "teslasync.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "teslasync.labels" -}}
helm.sh/chart: {{ include "teslasync.chart" . }}
{{ include "teslasync.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | trunc 63 | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (stable subset used in matchLabels / service selectors).
*/}}
{{- define "teslasync.selectorLabels" -}}
app.kubernetes.io/name: {{ include "teslasync.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* ── Service account name ─────────────────────────────────────────────── */}}

{{- define "teslasync.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "teslasync.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* ── Secret name helper ─────────────────────────────────────────────── */}}
{{/*
Name of the K8s Secret that holds sensitive env vars.
When secrets.existingSecret is set, the chart skips secret creation
and references the user-supplied secret name. With the safe defaults, the
chart references the release fullname and expects that Secret to be
provisioned outside an offline/GitOps render.
*/}}
{{- define "teslasync.secretName" -}}
{{- if .Values.externalSecrets.enabled }}
{{- .Values.externalSecrets.target.name | default (include "teslasync.fullname" .) }}
{{- else if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "teslasync.fullname" . }}
{{- end }}
{{- end }}

{{/*
Validate mutually exclusive secret modes and refuse known weak credentials.
Offline/GitOps-safe mode references an existing Secret and never generates
random values during rendering.
*/}}
{{- define "teslasync.validateSecretConfiguration" -}}
{{- $existing := .Values.secrets.existingSecret | default "" -}}
{{- $external := .Values.externalSecrets.enabled -}}
{{- $managed := .Values.secrets.create | default false -}}
{{- if and $existing $external -}}
{{- fail "secrets.existingSecret and externalSecrets.enabled are mutually exclusive" -}}
{{- end -}}
{{- if and $managed (or $existing $external) -}}
{{- fail "secrets.create cannot be combined with secrets.existingSecret or externalSecrets.enabled" -}}
{{- end -}}
{{- if $external -}}
  {{- if not .Values.externalSecrets.secretStoreRef.name -}}
  {{- fail "externalSecrets.secretStoreRef.name is required when externalSecrets.enabled=true" -}}
  {{- end -}}
  {{- if not (has .Values.externalSecrets.secretStoreRef.kind (list "SecretStore" "ClusterSecretStore")) -}}
  {{- fail "externalSecrets.secretStoreRef.kind must be SecretStore or ClusterSecretStore" -}}
  {{- end -}}
  {{- if and (eq (len .Values.externalSecrets.data) 0) (eq (len .Values.externalSecrets.dataFrom) 0) -}}
  {{- fail "externalSecrets.data or externalSecrets.dataFrom is required when externalSecrets.enabled=true" -}}
  {{- end -}}
{{- end -}}

{{- $weak := list "teslasync" "changeme" "password" "postgres" "admin" -}}{{- if $managed -}}
  {{- $databasePassword := ternary (.Values.postgresql.auth.password | default "") (.Values.postgresql.external.password | default "") .Values.postgresql.enabled -}}
  {{- if not $databasePassword -}}
  {{- fail "an explicit PostgreSQL password is required when secrets.create=true; use an existing or external Secret for GitOps" -}}
  {{- end -}}
  {{- if and $databasePassword (or (has (lower $databasePassword) $weak) (eq (lower $databasePassword) (lower (include "teslasync.postgresql.username" .)))) -}}
  {{- fail "refusing known weak PostgreSQL password; provide a strong value or use externalSecrets/secrets.existingSecret" -}}
  {{- end -}}
  {{- $grafanaPassword := .Values.grafana.adminPassword | default "" -}}
  {{- if and .Values.grafana.enabled (not $grafanaPassword) -}}
  {{- fail "grafana.adminPassword is required when Grafana is enabled with secrets.create=true" -}}
  {{- end -}}
  {{- if and .Values.grafana.enabled $grafanaPassword (or (has (lower $grafanaPassword) $weak) (eq (lower $grafanaPassword) (lower (.Values.grafana.adminUser | default "admin")))) -}}
  {{- fail "refusing known weak Grafana admin password; provide a strong value or use an existing or external Secret" -}}
  {{- end -}}
{{- end -}}
{{- end }}

{{/* ── Migration hook secret gate ──────────────────────────────────────── */}}
{{/*
The database migration Job runs as a `pre-install,pre-upgrade` Helm hook,
and it takes DATABASE_PASS from the runtime Secret via `envFrom`.

Helm applies hooks BEFORE the release's ordinary manifests, so any Secret
source that the chart renders as an ordinary manifest does not exist yet
when the hook Job is scheduled:

  * externalSecrets mode — the ExternalSecret is applied after the hook,
    so on a fresh install ESO has not even been told to fetch anything,
    let alone finished reconciling. The Job's pod sits in
    CreateContainerConfigError until the hook times out, with no message
    that points at the real cause.
  * secrets.create mode — the chart-managed Secret has the same ordering
    problem for exactly the same reason.
  * secrets.existingSecret mode — the Secret is provisioned out of band by
    definition, so there is nothing to order.

Hook weights alone cannot fix this: weights only order resources that are
themselves hooks, and even once an ExternalSecret exists, ESO still has to
reconcile it before the target Secret has any data. The contract therefore
has two halves — make the source exist before the hook, and then actually
wait for the data to appear.

Modes, and the single question that decides which one is valid: DOES THIS
CHART RENDER THE SECRET SOURCE?

  hook     The chart renders the source (externalSecrets.enabled or
           secrets.create). It is emitted as a pre-install/pre-upgrade
           hook at weight -10 — ahead of the migration Job at weight 0 —
           and the Job waits for the required keys.
           REQUIRES a chart-rendered source.
  require  The chart does NOT render the source; the Secret is genuinely
           provisioned outside this release (secrets.existingSecret, or
           an ExternalSecret applied by a GitOps controller). The Job
           still waits, and that wait is the enforcement.
           REQUIRES that no source is chart-rendered — combining it with
           externalSecrets.enabled or secrets.create guarantees a
           fresh-install timeout, because the ordinary manifest cannot be
           applied until after the pre-install hooks have finished.
  none     No ordering, no wait. NOT a general escape hatch: it does not
           make the race safe, it only stops the chart from managing it,
           and for a chart-rendered source it is a KNOWN-BROKEN fresh
           install. It exists for one case — a release whose Secret is
           already present and stable, where you are deliberately
           deferring the conversion. Once a release has been in `hook`
           mode, moving it to `none` or `require` is a manifest-membership
           transition, not a values change: see
           docs/runbooks/migration-gate-lifecycle.md, Procedure 3.
  auto     hook when the chart renders the source, none otherwise. Default.

LIFECYCLE WARNING. Helm tracks hook resources and ordinary manifests
separately, and there is no supported in-place transition between them.
Converting a source into a hook, rolling back across that boundary, or
leaving hook mode all require an explicit operator procedure — they are
NOT safe as a bare `helm upgrade` / `helm rollback`. The procedures live
in docs/runbooks/migration-gate-lifecycle.md and are registered in
ops/runbooks/dependencies.yaml so they cannot quietly drift.
*/}}

{{/*
Non-empty when THIS CHART renders the runtime Secret's source. The whole
mode contract turns on this one fact.
*/}}
{{- define "teslasync.migrationGate.rendersSource" -}}
{{- if or .Values.externalSecrets.enabled .Values.secrets.create -}}
{{- "true" -}}
{{- end -}}
{{- end }}

{{- define "teslasync.migrationGate.mode" -}}
{{- $gate := .Values.migrationGate | default dict -}}
{{- $mode := $gate.mode | default "auto" -}}
{{- if eq $mode "auto" -}}
  {{- if include "teslasync.migrationGate.rendersSource" . -}}
  {{- "hook" -}}
  {{- else -}}
  {{- "none" -}}
  {{- end -}}
{{- else -}}
{{- $mode -}}
{{- end -}}
{{- end }}

{{/*
Non-empty when the migration Job must wait for the runtime Secret.
*/}}
{{- define "teslasync.migrationGate.waits" -}}
{{- if ne (include "teslasync.migrationGate.mode" .) "none" -}}
{{- "true" -}}
{{- end -}}
{{- end }}

{{/*
Non-empty when the secret source itself must be rendered as a pre-hook.
*/}}
{{- define "teslasync.migrationGate.hookSource" -}}
{{- if eq (include "teslasync.migrationGate.mode" .) "hook" -}}
{{- "true" -}}
{{- end -}}
{{- end }}

{{/*
Hook annotations for the secret source.

Weight -10 places it strictly before the migration Job (weight 0).

`before-hook-creation` is not optional: Helm CREATES hook resources rather
than patching them (`KubeClient.Create`), so a second upgrade would fail
with "already exists" without it.

`helm.sh/resource-policy: keep` is emitted by the templates themselves
rather than here, because the Secret needs it in every mode while the
ExternalSecret needs it only in hook mode. Repeating it in this helper
would render a duplicate YAML key.
*/}}
{{- define "teslasync.migrationGate.hookAnnotations" -}}
"helm.sh/hook": pre-install,pre-upgrade
"helm.sh/hook-weight": "-10"
"helm.sh/hook-delete-policy": before-hook-creation
{{- end }}

{{/*
Effective ExternalSecret target creationPolicy: always Orphan, in every
migrationGate mode, whenever this chart renders an ExternalSecret.

`Owner` is not merely wrong in hook mode — it is a TIME BOMB in every
mode. ESO sets `.metadata.ownerReferences` on the target Secret at
creation time. A release installed today in `none` or `require` mode
therefore stamps an ownerReference onto the target; the day that release
later moves to hook mode, `before-hook-creation` deletes the
ExternalSecret and Kubernetes garbage-collects the Secret through that
pre-existing reference. Rendering Orphan only "when it matters" leaves
the hazard latent in exactly the states that precede the conversion.

`deletionPolicy: Retain` does NOT protect against this. Per the ESO API
reference, deletionPolicy "specifies what happens to the Secret when data
fields are deleted from the provider"; it says nothing about deletion of
the ExternalSecret object itself.

IMPORTANT, and not something this template can fix: rendering `Orphan`
governs FUTURE states only. It does not retroactively strip an
ownerReference that a previous `Owner`-managed reconcile already wrote
onto a live Secret, and ESO does not remove ownerReferences it has
already set. A release that ran with `Owner` before this change must go
through the one-time preflight in
docs/runbooks/migration-gate-lifecycle.md before its first conversion.

The value is kept configurable only so an operator who has pinned it
explicitly gets a loud failure instead of a silent override.
*/}}
{{- define "teslasync.externalSecrets.creationPolicy" -}}
{{- $explicit := .Values.externalSecrets.target.creationPolicy | default "" -}}
{{- if and $explicit (ne $explicit "Orphan") -}}
{{- fail (printf "externalSecrets.target.creationPolicy=%q is not supported; this chart renders Orphan in every migrationGate mode. Any owning policy makes ESO stamp .metadata.ownerReferences onto the target Secret, and the day this release enters hook mode the before-hook-creation delete of the ExternalSecret garbage-collects those credentials out from under every running pod. deletionPolicy: Retain does not prevent it — it only governs provider-side data deletion. Leave the value empty, or set it to Orphan." $explicit) -}}
{{- end -}}
{{- "Orphan" -}}
{{- end }}

{{/*
Validate the gate.

Note what this does NOT do: it does not `lookup` the Secret in the cluster.
`internal/ops` forbids cluster lookups in this file, for good reasons that
apply here too — a lookup makes the render depend on cluster state and on
the Helm client holding RBAC to read Secrets, which many GitOps service
accounts deliberately do not have.

`require` mode is therefore enforced where it can be enforced honestly: at
the hook boundary, by the `wait-for-runtime-secret` initContainer, which
fails the migration Job (and so the release) within
`migrationGate.timeoutSeconds` and names the Secret, the missing keys, and
the command that shows why ESO has not synced.
*/}}
{{- define "teslasync.validateMigrationGate" -}}
{{- $gate := .Values.migrationGate | default dict -}}
{{- $declared := $gate.mode | default "auto" -}}
{{- if not (has $declared (list "auto" "hook" "require" "none")) -}}
{{- fail (printf "migrationGate.mode must be auto, hook, require, or none (got %q)" $declared) -}}
{{- end -}}
{{- $timeout := $gate.timeoutSeconds | default 300 | int -}}
{{- $poll := $gate.pollIntervalSeconds | default 5 | int -}}
{{- if le $timeout 0 -}}
{{- fail "migrationGate.timeoutSeconds must be greater than 0" -}}
{{- end -}}
{{- if le $poll 0 -}}
{{- fail "migrationGate.pollIntervalSeconds must be greater than 0" -}}
{{- end -}}
{{- if ge $poll $timeout -}}
{{- fail (printf "migrationGate.pollIntervalSeconds (%d) must be smaller than timeoutSeconds (%d), otherwise the gate never polls" $poll $timeout) -}}
{{- end -}}
{{- if eq (len ($gate.requiredKeys | default list)) 0 -}}
{{- fail "migrationGate.requiredKeys must name at least one key the migration needs (DATABASE_PASS)" -}}
{{- end -}}

{{- $rendersSource := include "teslasync.migrationGate.rendersSource" . -}}

{{/*
hook can only order what this chart renders. Asking it to order an
out-of-band Secret produces a contract the chart cannot honour.
*/}}
{{- if eq $declared "hook" -}}
  {{- if .Values.secrets.existingSecret -}}
  {{- fail "migrationGate.mode=hook cannot manage secrets.existingSecret: the Secret is provisioned outside this chart, so there is nothing for the chart to order ahead of the migration hook. Use require — the migration Job then waits for it and fails with a diagnostic — or none." -}}
  {{- end -}}
  {{- if not $rendersSource -}}
  {{- fail "migrationGate.mode=hook requires a chart-rendered secret source (externalSecrets.enabled=true or secrets.create=true). With a pre-provisioned Secret there is nothing for the chart to render as a hook. Use require, which waits for the Secret and fails with a diagnostic if it never appears." -}}
  {{- end -}}
{{- end -}}

{{/*
require is the mirror image, and getting it wrong is worse than a
mis-configuration — it is a GUARANTEED fresh-install failure. An ordinary
manifest cannot be applied until every pre-install hook has completed, so
the migration Job would wait the full timeout for a Secret whose source
Helm is holding back until the Job finishes.
*/}}
{{- if and (eq $declared "require") $rendersSource -}}
{{- fail (printf "migrationGate.mode=require is incompatible with a chart-rendered secret source (externalSecrets.enabled=%v, secrets.create=%v). require means the Secret is provisioned OUTSIDE this release; here the chart renders the source as an ordinary manifest, which Helm cannot apply until after the pre-install hooks finish — so the migration Job would time out on every fresh install by construction. Use hook to have the chart order the source ahead of the migration, or move the source out of this release." .Values.externalSecrets.enabled .Values.secrets.create) -}}
{{- end -}}
{{- end }}

{{/* ── imagePullSecrets helper ─────────────────────────────────────────── */}}
{{- define "teslasync.imagePullSecrets" -}}
{{- $secrets := concat (.Values.global.imagePullSecrets | default list) (.Values.imagePullSecrets | default list) }}
{{- if $secrets }}
imagePullSecrets:
{{- range $secrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/* ── Image tag helpers ───────────────────────────────────────────────── */}}

{{- define "teslasync.backend.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repo := .Values.image.repository }}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}

{{- define "teslasync.web.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repo := .Values.web.image.repository }}
{{- $tag := .Values.web.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}

{{- define "teslasync.notificationWorker.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repo := .Values.notificationWorker.image.repository }}
{{- $tag := .Values.notificationWorker.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}

{{- define "teslasync.exportWorker.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repo := .Values.exportWorker.image.repository }}
{{- $tag := .Values.exportWorker.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}

{{- define "teslasync.automationWorker.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repo := .Values.automationWorker.image.repository }}
{{- $tag := .Values.automationWorker.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}

{{/* ── PostgreSQL connection helpers ──────────────────────────────────── */}}

{{- define "teslasync.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.postgresql.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.postgresql.port" -}}
{{- if .Values.postgresql.enabled }}
{{- toString .Values.postgresql.service.port }}
{{- else }}
{{- toString .Values.postgresql.external.port }}
{{- end }}
{{- end }}

{{- define "teslasync.postgresql.database" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.postgresql.external.database }}
{{- end }}
{{- end }}

{{- define "teslasync.postgresql.username" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.username }}
{{- else }}
{{- .Values.postgresql.external.username }}
{{- end }}
{{- end }}

{{- define "teslasync.postgresql.password" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.password | default "" }}
{{- else }}
{{- .Values.postgresql.external.password | default "" }}
{{- end }}
{{- end }}

{{- define "teslasync.postgresql.sslMode" -}}
{{- if .Values.postgresql.enabled }}
{{- "disable" }}
{{- else }}
{{- .Values.postgresql.external.sslMode | default "disable" }}
{{- end }}
{{- end }}

{{/*
Bounded TCP dependency wait used by workloads that cannot do useful work
without a service. The init container exits after the configured attempt
budget so Kubernetes records a visible failure and retries it with backoff
instead of leaving an opaque infinite shell loop.

Usage:
  include "teslasync.dependencyWaitInitContainer" (dict
    "root" . "name" "database" "host" "db" "port" "5432")
*/}}
{{- define "teslasync.dependencyWaitInitContainer" -}}
- name: wait-for-{{ .name }}
  image: {{ .root.Values.nodeRecovery.dependencyWait.image | quote }}
  imagePullPolicy: IfNotPresent
  securityContext:
    {{- toYaml .root.Values.initSecurityContext | nindent 4 }}
  command:
    - sh
    - -ec
  args:
    - |
      attempt=1
      until nc -z -w 2 {{ .host | quote }} {{ .port | quote }}; do
        if [ "$attempt" -ge {{ .root.Values.nodeRecovery.dependencyWait.maxAttempts }} ]; then
          echo "{{ .name }} dependency {{ .host }}:{{ .port }} unavailable after $attempt attempts" >&2
          exit 1
        fi
        echo "waiting for {{ .name }} dependency {{ .host }}:{{ .port }} (attempt $attempt)"
        attempt=$((attempt + 1))
        sleep {{ .root.Values.nodeRecovery.dependencyWait.intervalSeconds }}
      done
{{- end }}

{{/* ── Redis connection helpers ────────────────────────────────────────── */}}

{{- define "teslasync.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.redis.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.redis.port" -}}
{{- if .Values.redis.enabled }}
{{- toString .Values.redis.service.port }}
{{- else }}
{{- toString .Values.redis.external.port }}
{{- end }}
{{- end }}

{{/* ── MQTT connection helpers ─────────────────────────────────────────── */}}

{{- define "teslasync.mqtt.host" -}}
{{- if .Values.mqtt.enabled }}
{{- printf "%s-mosquitto" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.mqtt.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.mqtt.port" -}}
{{- if .Values.mqtt.enabled }}
{{- toString .Values.mqtt.service.port }}
{{- else }}
{{- toString .Values.mqtt.external.port }}
{{- end }}
{{- end }}

{{/* ── Grafana connection helpers ──────────────────────────────────────── */}}

{{- define "teslasync.grafana.host" -}}
{{- if .Values.grafana.enabled }}
{{- printf "%s-grafana" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.grafana.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.grafana.port" -}}
{{- if .Values.grafana.enabled }}
{{- toString .Values.grafana.service.port }}
{{- else }}
{{- toString .Values.grafana.external.port }}
{{- end }}
{{- end }}

{{/* ── Fleet Telemetry connection helpers ──────────────────────────────── */}}

{{- define "teslasync.fleetTelemetry.host" -}}
{{- if .Values.fleetTelemetry.enabled }}
{{- .Values.fleetTelemetry.host | default "" }}
{{- else }}
{{- .Values.fleetTelemetry.external.host | default "" }}
{{- end }}
{{- end }}

{{- define "teslasync.fleetTelemetry.port" -}}
{{- if .Values.fleetTelemetry.enabled }}
{{- toString (.Values.fleetTelemetry.service.port | default 4443) }}
{{- else }}
{{- toString (.Values.fleetTelemetry.external.port | default 4443) }}
{{- end }}
{{- end }}

{{/* ── Notification Worker connection helpers ──────────────────────────── */}}

{{- define "teslasync.notificationWorker.host" -}}
{{- if .Values.notificationWorker.enabled }}
{{- printf "%s-notification-worker" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.notificationWorker.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.notificationWorker.port" -}}
{{- if .Values.notificationWorker.enabled }}
{{- toString (.Values.notificationWorker.service.port | default 8081) }}
{{- else }}
{{- toString (.Values.notificationWorker.external.port | default 8081) }}
{{- end }}
{{- end }}

{{/* ── Export Worker connection helpers ─────────────────────────────────── */}}

{{- define "teslasync.exportWorker.host" -}}
{{- if .Values.exportWorker.enabled }}
{{- printf "%s-export-worker" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.exportWorker.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.exportWorker.port" -}}
{{- if .Values.exportWorker.enabled }}
{{- toString (.Values.exportWorker.service.port | default 8082) }}
{{- else }}
{{- toString (.Values.exportWorker.external.port | default 8082) }}
{{- end }}
{{- end }}

{{/* ── Vehicle Command Proxy connection helpers ────────────────────────── */}}

{{/* ── Automation Worker connection helpers ─────────────────────────────── */}}

{{- define "teslasync.automationWorker.host" -}}
{{- if .Values.automationWorker.enabled }}
{{- printf "%s-automation-worker" (include "teslasync.fullname" .) }}
{{- else }}
{{- .Values.automationWorker.external.host }}
{{- end }}
{{- end }}

{{- define "teslasync.automationWorker.port" -}}
{{- if .Values.automationWorker.enabled }}
{{- toString (.Values.automationWorker.service.port | default 8083) }}
{{- else }}
{{- toString (.Values.automationWorker.external.port | default 8083) }}
{{- end }}
{{- end }}

{{- define "teslasync.commandProxy.url" -}}
{{- if .Values.commandProxy.enabled }}
{{- printf "https://%s-command-proxy:%v" (include "teslasync.fullname" .) (int (.Values.commandProxy.service.port | default 4443)) }}
{{- else if .Values.commandProxy.external.url }}
{{- .Values.commandProxy.external.url }}
{{- end }}
{{- end }}

{{/*
MongoDB host — bundled service name (only used when mongodb.enabled=true).
*/}}
{{- define "teslasync.mongodb.host" -}}
{{- printf "%s-mongodb" (include "teslasync.fullname" .) }}
{{- end }}

{{- define "teslasync.mongodb.port" -}}
{{- toString (.Values.mongodb.service.port | default 27017) }}
{{- end }}

{{/* ── OPS-05: stable/canary selector disjointness ──────────────────────

`spec.selector` on a Deployment is a SUPERSET match: a pod that carries
every label in the selector is adopted, even if it carries extra ones.
So a canary pod labelled with the common selector labels plus
`teslasync.io/rollout: canary` is still matched by the stable
Deployment's selector — and therefore by the stable HPA (which reads
metrics through that selector) and the stable PDB.

`teslasync.selectorMode` returns the configured mode. In `disjoint`
mode the stable workloads add `teslasync.io/rollout: stable` to their
selectors, making the two sets provably non-overlapping. The Service
selector deliberately does NOT include the rollout label, so it keeps
fronting both and traffic still splits by replica share.

Deployment selectors are immutable, so `legacy` remains the default and
canary is refused in that mode rather than silently overlapping.
*/}}
{{- define "teslasync.selectorMode" -}}
{{- default "legacy" .Values.rollout.selectorMode -}}
{{- end }}

{{/*
Guard: canary requires disjoint selectors. Rendering fails loudly rather
than producing manifests where the stable HPA scales on canary pods.
*/}}
{{- define "teslasync.assertCanarySelectors" -}}
{{- $mode := include "teslasync.selectorMode" . -}}
{{- $canary := or .Values.rollout.api.canary.enabled (and .Values.web.enabled .Values.rollout.web.canary.enabled) -}}
{{- if and $canary (ne $mode "disjoint") -}}
{{- fail "rollout.selectorMode must be \"disjoint\" before enabling any canary: with legacy selectors the stable Deployment/HPA/PDB would also match canary pods (superset selector match). Deployment selectors are immutable — see docs/runbooks/rollout-selector-migration.md for the one-time migration (the obvious --cascade=orphan procedure does NOT converge)." -}}
{{- end -}}
{{- if and (ne $mode "legacy") (ne $mode "disjoint") -}}
{{- fail (printf "rollout.selectorMode must be \"legacy\" or \"disjoint\", got %q" $mode) -}}
{{- end -}}
{{- end }}

{{/*
Fleet Telemetry ingestion has one persistent MQTT client ID and one in-process
FSM owner. Until owner election exists, more than one API pod causes
duplicate-client-ID eviction and split-brain session state.
*/}}
{{- define "teslasync.assertFleetTelemetrySingleOwner" -}}
{{- $ftHost := include "teslasync.fleetTelemetry.host" . -}}
{{- $enabled := or .Values.fleetTelemetry.enabled $ftHost -}}
{{- if $enabled -}}
  {{- if ne (int .Values.replicaCount) 1 -}}
  {{- fail "Fleet Telemetry requires replicaCount=1: API replicas share one persistent MQTT client ID and telemetry/FSM ownership is not active-active" -}}
  {{- end -}}
  {{- if .Values.autoscaling.enabled -}}
  {{- fail "Fleet Telemetry requires autoscaling.enabled=false: an HPA can create duplicate persistent MQTT consumers before owner election exists" -}}
  {{- end -}}
  {{- if .Values.rollout.api.canary.enabled -}}
  {{- fail "Fleet Telemetry cannot use rollout.api.canary.enabled=true: stable and canary API pods would evict each other's persistent MQTT client" -}}
  {{- end -}}
{{- end -}}
{{- end }}

{{/*
The three worker Deployments use stable MQTT client IDs and process
side-effecting messages. More than one replica would cause client eviction or
duplicate delivery, so fail before Kubernetes can create an unsafe topology.
*/}}
{{- define "teslasync.assertSingleOwnerWorkers" -}}
{{- if and .Values.notificationWorker.enabled (ne (int .Values.notificationWorker.replicaCount) 1) -}}
{{- fail "notificationWorker.replicaCount must be 1: the worker has one stable MQTT client ID and is not active-active" -}}
{{- end -}}
{{- if and .Values.notificationWorker.enabled (ne .Values.rollout.notificationWorker.strategy.type "Recreate") -}}
{{- fail "rollout.notificationWorker.strategy.type must be Recreate: the worker's stable MQTT client ID cannot have overlapping revision owners" -}}
{{- end -}}
{{- if and .Values.exportWorker.enabled (ne (int .Values.exportWorker.replicaCount) 1) -}}
{{- fail "exportWorker.replicaCount must be 1: the worker has one stable MQTT client ID and is not active-active" -}}
{{- end -}}
{{- if and .Values.exportWorker.enabled (ne .Values.rollout.exportWorker.strategy.type "Recreate") -}}
{{- fail "rollout.exportWorker.strategy.type must be Recreate: the worker's stable MQTT client ID cannot have overlapping revision owners" -}}
{{- end -}}
{{- if and .Values.automationWorker.enabled (ne (int .Values.automationWorker.replicaCount) 1) -}}
{{- fail "automationWorker.replicaCount must be 1: in-memory trigger state and the stable MQTT client ID are not active-active" -}}
{{- end -}}
{{- if and .Values.automationWorker.enabled (ne .Values.rollout.automationWorker.strategy.type "Recreate") -}}
{{- fail "rollout.automationWorker.strategy.type must be Recreate: the worker's stable MQTT client ID cannot have overlapping revision owners" -}}
{{- end -}}
{{- end }}

{{/*
Homelab node-reboot recovery relies on the same PVC being reattached when the
node returns. Refuse accidental emptyDir-backed state unless the operator
explicitly opts into a disposable development install.
*/}}
{{- define "teslasync.assertNodeRecoveryPersistence" -}}
{{- if empty .Values.nodeRecovery.dependencyWait.image -}}
{{- fail "nodeRecovery.dependencyWait.image must be set" -}}
{{- end -}}
{{- if lt (int .Values.nodeRecovery.dependencyWait.intervalSeconds) 1 -}}
{{- fail "nodeRecovery.dependencyWait.intervalSeconds must be at least 1" -}}
{{- end -}}
{{- if lt (int .Values.nodeRecovery.dependencyWait.maxAttempts) 1 -}}
{{- fail "nodeRecovery.dependencyWait.maxAttempts must be at least 1" -}}
{{- end -}}
{{- if lt (int .Values.nodeRecovery.startupProbe.periodSeconds) 1 -}}
{{- fail "nodeRecovery.startupProbe.periodSeconds must be at least 1" -}}
{{- end -}}
{{- if lt (int .Values.nodeRecovery.startupProbe.failureThreshold) 1 -}}
{{- fail "nodeRecovery.startupProbe.failureThreshold must be at least 1" -}}
{{- end -}}
{{- if .Values.nodeRecovery.enforcePersistentState -}}
  {{- if and .Values.postgresql.enabled (not .Values.postgresql.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires postgresql.persistence.enabled=true" -}}
  {{- end -}}
  {{- if and .Values.redis.enabled (not .Values.redis.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires redis.persistence.enabled=true" -}}
  {{- end -}}
  {{- if and .Values.mqtt.enabled (not .Values.mqtt.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires mqtt.persistence.enabled=true" -}}
  {{- end -}}
  {{- if and .Values.grafana.enabled (not .Values.grafana.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires grafana.persistence.enabled=true" -}}
  {{- end -}}
  {{- if and .Values.mongodb.enabled (not .Values.mongodb.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires mongodb.persistence.enabled=true" -}}
  {{- end -}}
  {{- if and .Values.observability.tempo.enabled (not .Values.observability.tempo.persistence.enabled) -}}
  {{- fail "nodeRecovery.enforcePersistentState=true requires observability.tempo.persistence.enabled=true" -}}
  {{- end -}}
{{- end -}}
{{- $ftHost := include "teslasync.fleetTelemetry.host" . -}}
{{- if and (or .Values.fleetTelemetry.enabled $ftHost) .Values.mqtt.enabled (not .Values.mqtt.persistence.enabled) -}}
{{- fail "Fleet Telemetry with bundled MQTT requires mqtt.persistence.enabled=true so the persistent consumer queue survives a broker restart" -}}
{{- end -}}
{{- end }}

{{/*
Stable-workload selector labels. Adds the rollout discriminator only in
disjoint mode, so legacy installs render byte-identical selectors and a
plain `helm upgrade` never hits the immutable-field error.
*/}}
{{- define "teslasync.stableSelectorLabels" -}}
{{ include "teslasync.selectorLabels" . }}
{{- if eq (include "teslasync.selectorMode" .) "disjoint" }}
teslasync.io/rollout: stable
{{- end }}
{{- end }}
