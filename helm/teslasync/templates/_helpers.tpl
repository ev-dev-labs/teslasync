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
and references the user-supplied secret name.
*/}}
{{- define "teslasync.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "teslasync.fullname" . }}
{{- end }}
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
