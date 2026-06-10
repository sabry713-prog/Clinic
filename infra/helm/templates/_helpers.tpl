{{/*
Expand the name of the chart.
*/}}
{{- define "clinical-copilot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "clinical-copilot.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "clinical-copilot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "clinical-copilot.labels" -}}
helm.sh/chart: {{ include "clinical-copilot.chart" . }}
app.kubernetes.io/name: {{ include "clinical-copilot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for a given component
*/}}
{{- define "clinical-copilot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "clinical-copilot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Image reference helper: registry/repository:tag
*/}}
{{- define "clinical-copilot.image" -}}
{{- $registry := .Values.global.imageRegistry -}}
{{- $repo := .repo -}}
{{- $tag := .Values.image.tag -}}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- end }}
