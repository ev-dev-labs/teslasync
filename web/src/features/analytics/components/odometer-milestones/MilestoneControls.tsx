import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { VehicleSelect } from '@/components/forms';
import { Caption, Input } from '@/components/ui';
import type { DistanceUnitPref } from '@/lib/unitConversion';

interface MilestoneControlsProps {
  baseDisplay: number;
  distanceUnit: DistanceUnitPref;
  onBaseChange: (value: string) => void;
}

export function MilestoneControls({
  baseDisplay,
  distanceUnit,
  onBaseChange,
}: MilestoneControlsProps) {
  const { t } = useTranslation();
  const unitLabel =
    distanceUnit === 'mi'
      ? t('milestones.units.mi', 'mi')
      : distanceUnit === 'ft'
        ? t('milestones.units.ft', 'ft')
        : t('milestones.units.km', 'km');

  function commitValue(input: HTMLInputElement): void {
    const value = input.value.trim();
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed) || parsed < 0) {
      input.value = String(baseDisplay);
      return;
    }
    onBaseChange(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.value = String(baseDisplay);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
      <VehicleSelect />
      <Input
        key={distanceUnit}
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
        defaultValue={baseDisplay}
        onBlur={(event) => commitValue(event.currentTarget)}
        onKeyDown={handleKeyDown}
        suffix={<Caption className="whitespace-nowrap">{unitLabel}</Caption>}
        className="max-w-[11rem]"
      />
    </div>
  );
}
