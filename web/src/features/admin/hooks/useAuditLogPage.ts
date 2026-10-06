import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAuditLog, useAuditCategories, useAuditActions, useAuditChainVerify } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import { deriveDataState } from '@/api/dataState';
import type { AuditLogQueryParams } from '@/types/admin-operator-confidence';
import { toIsoOrUndefined } from '../components/structural-closure/audit-log/helpers';

export function useAuditLogPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.auditLog.pageTitle', 'Audit log'));

  // Filter state — string fields are empty=unset, never undefined,
  // so the controlled inputs stay controlled.
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState('100');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<(string | number)[]>([]);

  const queryParams = useMemo<AuditLogQueryParams>(() => {
    const p: AuditLogQueryParams = { limit: Number(limit), offset };
    const sinceIso = toIsoOrUndefined(since);
    const untilIso = toIsoOrUndefined(until);
    if (sinceIso) p.since = sinceIso;
    if (untilIso) p.until = untilIso;
    if (category) p.categories = [category];
    if (action) p.actions = [action];
    if (actor) p.actors = [actor];
    if (entityType) p.entity_type = entityType;
    return p;
  }, [since, until, category, action, actor, entityType, limit, offset]);

  const logQuery = useAuditLog(queryParams);
  const categoriesQuery = useAuditCategories();
  const actionsQuery = useAuditActions();
  const verifyQuery = useAuditChainVerify(null, 1000, false);
  const logState = deriveDataState(logQuery);
  const categoriesState = deriveDataState(categoriesQuery);
  const actionsState = deriveDataState(actionsQuery);
  const verifyState = deriveDataState(verifyQuery);

  const subsystemMissing = isApiError(logState.fatalError) && logState.fatalError.status === 503;
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
    setSince('');
    setUntil('');
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


  return {
    t, since, setSince, until, setUntil, category, setCategory, action, setAction, actor, setActor, entityType, setEntityType, limit, setLimit, offset, setOffset, expanded, setExpanded, logQuery, categoriesQuery, actionsQuery, verifyQuery, logState, categoriesState, actionsState, verifyState, subsystemMissing, tableError, rows, verifyData, failedCount, okCount, distinctActors, categoriesCount, actionsCount, countsReady, categoriesReady, actionsReady, categoryOptions, actionOptions, handleReset, toggleExpanded
  };
}
