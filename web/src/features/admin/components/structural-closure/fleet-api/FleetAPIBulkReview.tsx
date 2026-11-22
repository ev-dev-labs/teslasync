import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Code, Modal, Select, Text } from '@/components/ui';
import type { PollingConfig } from '@/api/hooks/useSettings';
import { keepFleetPermissions, planFleetPermissions, type FleetPermission } from '../../../lib/fleetEndpointPolicy';

export interface FleetReviewScope {
  label: string;
  keys: string[];
}

export function FleetAPIBulkReview({ scope, config, pending, onClose, onApply }: {
  scope: FleetReviewScope;
  config: PollingConfig;
  pending: boolean;
  onClose: () => void;
  onApply: (config: PollingConfig) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [changes, setChanges] = useState(keepFleetPermissions);
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState(false);
  const plan = planFleetPermissions(config, scope.keys, changes);
  const access = t('fleetApi.controls.enabled', 'Access');
  const smart = t('fleetApi.controls.smart', 'Smart Features');
  const auto = t('fleetApi.controls.autoPoll', 'Auto-poll');
  const fields: { key: FleetPermission; label: string }[] = [
    { key: 'access', label: access },
    ...(config.smart_endpoints == null ? [] : [{ key: 'smart' as const, label: smart }]),
    { key: 'auto', label: auto },
  ];
  const apply = async () => {
    if (!plan.changed.length || pending) return;
    setFailed(false);
    try {
      await onApply(plan.config);
      onClose();
    } catch {
      setFailed(true);
    }
  };

  return <Modal open onClose={pending ? () => {} : onClose} size="lg"
    title={t('fleetApi.redesign.bulkTitle', 'Edit endpoint permissions')}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="secondary" wrapLabel disabled={pending} onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
      {reviewing && <Button size="sm" variant="secondary" wrapLabel disabled={pending} onClick={() => setReviewing(false)}>
        {t('fleetApi.redesign.backToEdit', 'Back to edits')}
      </Button>}
      <Button size="sm" wrapLabel disabled={!plan.changed.length || pending} loading={pending}
        onClick={reviewing ? () => void apply() : () => setReviewing(true)}>
        {reviewing ? t('fleetApi.redesign.apply', 'Apply changes') : t('fleetApi.redesign.review', 'Review changes')}
      </Button>
    </div>}>
    <div className="min-w-0 space-y-4">
      <Text as="p" weight="semibold">
        {t('fleetApi.redesign.editScope', '{{scope}} · Routes: {{count}}', { scope: scope.label, count: scope.keys.length })}
      </Text>
      {!reviewing && <div className="grid gap-3 sm:grid-cols-3">
        {fields.map(field =>
          <Select key={field.key} label={field.label} value={changes[field.key]} options={[
            { value: 'keep', label: t('fleetApi.redesign.keep', 'Leave unchanged') },
            { value: 'enable', label: t('fleetApi.controls.enable', 'Enable') },
            { value: 'disable', label: t('fleetApi.redesign.disable', 'Disable') },
          ]} onChange={event => {
            const value = event.target.value;
            if (value === 'keep' || value === 'enable' || value === 'disable') {
              setChanges(current => ({ ...current, [field.key]: value }));
            }
          }} />)}
      </div>}
      {changes.access === 'disable' && <Text as="p" variant="bodySm" color="secondary">
        {t('fleetApi.redesign.clearDependent', 'Disabling Access also removes Smart Features and Auto-poll selections.')}
      </Text>}
      <div className="flex flex-wrap gap-2" aria-live="polite">
        {fields.map(field => <Badge key={field.key} variant={plan.counts[field.key] ? 'info' : 'neutral'}>
          {t('fleetApi.redesign.changeCount', '{{label}}: {{count}} changed', { label: field.label, count: plan.counts[field.key] })}
        </Badge>)}
      </div>
      {plan.skipped.smartNoAccess > 0 && <Text as="p" variant="bodySm" color="secondary">
        {t('fleetApi.redesign.smartSkipped', 'Smart Features skipped (no Access): {{count}}', { count: plan.skipped.smartNoAccess })}
      </Text>}
      {plan.skipped.autoNoAccess > 0 && <Text as="p" variant="bodySm" color="secondary">
        {t('fleetApi.redesign.autoSkipped', 'Auto-poll skipped (no Access): {{count}}', { count: plan.skipped.autoNoAccess })}
      </Text>}
      {plan.skipped.notPollable > 0 && <Text as="p" variant="bodySm" color="secondary">
        {t('fleetApi.redesign.autoUnsupported', 'Routes without Auto-poll support: {{count}}', { count: plan.skipped.notPollable })}
      </Text>}
      {plan.writes.length > 0 && <div className="space-y-2 rounded-panel border border-[var(--semantic-warning)] p-3">
        <Text as="p" weight="semibold">
          {t('fleetApi.redesign.writeWarning', 'New write permissions: {{count}}. Review the routes before applying.', { count: plan.writes.length })}
        </Text>
        <ul className="space-y-1">
          {plan.writes.map(route => <li key={route.key}><Code className="break-all">{route.method} {route.path}</Code></li>)}
        </ul>
      </div>}
      {reviewing && <ul className="max-h-48 space-y-1 overflow-auto rounded-panel border border-[var(--border-default)] p-3"
        aria-label={t('fleetApi.redesign.affected', 'Routes that will change')}>
        {plan.changed.map(route => <li key={route.key}><Code className="break-all">{route.method} {route.path}</Code></li>)}
      </ul>}
      {failed && <Text as="p" variant="bodySm" role="alert">
        {t('fleetApi.redesign.applyFailed', 'Changes were not saved. Review the current settings and try again.')}
      </Text>}
    </div>
  </Modal>;
}
