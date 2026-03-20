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
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
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
