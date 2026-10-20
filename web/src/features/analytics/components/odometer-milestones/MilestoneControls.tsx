import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Caption, Input } from '@/components/ui';
import type { DistanceUnitPref } from '@/lib/unitConversion';

interface MilestoneControlsProps {
  baseDisplay: number | null;
  distanceUnit: DistanceUnitPref;
  onBaseChange: (value: string) => boolean;
  calibrationKey?: string;
  error?: string;
  disabled?: boolean;
  onCancel?: () => void;
}

export function MilestoneControls({
  baseDisplay,
  distanceUnit,
  onBaseChange,
  calibrationKey,
  error,
  disabled,
  onCancel,
}: MilestoneControlsProps) {
  const { t } = useTranslation();
  const committed = baseDisplay == null ? '' : String(baseDisplay);
  const [state, setState] = useState({
    committed, distanceUnit, calibrationKey, draft: committed, rejected: false,
  });
  const current = state.committed === committed
    && state.distanceUnit === distanceUnit
    && state.calibrationKey === calibrationKey
    ? state
    : { committed, distanceUnit, calibrationKey, draft: committed, rejected: false };
  if (current !== state) setState(current);
  const cancelling = useRef(false);
  const unitLabel =
    distanceUnit === 'mi'
      ? t('milestones.units.mi', 'mi')
      : distanceUnit === 'ft'
        ? t('milestones.units.ft', 'ft')
        : t('milestones.units.km', 'km');

  function commitValue(input: HTMLInputElement): void {
    if (cancelling.current) {
      cancelling.current = false;
      return;
    }
    if (input.value === committed && !current.rejected) return;
    const accepted = onBaseChange(input.value);
    setState((previous) => ({ ...previous, rejected: !accepted }));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelling.current = true;
      setState({ ...current, draft: committed, rejected: false });
      onCancel?.();
      event.currentTarget.blur();
      cancelling.current = false;
    }
  }

  return (
    <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={1}
        label={t(
          'milestones.controls.baseLabel',
          'Window-start odometer',
        )}
        help={{
          content: t(
            'milestones.controls.baseHelpBody',
            'Enter the odometer reading immediately before the first eligible drive in this returned history window.',
          ),
        }}
        aria-label={t(
          'milestones.controls.baseInput',
          'Odometer immediately before the chronologically first eligible returned drive',
        )}
        value={current.draft}
        disabled={disabled}
        error={error || (current.rejected
          ? t('common.invalidNumber', 'Enter a valid number') : undefined)}
        onChange={(event) => setState({ ...current, draft: event.target.value })}
        onBlur={(event) => commitValue(event.currentTarget)}
        onKeyDown={handleKeyDown}
        suffix={<Caption className="whitespace-nowrap">{unitLabel}</Caption>}
        className="max-w-[11rem]"
      />
    </div>
  );
}
