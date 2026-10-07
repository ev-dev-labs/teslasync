import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover } from '@/components/ui';
import { MoreVertical, Play, RotateCcw, Copy, Download, Trash2 } from 'lucide-react';

interface AutomationCardActionsProps {
  automationId: number;
  autoDisabled: boolean;
  actionsDisabled: boolean;
  actionsDisabledReason?: string;
  onTestRun: (id: number) => void;
  onReEnable: (id: number) => void;
  onRequestDelete: () => void;
}

export function AutomationCardActions({
  automationId, autoDisabled, actionsDisabled, actionsDisabledReason,
  onTestRun, onReEnable, onRequestDelete,
}: AutomationCardActionsProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const actionClassName = 'min-h-11 w-full justify-start rounded-none px-3 py-2 text-start';

  return (
    <>
      <Button
        ref={anchorRef}
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={t('automations.menu', 'Actions menu')}
        aria-haspopup="true"
        aria-expanded={menuOpen}
      >
        <MoreVertical className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Popover
        open={menuOpen}
        onClose={closeMenu}
        anchorRef={anchorRef}
        align="end"
        ariaLabel={t('automations.menu', 'Actions menu')}
        className="w-56 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto py-1"
      >
        <Button
          type="button"
          variant="ghost"
          wrapLabel
          disabled={actionsDisabled}
          title={actionsDisabledReason}
          className={actionClassName}
          icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => { onTestRun(automationId); setMenuOpen(false); }}
        >
          {t('automations.testRun', 'Test run')}
        </Button>
        {autoDisabled && (
          <Button
            type="button"
            variant="ghost"
            wrapLabel
            disabled={actionsDisabled}
            title={actionsDisabledReason}
            className={actionClassName}
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => { onReEnable(automationId); setMenuOpen(false); }}
          >
            {t('automations.reEnable', 'Re-enable')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          wrapLabel
          className={actionClassName}
          icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => { setMenuOpen(false); }}
        >
          {t('automations.duplicate', 'Duplicate')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          wrapLabel
          className={actionClassName}
          icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => { setMenuOpen(false); }}
        >
          {t('automations.export', 'Export')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          wrapLabel
          disabled={actionsDisabled}
          title={actionsDisabledReason}
          className={`${actionClassName} text-rose-300 hover:bg-red-500/10`}
          icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => { onRequestDelete(); setMenuOpen(false); }}
        >
          {t('automations.delete', 'Delete')}
        </Button>
      </Popover>
    </>
  );
}
