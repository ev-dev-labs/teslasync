import { Input } from '@/components/ui';

interface SiNumberInputProps {
  id?: string;
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

export function SiNumberInput({
  id,
  label,
  value,
  onChange,
  siUnit,
  displayHint,
  min,
  max,
  step,
  required,
}: SiNumberInputProps) {
  return (
    <Input
      id={id}
      type="number"
      label={label}
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      required={required}
      hint={displayHint}
      suffix={<span className="text-xs text-[var(--text-muted)]">{siUnit}</span>}
      onChange={(event) => {
        const next = event.target.value === '' ? null : Number(event.target.value);
        onChange(next != null && Number.isFinite(next) ? next : null);
      }}
    />
  );
}
