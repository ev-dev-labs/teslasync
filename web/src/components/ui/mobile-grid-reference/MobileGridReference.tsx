import { Text } from '@/components/ui';
import { groupHasSummary } from './helpers';
import { MobileReferenceRow } from './MobileReferenceRow';
import { MobileReferenceState } from './MobileReferenceState';
import { MobileReferenceToolbar } from './MobileReferenceToolbar';
import { MobileReferenceDialogs } from './MobileReferenceDialogs';
import { MobileReferenceFooter } from './MobileReferenceFooter';
import type { MobileGridReferenceProps } from './types';
import './mobile-grid-reference.css';

/** Stateless presentation candidate, NOT a replacement DataGrid/data pipeline. */
export function MobileGridReference({ model, callbacks, desktop }: MobileGridReferenceProps) {
  const showRows = model.state.kind === 'ready' || (model.state.kind === 'error' && model.state.retained);
  return (
    <div className="mgr-host min-w-0" data-grid={model.id} aria-label={model.label}>
      <div className="mgr-desktop">{desktop}</div>
      <div className="mgr-mobile min-w-0">
        <MobileReferenceToolbar model={model} callbacks={callbacks} />
        <div className="mgr-group overflow-clip bg-[var(--surface-1)]">
          <MobileReferenceState state={model.state} callbacks={callbacks} />
          {showRows && model.groups.map(group => (
            <div key={group.key} data-group="">
              {group.label && (
                <div data-group-header="" className="mgr-group-header sticky top-0 z-[1] flex min-w-0 items-center justify-between gap-2 bg-[var(--surface-2)] px-3 py-2">
                  <Text className="min-w-0 truncate" title={group.label}>{group.label}</Text>
                  {groupHasSummary(group) && <Text data-group-summary="" title={group.summary} className="max-w-[50%] shrink-0 truncate">{group.summary}</Text>}
                </div>
              )}
              {group.rows.map(row => (
                <MobileReferenceRow key={row.key} row={row} variant={model.variant}
                  selecting={model.selection.enabled} selected={model.selection.keys.includes(row.key)}
                  onActivate={() => callbacks.onActivate(row.key)}
                  onToggle={() => callbacks.onToggleSelection(row.key)} />
              ))}
            </div>
          ))}
        </div>
        <MobileReferenceFooter model={model} callbacks={callbacks} />
        <MobileReferenceDialogs model={model} callbacks={callbacks} />
      </div>
    </div>
  );
}
