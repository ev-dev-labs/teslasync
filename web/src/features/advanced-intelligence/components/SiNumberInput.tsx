import { forwardRef, type ComponentProps } from 'react';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';

type InputProps = ComponentProps<typeof Input>;

interface SiNumberInputProps extends Omit<InputProps, 'ref' | 'type' | 'value' | 'defaultValue' | 'onChange' | 'label' | 'hint' | 'suffix' | 'min' | 'max' | 'step'> {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  siUnit: string;
  displayHint: string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

const minimumClasses: Record<NonNullable<InputProps['size']>, string> = {
  sm: 'min-h-11 min-w-11 md:min-h-9 md:min-w-0',
  md: 'min-h-11 min-w-11 md:min-h-10 md:min-w-0',
  lg: 'min-h-12 min-w-11 md:min-w-0',
  auto: 'min-h-11 min-w-11 md:min-h-d-row md:min-w-0',
};

export const SiNumberInput = forwardRef<HTMLInputElement, SiNumberInputProps>(({
  label,
  value,
  onChange,
  siUnit,
  displayHint,
  size = 'md',
  className,
  ...props
}, ref) => {
  return (
    <Input
      {...props}
      ref={ref}
      type="number"
      label={label}
      value={value ?? ''}
      size={size}
      className={cn(minimumClasses[size], className)}
      hint={displayHint}
      suffix={<span className="text-xs text-[var(--text-muted)]">{siUnit}</span>}
      onChange={(event) => {
        const next = event.target.value === '' ? null : Number(event.target.value);
        onChange(next != null && Number.isFinite(next) ? next : null);
      }}
    />
  );
});
SiNumberInput.displayName = 'SiNumberInput';
