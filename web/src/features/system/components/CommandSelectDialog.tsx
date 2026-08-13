import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Modal, Button as ControlButton, Heading, Text, Caption } from '@/components/ui';
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
  // `selectConfig` is present for every select-type command, but guard it so a
  // malformed definition renders an empty state instead of throwing on `.map`.
  const options = def.selectConfig?.options ?? [];
  const Icon = def.icon;
  const commandLabel = t(def.labelKey, def.labelFallback);

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
      // No visible `title` prop is used (the heading lives in the body), so the
      // dialog needs an explicit accessible name for assistive tech.
      ariaLabel={commandLabel}
      className="bg-[var(--surface-1)] backdrop-blur-xl border border-[var(--border-subtle)]"
    >
      <div onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-xl p-2.5 bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <Heading level="panel" as="h2">
            {commandLabel}
          </Heading>
        </div>

        <div className="space-y-2">
          {options.length > 0 ? (
            options.map(opt => (
              <ControlButton
                key={opt.value}
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => onSelect(opt.value)}
                className={cn(
                  'h-auto w-full flex-col items-start gap-0.5 rounded-lg p-3 text-left font-normal transition-all duration-normal',
                  'bg-[var(--surface-2)] border border-[var(--border-subtle)]',
                  'hover:bg-[var(--surface-2)] hover:border-neon-cyan/30',
                  'focus:outline-none focus:ring-2 focus:ring-neon-cyan/30',
                  loading && 'opacity-50 cursor-not-allowed',
                )}
              >
                <Text size="sm" weight="medium" color="primary">
                  {t(opt.labelKey, opt.labelFallback)}
                </Text>
                {(opt.descriptionKey || opt.descriptionFallback || opt.description) && (
                  <Caption className="block mt-0.5">
                    {opt.descriptionKey
                      ? t(
                          opt.descriptionKey,
                          opt.descriptionFallback ?? opt.description ?? '—',
                        )
                      : opt.descriptionFallback ?? opt.description}
                  </Caption>
                )}
              </ControlButton>
            ))
          ) : (
            <Text as="p" size="sm" color="secondary" className="py-4 text-center">
              {t('commands.select.noOptions', 'No options available')}
            </Text>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <ControlButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            {t('common.cancel', 'Cancel')}
          </ControlButton>
        </div>
      </div>
    </Modal>
  );
}
