/**
 * Renders a pack's requested capabilities against the fixed, documented
 * allowlist catalog (`PACK_CAPABILITY_CATALOG`). When `granted` is
 * supplied, each capability is additionally marked granted/denied
 * (deny-by-default — see `lib/capabilityPolicy.ts`).
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { describeCapability } from '../lib/capabilityPolicy';
import type { PackCapabilityId } from '../lib/manifestTypes';

export interface CapabilityRequestListProps {
  capabilityIds: readonly PackCapabilityId[];
  granted?: ReadonlySet<PackCapabilityId>;
  className?: string;
}

export function CapabilityRequestList({ capabilityIds, granted, className }: CapabilityRequestListProps) {
  const { t } = useTranslation();

  if (capabilityIds.length === 0) {
    return <p className={className}>{t('intelPacks.capabilities.none', 'This pack requests no capabilities.')}</p>;
  }

  return (
    <ul data-app-part="list" data-app-list="definitions" className={className}>
      {capabilityIds.map((id) => {
        const descriptor = describeCapability(id);
        const isGranted = granted?.has(id);
        return (
          <li data-app-part="list-row" key={id} className="flex items-start gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
            <div data-app-part="metric-label" className="min-w-0 flex-1">
              <p className="text-sm text-[var(--text-primary)]">{descriptor?.label ?? id}</p>
              <p data-app-part="metric-context" className="text-xs text-[var(--text-muted)]">{descriptor?.description ?? ''}</p>
            </div>
            {granted && (
              <span data-app-part="metric-reading" className="inline-flex shrink-0">
                <Badge data-app-part="badge metric-value" variant={isGranted ? 'success' : 'neutral'} size="sm" className="shrink-0">
                  {isGranted ? t('intelPacks.capabilities.granted', 'Granted') : t('intelPacks.capabilities.denied', 'Denied')}
                </Badge>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
