import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Toggle } from '../ui/Toggle';

interface Props {
  initialZone: string;
  zoneLabel: string;
  zoneHint: string;
  consentLabel: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: (zone: string) => void;
}

export function PrivateReviewTimeZoneForm({ initialZone, zoneLabel, zoneHint, consentLabel, confirmLabel, disabled, onConfirm }: Props) {
  const [zone, setZone] = useState(initialZone);
  const [confirmed, setConfirmed] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="space-y-3">
      <Input ref={field} size="lg" label={zoneLabel} hint={zoneHint}
        value={zone} maxLength={80} disabled={disabled} onChange={(event) => {
          setZone(event.target.value);
          setConfirmed(false);
        }} />
      <Toggle label={consentLabel} checked={confirmed} onChange={setConfirmed} disabled={disabled} />
      <Button type="button" className="min-h-11" wrapLabel disabled={disabled || !confirmed || zone.trim().length === 0}
        onClick={() => onConfirm(zone.trim())}>{confirmLabel}</Button>
    </div>
  );
}
