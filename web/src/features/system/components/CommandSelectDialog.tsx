import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Modal, Button as ControlButton } from '@/components/ui';
import type { CommandDef } from '../commands';

interface CommandSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  def: CommandDef;
  loading?: boolean;
}

export function CommandSelectDialog({
  open,
  onClose,
  onSelect,
  def,
  loading,
}: CommandSelectDialogProps) {
  const { t } = useTranslation();
  const sc = def.selectConfig!;
  const Icon = def.icon;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      className="bg-gray-900/95 dark:bg-gray-900/95 backdrop-blur-xl border border-white/10"
    >
      <div onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-xl p-2.5 bg-white/5 text-white/60">
            <Icon className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold text-white/90">
            {t(def.labelKey, def.labelFallback)}
          </h2>
        </div>

        <div className="space-y-2">
          {sc.options.map(opt => (
            <ControlButton
              key={opt.value}
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => onSelect(opt.value)}
              className={cn(
                'h-auto w-full flex-col items-start gap-0.5 rounded-lg p-3 text-left font-normal transition-all duration-200',
                'bg-white/5 border border-white/10',
                'hover:bg-white/10 hover:border-neon-cyan/30',
                'focus:outline-none focus:ring-2 focus:ring-neon-cyan/30',
                loading && 'opacity-50 cursor-not-allowed',
              )}
            >
              <span className="text-sm font-medium text-white/90">
                {t(opt.labelKey, opt.labelFallback)}
              </span>
              {opt.description && (
                <span className="block text-xs text-white/40 mt-0.5">
                  {opt.description}
                </span>
              )}
            </ControlButton>
          ))}
        </div>

        <div className="flex justify-end pt-4">
          <ControlButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/50 hover:text-white/80 hover:bg-white/5"
          >
            {t('common.cancel', 'Cancel')}
          </ControlButton>
        </div>
      </div>
    </Modal>
  );
}
