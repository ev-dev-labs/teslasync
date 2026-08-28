import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripHorizontal,
  Maximize2,
  Move,
  Settings,
  Shrink,
  X,
} from 'lucide-react';

import { Button, Caption, Popover } from '@/components/ui';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import type { WidgetDef } from '../widgets/types';
import type {
  WidgetArrangeAction,
  WidgetArrangeAvailability,
} from './dashboardLayoutActions';

interface WidgetEditChromeProps {
  def: WidgetDef;
  onRemove: () => void;
  onSettings: () => void;
  onArrange: (action: WidgetArrangeAction) => boolean;
  arrangeAvailability: WidgetArrangeAvailability;
}

export function WidgetEditChrome({
  def,
  onRemove,
  onSettings,
  onArrange,
  arrangeAvailability,
}: WidgetEditChromeProps) {
  const { t } = useTranslation();
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const { announce } = useAnnouncer();
  const arrangeButtonRef = useRef<HTMLButtonElement>(null);
  const arrangePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!arrangeOpen) return;
    const frame = requestAnimationFrame(() => {
      arrangePanelRef.current
        ?.querySelector<HTMLButtonElement>(
          'button:not(:disabled):not([aria-disabled="true"])',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [arrangeOpen]);

  const arrange = (action: WidgetArrangeAction, message: string) => {
    if (onArrange(action)) {
      announce(message);
      setArrangeOpen(false);
    }
  };

  return (
    <div className="widget-edit-overlay pointer-events-none absolute inset-0 z-10 group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
      <div
        className="widget-edit-toolbar widget-drag-handle absolute left-0 right-0 top-0 flex h-9 cursor-grab items-center justify-between
          rounded-t-xl bg-gradient-to-b from-black/60 to-transparent px-3 opacity-0 transition-opacity
          active:cursor-grabbing group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <Caption>{def.name}</Caption>
        </div>
        <div className="flex items-center gap-1">
          <Button
            ref={arrangeButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setArrangeOpen((open) => !open);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="h-7 w-7 rounded p-0 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]"
            aria-label={t('dashboard.grid.arrangeLabel', 'Arrange {{name}}', { name: def.name })}
            aria-haspopup="dialog"
            aria-expanded={arrangeOpen}
          >
            <Move className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onSettings();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="h-7 w-7 rounded p-0 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]"
            aria-label={t('dashboard.grid.settingsLabel', 'Settings for {{name}}', { name: def.name })}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            className="h-7 w-7 rounded p-0 text-[var(--text-muted)] transition-colors hover:bg-red-500/20 hover:text-red-400"
            aria-label={t('dashboard.grid.removeLabel', 'Remove {{name}}', { name: def.name })}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Popover
        open={arrangeOpen}
        onClose={() => setArrangeOpen(false)}
        anchorRef={arrangeButtonRef}
        align="end"
        ariaLabel={t('dashboard.grid.arrangeDialogLabel', 'Arrange {{name}}', { name: def.name })}
        className="w-64 p-3"
      >
        <div ref={arrangePanelRef}>
          <Caption className="mb-2 block">
            {t('dashboard.grid.positionHeading', 'Position')}
          </Caption>
          <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['move-up']}
            onClick={() => arrange(
              'move-up',
              t('dashboard.grid.movedUpAnnouncement', '{{name}} moved up', { name: def.name }),
            )}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            {t('dashboard.grid.moveUp', 'Move up')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['move-down']}
            onClick={() => arrange(
              'move-down',
              t('dashboard.grid.movedDownAnnouncement', '{{name}} moved down', { name: def.name }),
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {t('dashboard.grid.moveDown', 'Move down')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['move-left']}
            onClick={() => arrange(
              'move-left',
              t('dashboard.grid.movedLeftAnnouncement', '{{name}} moved left', { name: def.name }),
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('dashboard.grid.moveLeft', 'Move left')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['move-right']}
            onClick={() => arrange(
              'move-right',
              t('dashboard.grid.movedRightAnnouncement', '{{name}} moved right', { name: def.name }),
            )}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {t('dashboard.grid.moveRight', 'Move right')}
          </Button>
          </div>

          <Caption className="mb-2 mt-3 block">
            {t('dashboard.grid.sizeHeading', 'Size')}
          </Caption>
          <div className="grid grid-cols-2 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['make-narrower']}
            onClick={() => arrange(
              'make-narrower',
              t('dashboard.grid.madeNarrowerAnnouncement', '{{name}} made narrower', { name: def.name }),
            )}
          >
            <Shrink className="h-3.5 w-3.5" />
            {t('dashboard.grid.makeNarrower', 'Narrower')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['make-wider']}
            onClick={() => arrange(
              'make-wider',
              t('dashboard.grid.madeWiderAnnouncement', '{{name}} made wider', { name: def.name }),
            )}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {t('dashboard.grid.makeWider', 'Wider')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['make-shorter']}
            onClick={() => arrange(
              'make-shorter',
              t('dashboard.grid.madeShorterAnnouncement', '{{name}} made shorter', { name: def.name }),
            )}
          >
            <Shrink className="h-3.5 w-3.5 rotate-90" />
            {t('dashboard.grid.makeShorter', 'Shorter')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!arrangeAvailability['make-taller']}
            onClick={() => arrange(
              'make-taller',
              t('dashboard.grid.madeTallerAnnouncement', '{{name}} made taller', { name: def.name }),
            )}
          >
            <Maximize2 className="h-3.5 w-3.5 rotate-90" />
            {t('dashboard.grid.makeTaller', 'Taller')}
          </Button>
          </div>
        </div>
      </Popover>

      <div className="absolute bottom-1 right-1 opacity-0 transition-opacity group-hover:opacity-50">
        <Maximize2 className="h-3 w-3 text-[var(--text-muted)]" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 rounded-xl border-2 border-transparent
          transition-colors group-hover:border-[var(--theme-primary)]/30"
      />
    </div>
  );
}
