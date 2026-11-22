import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { personalScope, usePersonalIdentity } from '@/api/hooks/usePersonalIdentity';
import { useSmartFeatures } from '@/api/hooks/useSmartFeatures';
import { DateTime } from '@/components/data-display';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Button, ErrorText, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useTicker } from '@/hooks/useTicker';
import { useClipRetention, type RetentionAction } from '../../hooks/useClipRetention';
import { eligibleRetentionClip, matchesRetentionClip, retentionStatus } from '../../lib/clipRetention';
import { downloadBlobAs } from '../../lib/redactionExport';
import type { ClipRecord } from '../../lib/types';
import { ClipRetentionEditor } from './ClipRetentionEditor';

interface Props {
  vehicleId: number;
  fleetReady: boolean;
  catalogReady: boolean;
  clips: ClipRecord[];
  selected: ClipRecord | null;
  onSelect: (id: string) => void;
}

export function ClipRetentionPanel(props: Props) {
  const { t } = useTranslation();
  const identity = usePersonalIdentity(props.fleetReady);
  const state = useDataState(identity);
  const scope = personalScope(state.data);
  const permissionQuery = useSmartFeatures(scope?.mode === 'forward_auth' ? scope : null, 30_000);
  const permission = useDataState(permissionQuery);
  const retention = permission.data?.find(pref => pref.feature === 'dashcam_retention');
  const title = t('dashcam.retention.title', 'Private clip retention');
  return <section aria-label={title}><LayoutCard title={title}>
    <div className="space-y-3">
      <Text as="p" variant="bodySm">
        {t('dashcam.retention.intro', 'Off until you confirm a deadline for an imported clip. TeslaSync cannot tell when your recorder will overwrite it. Review appears only here; no push, upload, or change to vehicle storage.')}
      </Text>
      {state.fatalError || state.refreshError ? <QueryError error={state.fatalError ?? state.refreshError} onRetry={state.retry ?? undefined} />
        : !props.fleetReady ? <Text as="p" variant="bodySm">{t('dashcam.retention.fleetUnavailable', 'A current vehicle selection is needed to review private deadlines.')}</Text>
        : !state.hasData ? <Skeleton lines={2} />
        : scope?.mode !== 'forward_auth' ? <Text as="p" variant="bodySm">{t('dashcam.retention.signIn', 'Sign in with a personal account to keep private reminders on this browser.')}</Text>
        : state.data?.impersonating !== false ? <Text as="p" variant="bodySm">{t('dashcam.retention.ownSignIn', 'Private reminders are available only in your own verified sign-in session.')}</Text>
        : permission.fatalError || permission.refreshError ? <QueryError error={permission.fatalError ?? permission.refreshError} onRetry={permission.retry ?? undefined} />
        : !permission.hasData ? <Skeleton lines={2} />
        : !retention?.allowed ? <Text as="p" variant="bodySm">{t('settings.smartFeatures.dashcam.paused', 'Retention review is paused in Smart Features. Your saved deadlines remain on this browser.')}</Text>
        : <ScopedRetention key={JSON.stringify([scope.subject, props.vehicleId])}
          {...props} subject={scope.subject}
          checking={identity.isFetching || state.isRefreshBlocked || permissionQuery.isFetching || permission.isRefreshBlocked} />}
    </div>
  </LayoutCard></section>;
}

function ScopedRetention({ subject, vehicleId, catalogReady, selected, clips, onSelect, checking }: Props & { subject: string; checking: boolean }) {
  const { t } = useTranslation();
  const { query, act } = useClipRetention(subject, vehicleId, !checking);
  const state = useDataState(query);
  const plans = state.data ?? [];
  useTicker(plans.length > 0);
  const now = Date.now();
  const editRegion = useRef<HTMLDivElement>(null);
  const latestClip = useRef(selected);
  const active = useRef(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const selectedPlan = plans.find(plan => selected && plan.clipId === selected.id) ?? null;
  const due = plans.flatMap(plan => {
    const clip = clips.find(item => item.id === plan.clipId);
    return matchesRetentionClip(plan, clip) && retentionStatus(plan, now) === 'due' ? [{ plan, clip }] : [];
  }).sort((a, b) => a.plan.deadline.localeCompare(b.plan.deadline));
  const mediumReady = catalogReady && state.status === 'ok' && !query.isFetching && !checking;

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { latestClip.current = selected; setFailed(false); }, [selected]);
  useEffect(() => {
    if (selected?.id === reviewId) {
      editRegion.current?.focus();
      setReviewId(null);
    }
  }, [selected?.id, reviewId]);

  async function onAction(action: RetentionAction | { deadline: string }) {
    if (!mediumReady || inFlight.current || !eligibleRetentionClip(selected, vehicleId)) return false;
    const current = () => active.current && latestClip.current?.id === selected.id
      && latestClip.current.createdAt === selected.createdAt;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const clip = await act(selected, selectedPlan, action, current);
      if (!current()) return false;
      if (clip) downloadBlobAs(clip.blob, clip.fileName);
      return true;
    } catch {
      if (current()) setFailed(true);
      return false;
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!checking && state.fatalError) return <QueryError error={state.fatalError} onRetry={state.retry ?? undefined}
    message={t('dashcam.retention.storageError', 'Reminders could not be read from this browser. Check other Dashcam tabs and retry.')} />;
  if (!state.hasData) return <Skeleton lines={2} />;
  return <div className="space-y-3">
    {!checking && <StaleRefreshWarning state={state} />}
    {checking ? <Skeleton lines={2} /> : due.length > 0 ? <ul className="space-y-2" aria-label={t('dashcam.retention.reviewList', 'Clips to review now')}>
      {due.map(({ plan, clip }) => <li key={clip.id} className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Text as="p" variant="label" className="break-all">{clip.fileName}</Text>
          <Text as="p" variant="bodySm">{t('dashcam.retention.deadlineEvidence', 'Deadline you confirmed:')} <DateTime value={plan.deadline} /></Text>
          <Text as="p" variant="caption">{t('dashcam.retention.recordedAt', 'Recorded:')} <DateTime value={plan.confirmedAt} /></Text>
        </div>
        <Button type="button" variant="secondary" className="min-h-11" disabled={!mediumReady || busy}
          onClick={() => {
            if (selected?.id === clip.id) editRegion.current?.focus();
            else { setReviewId(clip.id); onSelect(clip.id); }
          }}>{t('dashcam.retention.review', 'Review clip retention')}</Button>
      </li>)}
    </ul> : <Text as="p" variant="bodySm">{t('dashcam.retention.noDue', 'No clip is due for retention review.')}</Text>}
    {eligibleRetentionClip(selected, vehicleId) ? <div ref={editRegion} tabIndex={-1}
      aria-label={t('dashcam.retention.selected', 'Selected clip')} role="region">
      <ClipRetentionEditor key={JSON.stringify([selected.id, selected.createdAt])} name={selected.fileName}
        plan={selectedPlan && matchesRetentionClip(selectedPlan, selected) ? selectedPlan : null}
        now={now} checking={checking} disabled={!mediumReady || busy} onAction={onAction} />
    </div> : !checking && <Text as="p" variant="bodySm">{t('dashcam.retention.pickClip', 'Select a locally imported clip for the current vehicle to record a deadline.')}</Text>}
    {!checking && failed && <ErrorText role="alert">{t('dashcam.retention.actionError', 'The clip, reminder, or signed-in scope changed, or storage was unavailable. Review the current selection and retry.')}</ErrorText>}
  </div>;
}
