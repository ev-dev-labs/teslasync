/**
 * IncidentTimelinePage — modern-ui, full-width post-mortem cockpit at
 * /system-status/incidents/:id.
 *
 * Layout (mobile-first responsive bento — reflows to more columns as the
 * viewport widens, never a centered strip on wide monitors):
 *   1. KPI band — status · duration · updates · affected · source · started.
 *   2. Main bento — hero overview (severity, description, affected,
 *      timestamps, resolve control) beside a details key/value panel.
 *   3. AI summarizer band — opt-in Helix timeline summary (self-gated).
 *   4. Timeline + append-update bento — chronological updates beside the
 *      operator "add update" form (or a resolved-state placeholder).
 *
 * Resolving is the canonical close-out (never delete). Each data surface is
 * null-safe and owns its own loading / empty state. Heavy sections are
 * decomposed into ../components/incident.
 */

import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, AlertCircle, CheckCircle2, Clock, MessageSquare,
} from 'lucide-react'
import { PageLayout } from '@/components/layout'
import {
  GlassPanel, Button, Badge, ConfirmDialog, PanelTitle, Text, Label,
} from '@/components/ui'
import { KVList } from '@/components/data-display'
import { SystemSummaryBrief } from '../components/operationalbrief-all/SystemSummaryBrief'
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { useIncident, usePatchIncident } from '@/api/hooks/useIncidents'
import { useDateFormat } from '@/hooks/useDateFormat'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { AIIncidentTimelineSummarizer } from '@/components/ai'
import {
  IncidentTimelineList, IncidentUpdateForm, IncidentSeverityChip,
  STATUS_BADGE, fmtDuration, useIncidentStatusLabel,
} from '../components/incident'

