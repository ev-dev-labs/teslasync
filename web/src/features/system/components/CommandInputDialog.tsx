import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input, Button, Heading, HelperText } from '@/components/ui';
import type { CommandDef } from '../commands';

interface CommandInputDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  def: CommandDef;
  vehicle?: { display_name: string };
  loading?: boolean;
}

/**
 * A validation failure expressed as a translation instruction rather than a
 * baked English string, so the message renders through i18n at the display
 * boundary. `values` feeds i18next interpolation (e.g. `{{min}}`).
 */
export interface FieldValidationError {
  key: string;
  fallback: string;
  values?: Record<string, number>;
}

export function validateField(
  value: string,
  validation?: string,
  min?: number,
  max?: number,
): FieldValidationError | null {
  const trimmed = value.trim();
  if (!trimmed) return { key: 'commands.input.required', fallback: 'Required' };

  switch (validation) {
    case 'pin':
      return /^\d{4}$/.test(trimmed)
        ? null
        : { key: 'commands.input.pin', fallback: 'Enter a 4-digit PIN' };
    case 'number': {
      const num = parseInt(trimmed, 10);
      if (isNaN(num) || String(num) !== trimmed)
        return { key: 'commands.input.wholeNumber', fallback: 'Enter a whole number' };
      if (min != null && num < min)
        return { key: 'commands.input.min', fallback: 'Minimum: {{min}}', values: { min } };
      if (max != null && num > max)
        return { key: 'commands.input.max', fallback: 'Maximum: {{max}}', values: { max } };
      return null;
    }
    case 'decimal': {
      const num = parseFloat(trimmed);
      if (isNaN(num))
        return { key: 'commands.input.decimal', fallback: 'Enter a valid number' };
      if (min != null && num < min)
        return { key: 'commands.input.min', fallback: 'Minimum: {{min}}', values: { min } };
      if (max != null && num > max)
        return { key: 'commands.input.max', fallback: 'Maximum: {{max}}', values: { max } };
      return null;
    }
    default:
      return null;
  }
}

export function CommandInputDialog({
  open,
  onClose,
  onSubmit,
  def,
  vehicle,
  loading,
}: CommandInputDialogProps) {
  const { t } = useTranslation();
  const ic = def.inputConfig!;
  const fields = ic.fields;
  const firstInputRef = useRef<HTMLInputElement>(null);

  const buildInitialValues = (): Record<string, string> => {
    if (fields) {
      const vals: Record<string, string> = {};
      for (const f of fields) vals[f.name] = '';
      return vals;
    }
    const defaultVal = ic.getDefaultValue
      ? ic.getDefaultValue({ vehicle })
      : ic.defaultValue ?? '';
    return { [ic.paramName]: defaultVal };
  };

  const [values, setValues] = useState<Record<string, string>>(buildInitialValues);
  const [errors, setErrors] = useState<Record<string, FieldValidationError | null>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setValues(buildInitialValues());
      setErrors({});
      setTouched({});
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleChange = (name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
    if (touched[name]) {
      const field = fields?.find(f => f.name === name);
      const v = field?.validation ?? ic.validation;
      const mn = field?.min ?? ic.min;
      const mx = field?.max ?? ic.max;
      setErrors(prev => ({ ...prev, [name]: validateField(value, v, mn, mx) }));
    }
  };

  const handleBlur = (name: string) => {
    setTouched(prev => ({ ...prev, [name]: true }));
    const field = fields?.find(f => f.name === name);
    const v = field?.validation ?? ic.validation;
    const mn = field?.min ?? ic.min;
    const mx = field?.max ?? ic.max;
    setErrors(prev => ({ ...prev, [name]: validateField(values[name] ?? '', v, mn, mx) }));
  };

  const isFormValid = useMemo((): boolean => {
    if (fields) {
      return fields.every(f => validateField(values[f.name] ?? '', f.validation, f.min, f.max) === null);
    }
    return validateField(values[ic.paramName] ?? '', ic.validation, ic.min, ic.max) === null;
  }, [values, fields, ic]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, FieldValidationError | null> = {};
    const newTouched: Record<string, boolean> = {};
    let valid = true;

    if (fields) {
      for (const f of fields) {
        const err = validateField(values[f.name] ?? '', f.validation, f.min, f.max);
        newErrors[f.name] = err;
        newTouched[f.name] = true;
        if (err) valid = false;
      }
    } else {
      const err = validateField(values[ic.paramName] ?? '', ic.validation, ic.min, ic.max);
      newErrors[ic.paramName] = err;
      newTouched[ic.paramName] = true;
      if (err) valid = false;
    }

    setErrors(newErrors);
    setTouched(newTouched);
    if (valid) onSubmit(values);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Translate a validation descriptor at the render boundary so error copy
  // respects the active language (and i18next interpolation for min/max).
  const errorText = (err: FieldValidationError | null | undefined): string | undefined =>
    err ? t(err.key, err.fallback, err.values) : undefined;

  const Icon = def.icon;
  const resolveInputType = (v?: string) =>
    v === 'pin' ? 'password' : 'text';
  const resolveInputMode = (v?: string) =>
    v === 'pin' || v === 'number' ? 'numeric' as const
      : v === 'decimal' ? 'decimal' as const
      : 'text' as const;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      ariaLabel={t(def.labelKey, def.labelFallback)}
      className="bg-[var(--surface-1)] backdrop-blur-xl border border-[var(--border-subtle)]"
    >
      <div onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-xl p-2.5 bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <Heading level="panel" as="h2">
              {t(def.labelKey, def.labelFallback)}
            </Heading>
            <HelperText>
              {t(ic.promptKey, ic.promptFallback)}
            </HelperText>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {fields ? (
            fields.map((field, i) => (
              <Input
                key={field.name}
                ref={i === 0 ? firstInputRef : undefined}
                label={t(field.labelKey, field.labelFallback)}
                placeholder={field.placeholder}
                type={resolveInputType(field.validation)}
                inputMode={resolveInputMode(field.validation)}
                value={values[field.name] ?? ''}
                onChange={e => handleChange(field.name, e.target.value)}
                onBlur={() => handleBlur(field.name)}
                error={touched[field.name] ? errorText(errors[field.name]) : undefined}
                autoComplete="off"
                className="bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            ))
          ) : (
            <Input
              ref={firstInputRef}
              label={def.sublabelFallback ? t(def.sublabelKey ?? '', def.sublabelFallback) : undefined}
              placeholder={ic.defaultValue ?? ''}
              type={resolveInputType(ic.validation)}
              inputMode={resolveInputMode(ic.validation)}
              value={values[ic.paramName] ?? ''}
              onChange={e => handleChange(ic.paramName, e.target.value)}
              onBlur={() => handleBlur(ic.paramName)}
              error={touched[ic.paramName] ? errorText(errors[ic.paramName]) : undefined}
              autoComplete="off"
              className="bg-[var(--surface-2)] border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
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
              type="submit"
              variant="primary"
              size="sm"
              loading={loading}
              disabled={!isFormValid}
              className="bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 border border-neon-cyan/30"
            >
              {t('common.send', 'Send')}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
