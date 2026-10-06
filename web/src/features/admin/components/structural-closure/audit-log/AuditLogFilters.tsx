import { Search, X as XIcon } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Button, Input, Select } from '@/components/ui';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';
import { LIMIT_OPTIONS } from './helpers';

type Props = { controller: ReturnType<typeof useAuditLogPage> };

export function AuditLogFilters({ controller }: Props) {
  const { t, since, setSince, until, setUntil, category, setCategory, action, setAction, actor, setActor, entityType, setEntityType, limit, setLimit, setOffset, logQuery, categoryOptions, actionOptions, handleReset } = controller;

  return (
<div className="min-w-0 xl:col-span-2">
          <LayoutCard title={t('admin.auditLog.filtersTitle', 'Filters')}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 3xl:grid-cols-3">
              <Input
                type="datetime-local"
                label={t('admin.auditLog.sinceLabel', 'Since')}
                value={since}
                onChange={(e) => {
                  setSince(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                type="datetime-local"
                label={t('admin.auditLog.untilLabel', 'Until')}
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.categoryLabel', 'Category')}
                options={categoryOptions}
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.actionLabel', 'Action')}
                options={actionOptions}
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                label={t('admin.auditLog.actorLabel', 'Actor')}
                placeholder={t('admin.auditLog.actorPlaceholder', 'e.g. admin@local')}
                value={actor}
                onChange={(e) => {
                  setActor(e.target.value);
                  setOffset(0);
                }}
              />
              <Input
                label={t('admin.auditLog.entityTypeLabel', 'Entity type')}
                placeholder={t('admin.auditLog.entityTypePlaceholder', 'e.g. vehicle, alert_rule')}
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setOffset(0);
                }}
              />
              <Select
                label={t('admin.auditLog.limitLabel', 'Rows per page')}
                options={LIMIT_OPTIONS}
                value={limit}
                onChange={(e) => {
                  setLimit(e.target.value);
                  setOffset(0);
                }}
              />
              <div className="flex items-end gap-2 sm:col-span-2 3xl:col-span-1">
                <Button variant="ghost" size="md" className="min-h-11" onClick={handleReset}>
                  <XIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('admin.auditLog.resetFilters', 'Reset')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  className="min-h-11"
                  onClick={() => logQuery.refetch()}
                >
                  <Search className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('admin.auditLog.applyFilters', 'Search')}
                </Button>
              </div>
            </div>
          </LayoutCard>
          </div>
  );
}
