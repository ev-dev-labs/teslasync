/**
 * Feature Flags — edit / create drawer.
 * Single component that powers BOTH "edit existing flag" (when
 * `initialKey` is provided + read-only) AND "create new flag" (when
 * `initialKey` is null). The split lives in the parent page; this
 * drawer just renders the form.
 * Value editing is a free-form JSON textarea — the backend accepts any
 * JSON value (object, array, scalar). Invalid JSON disables the Save
 * button and surfaces a parse-error helper text.
 * `reason` is required by the backend audit row and rejected if empty.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Drawer,
  GlassPanel,
  Input,
  Textarea,
} from '@/components/ui';
import { Text } from '@/components/ui/Typography';
import type {
  FeatureFlagEntry,
  FeatureFlagValue,
} from '@/types/admin-diagnostics';

interface FlagEditDrawerProps {
  open: boolean;
  /** When null/undefined, the drawer is in "create new" mode. */
  initial: FeatureFlagEntry | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: { key: string; value: FeatureFlagValue; reason: string }) => void;
}

function defaultValueJson(initial: FeatureFlagEntry | null): string {
  if (!initial) return '';
  try {
    // JSON.stringify returns `undefined` (NOT a string) for `undefined`,
    // functions, and symbols — a nuance TS's lib types hide. Coalesce so the
    // caller always receives a real string; otherwise the seeded `valueInput`
    // becomes `undefined` and the next `valueInput.trim()` in `parsed` throws,
    // blank-crashing the drawer for a flag whose stored value is `undefined`.
    return JSON.stringify(initial.value, null, 2) ?? '';
  } catch {
    return '';
  }
}

export function FlagEditDrawer({
  open,
  initial,
  saving,
  onClose,
  onSave,
}: FlagEditDrawerProps) {
  const { t } = useTranslation();
  const editing = initial !== null;

  const [keyInput, setKeyInput] = useState<string>(initial?.key ?? '');
  const [valueInput, setValueInput] = useState<string>(defaultValueJson(initial));
  const [reason, setReason] = useState<string>('');

  // Re-seed the form whenever the drawer opens with a different flag.
  // Without this the previous flag's value stays visible on the next
  // open and the operator would clobber an unrelated row.
  useEffect(() => {
    if (open) {
      setKeyInput(initial?.key ?? '');
      setValueInput(defaultValueJson(initial));
      setReason('');
    }
  }, [open, initial]);

  const parsed = useMemo<{ ok: boolean; value?: FeatureFlagValue; error?: string }>(() => {
    if (valueInput.trim() === '') {
      return { ok: false, error: t('admin.flags.editor.valueEmpty', 'Value is required.') };
    }
    try {
      return { ok: true, value: JSON.parse(valueInput) as FeatureFlagValue };
    } catch (e) {
      return {
        ok: false,
        error: t('admin.flags.editor.valueInvalid', 'Invalid JSON: {{msg}}', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [valueInput, t]);

  const keyValid = keyInput.trim().length > 0;
  const reasonValid = reason.trim().length > 0;
  const canSave = parsed.ok && keyValid && reasonValid && !saving;

  const handleSave = () => {
    if (!canSave || !parsed.ok) return;
    onSave({ key: keyInput.trim(), value: parsed.value as FeatureFlagValue, reason: reason.trim() });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        editing
          ? t('admin.flags.drawer.editTitle', 'Edit flag "{{key}}"', {
              key: initial?.key ?? '',
            })
          : t('admin.flags.drawer.createTitle', 'Create flag')
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={handleSave}
          >
            {t('admin.flags.drawer.save', 'Save flag')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <GlassPanel className="p-4">
          <div className="space-y-3">
            <Input
              label={t('admin.flags.editor.keyLabel', 'Flag key')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={editing}
              required
              placeholder={t('admin.flags.editor.keyPlaceholder', 'feature.dlq.replay_enabled')}
            />
            {editing && (
              <Text variant="helper" as="p">
                {t(
                  'admin.flags.editor.keyImmutable',
                  'Flag keys are immutable once created. Delete + re-create to rename.',
                )}
              </Text>
            )}
          </div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <Textarea
            label={t('admin.flags.editor.valueLabel', 'Value (JSON)')}
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            rows={8}
            required
            placeholder={'{\n  "enabled": true\n}'}
            error={parsed.ok ? undefined : parsed.error}
          />
        </GlassPanel>

        <GlassPanel className="p-4">
          <Input
            label={t('admin.flags.editor.reasonLabel', 'Reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder={t(
              'admin.flags.editor.reasonPlaceholder',
              'Why this change? (logged in audit)',
            )}
          />
        </GlassPanel>
      </div>
    </Drawer>
  );
}