export default function IncidentTimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const toast = useToast()
  const { formatDateTime: fmtAbs, formatRelative: fmtRel } = useDateFormat()
  const statusLabel = useIncidentStatusLabel()

  const numericId = useMemo(() => {
    const n = Number(id)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [id])

  const incidentQuery = useIncident(numericId)
  const { data: incident, isLoading, refetch } = incidentQuery
  const incidentState = useDataState(incidentQuery)
  const error = incidentState.fatalError
  const patch = usePatchIncident()

  const [confirmResolve, setConfirmResolve] = useState(false)

  usePageTitle(incident?.title ?? t('incidentTimeline.title', 'Incident'))

  const updates = useMemo(
    () => [...(incident?.updates ?? [])].reverse(),
    [incident?.updates],
  )

  const backAction = (
    <Button variant="ghost" size="sm" onClick={() => navigate('/system-status')} className="gap-1.5">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {t('incidentTimeline.back', 'Back')}
    </Button>
  )
  const isResolved = incident?.status === 'resolved'
  const affected = incident?.affected_components ?? []
  const durationLabel = incident ? fmtDuration(incident.started_at, incident.resolved_at) : ''
  const summary = (
    <SystemSummaryBrief
      title={t('incidentTimeline.kpis', 'Incident metrics')}
      description={t('incidentTimeline.brief.description', 'Incident status, elapsed duration, recorded updates, affected components, source, and start time.')}
      scope={incident ? `${fmtAbs(incident.started_at)} – ${incident.resolved_at ? fmtAbs(incident.resolved_at) : t('incidentTimeline.openFor', 'Open')}`
        : t('incidentTimeline.brief.unknownScope', 'Incident window unavailable until the source resolves.')}
      available={!!incident} loading={isLoading && !incident} retained={!!incident && incidentQuery.isError}
      statusLabel={incident ? statusLabel(incident.status) : undefined}
      freshness={incident ? fmtAbs(incident.updated_at) : undefined}
      metrics={[
        { metricId: 'duration', occurrenceId: 'duration', rawValue: incident
          ? (Date.parse(incident.resolved_at ?? new Date().toISOString()) - Date.parse(incident.started_at)) / 1000 : null,
          label: t('incidentTimeline.kpi.duration', 'Duration'), display: { formatter: () => ({ value: durationLabel || '—' }) } },
        { metricId: 'count', occurrenceId: 'updates', rawValue: incident ? updates.length : null, label: t('incidentTimeline.kpi.updates', 'Updates') },
        { metricId: 'count', occurrenceId: 'affected', rawValue: incident ? affected.length : null, label: t('incidentTimeline.kpi.affected', 'Affected') },
      ]}
      textMetrics={[
        { key: 'status', label: t('incidentTimeline.kpi.status', 'Status'), value: incident ? statusLabel(incident.status) : '—',
          valueState: incident ? 'value' : 'missing', detail: t('incidentTimeline.brief.statusContext', 'Recorded incident lifecycle state; resolution controls remain below.') },
        { key: 'source', label: t('incidentTimeline.kpi.source', 'Source'), value: incident?.source ?? '—',
          valueState: incident?.source ? 'value' : 'missing', detail: t('incidentTimeline.brief.sourceContext', 'Incident source as reported, without inference.') },
        { key: 'started', label: t('incidentTimeline.kpi.started', 'Started'), value: incident ? fmtRel(incident.started_at) : '—',
          valueState: incident ? 'value' : 'missing', detail: incident ? fmtAbs(incident.started_at) : '—' },
      ]}
    />
  )

  if (isLoading && !incident) {
    return (
      <PageLayout title={t('incidentTimeline.title', 'Incident')} subtitle={t('incidentTimeline.loading', 'Loading incident…')} secondaryActions={backAction}>
        {summary}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2"><Skeleton height={240} /></div>
          <Skeleton height={240} />
        </div>
      </PageLayout>
    )
  }

  if (error || !incident) {
    return (
      <PageLayout title={t('incidentTimeline.title', 'Incident')} subtitle={t('incidentTimeline.notFound', 'Not found')} secondaryActions={backAction}>
        {summary}
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            {error ? (
              <QueryError
                error={error}
                resourceName={t('incidentTimeline.resource', 'Incident')}
                listHref="/system-status"
                onRetry={() => refetch()}
              />
            ) : (
              <EmptyState
                icon={<AlertCircle className="h-8 w-8" aria-hidden="true" />}
                title={t('incidentTimeline.notFoundTitle', 'Incident not found')}
                message={t('incidentTimeline.notFoundBody', "It may have been deleted or you don't have access.")}
                actionTo={{ label: t('incidentTimeline.backToStatus', 'Back to system status'), to: '/system-status' }}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </PageLayout>
    )
  }


  const handleResolve = async () => {
    try {
      await patch.mutateAsync({ id: incident.id, payload: { resolved: true } })
      toast.success(t('incidentTimeline.resolvedToast', 'Incident resolved.'))
      setConfirmResolve(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('incidentTimeline.resolveFailed', 'Failed to resolve'))
    }
  }

  const detailItems = [
    { label: t('incidentTimeline.detail.status', 'Status'), value: <Badge variant={STATUS_BADGE[incident.status]}>{statusLabel(incident.status)}</Badge> },
    { label: t('incidentTimeline.detail.source', 'Source'), value: incident.source ?? '—' },
    { label: t('incidentTimeline.detail.started', 'Started'), value: fmtAbs(incident.started_at) },
    { label: t('incidentTimeline.detail.resolved', 'Resolved'), value: incident.resolved_at ? fmtAbs(incident.resolved_at) : '—' },
    { label: t('incidentTimeline.detail.duration', 'Duration'), value: durationLabel || '—' },
    { label: t('incidentTimeline.detail.updates', 'Updates'), value: updates.length },
    { label: t('incidentTimeline.detail.createdBy', 'Created by'), value: incident.created_by ?? '—' },
    { label: t('incidentTimeline.detail.updated', 'Last updated'), value: fmtAbs(incident.updated_at) },
  ]

  return (
    <PageLayout
      title={incident.title}
      subtitle={`${t('incidentTimeline.idPrefix', 'Incident')} #${incident.id}`}
      secondaryActions={backAction}
      query={incidentQuery}
    >
      <StaleRefreshWarning state={incidentState} />
      {/* 1 — KPI band */}
      <FadeIn>
        {summary}
      </FadeIn>

      {/* 2 — Hero overview + details bento */}
      <FadeIn delay={0.1}>
        <section aria-label={t('incidentTimeline.overview', 'Incident overview and details')} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <IncidentSeverityChip severity={incident.severity} />
                <Badge variant={STATUS_BADGE[incident.status]}>{statusLabel(incident.status)}</Badge>
                {isResolved ? (
                  <Badge variant="success">{t('incidentTimeline.resolvedFor', 'Resolved')} · {fmtDuration(incident.started_at, incident.resolved_at)}</Badge>
                ) : (
                  <Badge variant="neutral">{t('incidentTimeline.openFor', 'Open')} · {fmtDuration(incident.started_at)}</Badge>
                )}
              </div>
              {!isResolved && (
                <Button type="button" variant="primary" size="sm" onClick={() => setConfirmResolve(true)} disabled={patch.isPending} className="shrink-0 gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('incidentTimeline.resolve', 'Resolve')}
                </Button>
              )}
            </div>

            <div className="mt-4 space-y-4">
              {incident.description ? (
                <Text as="p" variant="body" className="whitespace-pre-wrap">{incident.description}</Text>
              ) : (
                <Text as="p" variant="caption">{t('incidentTimeline.noDescription', 'No description provided.')}</Text>
              )}

              <div className="space-y-1">
                <Label>{t('incidentTimeline.affected', 'Affected components')}</Label>
                {affected.length > 0 ? (
                  <Text as="p" variant="body">{affected.join(', ')}</Text>
                ) : (
                  <Text as="p" variant="caption">{t('incidentTimeline.noAffected', 'None recorded')}</Text>
                )}
              </div>

              <Text as="p" variant="caption" className="inline-flex items-center gap-1.5">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {t('incidentTimeline.started', 'Started')} {fmtAbs(incident.started_at)}
                {incident.resolved_at ? ` · ${t('incidentTimeline.resolvedAt', 'Resolved')} ${fmtAbs(incident.resolved_at)}` : ''}
              </Text>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('incidentTimeline.details', 'Details')}</PanelTitle>
            <KVList items={detailItems} />
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — AI summarizer (self-gated: renders nothing unless enabled) */}
      <AIIncidentTimelineSummarizer incidentId={incident.id} />

      {/* 4 — Timeline + append-update bento */}
      <FadeIn delay={0.2}>
        <section aria-label={t('incidentTimeline.timelineRegion', 'Incident timeline and updates')} className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('incidentTimeline.timeline', 'Timeline')}
              <Badge variant="neutral" size="sm">{updates.length}</Badge>
            </PanelTitle>
            <IncidentTimelineList updates={updates} />
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('incidentTimeline.postUpdate', 'Post an update')}</PanelTitle>
            {isResolved ? (
              // no-action: resolved incidents are read-only by design (this file's "canonical close-out" rule) — posting updates is intentionally disabled.
              <EmptyState
                icon={<CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
                title={t('incidentTimeline.resolvedTitle', 'Incident resolved')}
                message={t('incidentTimeline.resolvedBody', 'This incident is closed. The timeline remains available for reference.')}
              />
            ) : (
              <IncidentUpdateForm incident={incident} />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      <ConfirmDialog
        open={confirmResolve}
        onConfirm={handleResolve}
        onCancel={() => setConfirmResolve(false)}
        variant="warning"
        title={t('incidentTimeline.confirmTitle', 'Resolve incident?')}
        message={t('incidentTimeline.confirmBody', 'This will close the incident and stamp resolved_at. You can still view the timeline.')}
        confirmLabel={t('incidentTimeline.resolve', 'Resolve')}
        cancelLabel={t('incidentTimeline.cancel', 'Cancel')}
        loading={patch.isPending}
      />
    </PageLayout>
  )
}
