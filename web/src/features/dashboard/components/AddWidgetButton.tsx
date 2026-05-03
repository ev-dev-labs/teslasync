import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@/components/ui';
import { Icons } from '@/lib/icons';

/**
 * Phase-45 / Prompt 25 — floating "+" button that opens the widget catalogue
 * dialog from any view of the dashboard.
 *
 * Visibility:
 * - Hidden when the dashboard is in edit mode (the existing `Add Widget`
 *   header action covers that surface).
 *
 * Positioning:
 * - StatusBar (z-[55]) sits at `bottom-0` (desktop, h-7) and `bottom-14`
 *   (mobile, sitting above the BottomTabBar h-14). We position the FAB at
 *   `bottom-20` so it clears the StatusBar + BottomTabBar stack on mobile and
 *   leaves a comfortable gap on desktop. z-[56] places the button above the
 *   StatusBar but below the shared `<Modal>` (z-[60]) so the catalogue can
 *   render on top.
 */
export interface AddWidgetButtonProps {
  /** Click handler — typically opens the widget catalogue dialog. */
  onClick: () => void;
  /** When the dashboard is in edit mode, the FAB hides because the header
   *  already exposes an `Add Widget` action. */
  isEditing: boolean;
}

export function AddWidgetButton({ onClick, isEditing }: AddWidgetButtonProps) {
  const { t } = useTranslation();
  if (isEditing) return null;
  const label = t('dashboard.addWidget', 'Add Widget');
  return (
    <div
      data-print-hide
      data-testid="dashboard-add-widget-fab"
      className="fixed bottom-20 right-6 z-[56]"
    >
      <Tooltip content={label} side="left">
        <Button
          variant="primary"
          size="lg"
          onClick={onClick}
          className="h-14 w-14 rounded-full shadow-xl"
          aria-label={label}
        >
          <Icons.add className="h-6 w-6" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}
