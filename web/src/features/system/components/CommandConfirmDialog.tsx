import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Modal, Input, Button, Heading, Text, HelperText } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';
import type { CommandDef } from '../commands';

interface CommandConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  def: CommandDef;
  loading?: boolean;
}

export function CommandConfirmDialog({
  open,
  onClose,
  onConfirm,
  def,
  loading,
}: CommandConfirmDialogProps) {
  const { t } = useTranslation();
  const countdown = def.countdown ?? 0;
  const confirmInput = def.confirmInput;

  const [remaining, setRemaining] = useState(countdown);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRemaining(countdown);
    setInputValue('');

    if (countdown > 0) {
      const interval = setInterval(() => {
        setRemaining(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [open, countdown]);

  useEffect(() => {
    if (open && confirmInput) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, confirmInput]);

  const canConfirm =
    remaining === 0 &&
    (!confirmInput || inputValue.trim().toUpperCase() === confirmInput.toUpperCase());

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'Enter' && canConfirm && !loading) {
      e.preventDefault();
      onConfirm();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      className="bg-gray-900/95 dark:bg-gray-900/95 backdrop-blur-xl border border-red-500/20"
    >
      <div onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-xl p-2.5 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <Heading level="panel" as="h2">
            {t(def.labelKey, def.labelFallback)}
          </Heading>
        </div>

        <Text as="p" size="sm" color="secondary" className="mb-4">
          {t(def.confirmKey ?? '', def.confirmFallback ?? 'Are you sure?')}
        </Text>

        {confirmInput && (
          <div className="mb-4">
            <HelperText className="mb-2">
              {t('commands.confirm.typeToConfirm', { word: confirmInput, defaultValue: 'Type "{{word}}" to confirm:' })}
            </HelperText>
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={confirmInput}
              autoComplete="off"
              className="bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={loading}
            disabled={!canConfirm}
            onClick={onConfirm}
            className={cn(remaining > 0 && 'opacity-50')}
          >
            {remaining > 0
              ? `${t('common.confirm', 'Confirm')} (${remaining}s)`
              : t('common.confirm', 'Confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
