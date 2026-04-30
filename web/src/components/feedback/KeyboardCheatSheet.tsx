import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation (press g then...)',
    shortcuts: [
      { keys: ['g', 'd'], description: 'Go to Dashboard' },
      { keys: ['g', 'v'], description: 'Go to Vehicles' },
      { keys: ['g', 'c'], description: 'Go to Charging' },
      { keys: ['g', 'r'], description: 'Go to Drives' },
      { keys: ['g', 't'], description: 'Go to Trips' },
      { keys: ['g', 'b'], description: 'Go to Battery & Energy' },
      { keys: ['g', 'a'], description: 'Go to Analytics' },
      { keys: ['g', 'e'], description: 'Go to Efficiency' },
      { keys: ['g', 'l'], description: 'Go to Live Signals' },
      { keys: ['g', 'o'], description: 'Go to Automations' },
      { keys: ['g', 'x'], description: 'Go to Commands' },
      { keys: ['g', 's'], description: 'Go to Settings' },
      { keys: ['g', 'n'], description: 'Go to Notifications' },
      { keys: ['g', 'i'], description: 'Go to Climate' },
      { keys: ['g', 'm'], description: 'Go to Admin' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open Command Palette' },
      { keys: ['/'], description: 'Open Command Palette' },
      { keys: ['?'], description: 'Show Keyboard Shortcuts' },
      { keys: ['Esc'], description: 'Close Modal / Cancel' },
    ],
  },
  {
    title: 'Dashboard (in edit mode)',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], description: 'Undo layout change' },
      { keys: ['Ctrl', 'Y'], description: 'Redo layout change' },
    ],
  },
];

interface KeyboardCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardCheatSheet({ open, onClose }: KeyboardCheatSheetProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('shortcuts.title', 'Keyboard Shortcuts')}
    >
      <div className="space-y-6 max-h-[70vh] overflow-y-auto">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-white/70 mb-3">{group.title}</h3>
            <div className="space-y-1.5">
              {group.shortcuts.map((s) => (
                <div key={s.description} className="flex items-center justify-between py-1">
                  <span className="text-sm text-white/60">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((key, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-white/20 text-xs">+</span>}
                        <kbd className="px-2 py-0.5 rounded bg-white/[0.06] border border-white/[0.08]
                          text-xs font-mono text-white/50 min-w-[24px] text-center">
                          {key}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
