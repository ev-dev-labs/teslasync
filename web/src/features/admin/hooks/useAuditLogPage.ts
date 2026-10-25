import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { hasSharedRangePreference, SHARED_RANGE_STORAGE_KEY, useRangeState } from '@/hooks/useRangeState';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';
import { getDatePreset } from '@/lib/datePresets';
import { formatDateTime as formatTimestamp } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useAuditLog, useAuditCategories, useAuditActions, useAuditChainVerify } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import { deriveDataState } from '@/api/dataState';
import type { AuditLogQueryParams } from '@/types/admin-operator-confidence';
import { toDateTimeInput, toIsoOrUndefined } from '../components/structural-closure/audit-log/helpers';

export function useAuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.auditLog.pageTitle', 'Audit log'));

  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale } = useSettings();
  const { tz } = useDateFormat();
  const formatDateTime = (value: string | Date) => formatTimestamp(value, { locale, tz });
  const range = useRangeState({ timezone: tz });
  const workspaceRangeAvailable = getWorkspaceRouteScope(pathname).range;
  // No implicit seven-day restriction on a previously unbounded ledger.
  // The shared owner must adjudicate its default before enabling this route.
  const hasSavedRange = hasSharedRangePreference(SHARED_RANGE_STORAGE_KEY);
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const scope = searchParams.get('time_scope');
  const calendarRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
    && from <= to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to));
  const sharedRangeActive = !searchParams.has('since') && !searchParams.has('until')
    && Boolean(calendarRange || (scope && getDatePreset(scope)) || hasSavedRange);
  const since = toDateTimeInput(sharedRangeActive ? range.startInstant : searchParams.get('since') ?? '', tz);
  const until = toDateTimeInput(sharedRangeActive ? range.endInstantExclusive : searchParams.get('until') ?? '', tz);
  const setBound = (key: 'since' | 'until', value: string) => {
    const iso = toIsoOrUndefined(value, tz);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (sharedRangeActive && !workspaceRangeAvailable) {
        next.set('since', range.startInstant);
        next.set('until', range.endInstantExclusive);
        next.delete('from');
        next.delete('to');
        next.delete('time_scope');
      }
      if (iso) next.set(key, iso);
      else next.delete(key);
      return next;
    }, { replace: true });
    setOffset(0);
  };
  const setSince = (value: string) => setBound('since', value);
  const setUntil = (value: string) => setBound('until', value);
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState('100');
  const rangeKey = sharedRangeActive
    ? `${range.startInstant}|${range.endInstantExclusive}`
    : `${searchParams.get('since') ?? ''}|${searchParams.get('until') ?? ''}`;
  const [page, setPage] = useState({ rangeKey, offset: 0 });
  const offset = page.rangeKey === rangeKey ? page.offset : 0;
  const setOffset = (next: number) => setPage({ rangeKey, offset: next });
  const [expanded, setExpanded] = useState<(string | number)[]>([]);
  const [verificationRequested, setVerificationRequested] = useState(false);

  const queryParams = useMemo<AuditLogQueryParams>(() => {
    const p: AuditLogQueryParams = { limit: Number(limit), offset };
    const sinceIso = sharedRangeActive ? range.startInstant : searchParams.get('since');
    const untilIso = sharedRangeActive ? range.endInstantExclusive : searchParams.get('until');
    if (sinceIso && Number.isFinite(Date.parse(sinceIso))) p.since = sinceIso;
    if (untilIso && Number.isFinite(Date.parse(untilIso))) p.until = untilIso;
    if (category) p.categories = [category];
    if (action) p.actions = [action];
    if (actor) p.actors = [actor];
    if (entityType) p.entity_type = entityType;
    return p;
  }, [sharedRangeActive, range.startInstant, range.endInstantExclusive, searchParams,
    category, action, actor, entityType, limit, offset]);

  const logSource = useAuditLog(queryParams);
  const logQuery = { ...logSource, isLoading: Boolean(logSource.isLoading) };
  const categoriesQuery = useAuditCategories();
  const actionsQuery = useAuditActions();
  const verifyQuery = useAuditChainVerify(null, 1000, false);
  const logState = deriveDataState(logQuery);
  const categoriesState = deriveDataState(categoriesQuery);
  const actionsState = deriveDataState(actionsQuery);
  const verifyState = deriveDataState(verifyQuery);

  const subsystemMissing = isApiError(logState.fatalError) && logState.fatalError.status === 503
    && logState.fatalError.code === 'SUBSYSTEM_NOT_CONFIGURED';
  const tableError = subsystemMissing ? null : logState.fatalError;

  const rows = logQuery.data?.rows ?? [];
  const verifyData = verifyQuery.data;

  // Derived, null-safe KPIs. "In view" metrics describe the current page of
  // rows (honest framing — the ledger is append-only and unbounded).
  const failedCount = useMemo(() => rows.filter((r) => r.success === false).length, [rows]);
  const okCount = useMemo(() => rows.filter((r) => r.success === true).length, [rows]);
  const distinctActors = useMemo(
    () => new Set(rows.map((r) => r.actor).filter(Boolean)).size,
    [rows],
  );
  const categoriesCount = categoriesQuery.data?.categories?.length ?? 0;
  const actionsCount = actionsQuery.data?.actions?.length ?? 0;

  const countsReady = logState.hasData;
  const categoriesReady = categoriesState.hasData;
  const actionsReady = actionsState.hasData;

  const categoryOptions = useMemo<{ value: string; label: string }[]>(() => {
    const list = categoriesQuery.data?.categories ?? [];
    return [
      { value: '', label: t('admin.auditLog.allCategories', 'All categories') },
      ...list.map((c) => ({ value: c, label: c })),
    ];
  }, [categoriesQuery.data, t]);

  const actionOptions = useMemo<{ value: string; label: string }[]>(() => {
    const list = actionsQuery.data?.actions ?? [];
    return [
      { value: '', label: t('admin.auditLog.allActions', 'All actions') },
      ...list.map((a) => ({ value: a, label: a })),
    ];
  }, [actionsQuery.data, t]);

  const handleReset = () => {
    if (!workspaceRangeAvailable && !sharedRangeActive) {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete('since');
        next.delete('until');
        return next;
      }, { replace: true });
    }
    setCategory('');
    setAction('');
    setActor('');
    setEntityType('');
    setOffset(0);
  };

  const toggleExpanded = (id: number) => {
    setExpanded((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id],
    );
  };

  const handleVerify = () => {
    setVerificationRequested(true);
    void verifyQuery.refetch();
  };

  return {
    t, since, setSince, until, setUntil, category, setCategory, action, setAction, actor, setActor, entityType, setEntityType, limit, setLimit, offset, setOffset, expanded, setExpanded, logQuery, categoriesQuery, actionsQuery, verifyQuery, logState, categoriesState, actionsState, verifyState, subsystemMissing, tableError, rows, verifyData, failedCount, okCount, distinctActors, categoriesCount, actionsCount, countsReady, categoriesReady, actionsReady, categoryOptions, actionOptions, handleReset, toggleExpanded,
    workspaceRangeAvailable, sharedRangeActive, range, timezone: tz, formatDateTime, verificationRequested, handleVerify,
  };
}
