import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Input, Select, Text } from '@/components/ui';
import type { RecallWatchSetup } from '@/types/recallWatch';

const yearByModel = new Map([
  ['Roadster', 2008], ['Model S', 2012], ['Model X', 2016], ['Model 3', 2017], ['Model Y', 2020], ['Cybertruck', 2024],
]);
const modelOptions = Array.from(yearByModel.keys(), model => ({ value: model, label: model }));

interface Props {
  current: RecallWatchSetup;
  updating: boolean;
  disabled: boolean;
  onSave: (setup: RecallWatchSetup) => void;
  onCancel: () => void;
}

export function RecallWatchForm({ current, updating, disabled, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const [model, setModel] = useState(current.model);
  const [year, setYear] = useState(current.model_year > 0 ? String(current.model_year) : '');
  const [vehicleConfirmed, setVehicleConfirmed] = useState(false);
  const [catalogConfirmed, setCatalogConfirmed] = useState(false);
  const lastYear = new Date().getUTCFullYear() + 1;
  const modelYear = Number(year);
  const firstYear = yearByModel.get(model);
  const ready = vehicleConfirmed && catalogConfirmed && firstYear != null &&
    /^\d{4}$/.test(year) && modelYear >= firstYear && modelYear <= lastYear;

  return (
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (ready && !disabled) onSave({ model, model_year: modelYear });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={t('maintenance.recallWatch.model', 'Tesla model')} options={modelOptions}
          placeholder={t('maintenance.recallWatch.choose', 'Choose the exact model')} required disabled={disabled}
          value={model} onChange={event => { setModel(event.target.value); setVehicleConfirmed(false); }} />
        <Input label={t('maintenance.recallWatch.year', 'Model year')} value={year} type="text" inputMode="numeric"
          required maxLength={4} disabled={disabled}
          onChange={event => { setYear(event.target.value); setVehicleConfirmed(false); }} />
      </div>
      <Checkbox checked={vehicleConfirmed} onChange={setVehicleConfirmed} disabled={disabled}
        label={t('maintenance.recallWatch.confirmModel', 'I verified this model and model year for the selected vehicle.')} />
      <Checkbox checked={catalogConfirmed} onChange={setCatalogConfirmed} disabled={disabled}
        label={t('maintenance.recallWatch.confirmProvider', 'Check the U.S. NHTSA catalog once a day. Send only Tesla, the model and the model year; never send my VIN or driving history.')} />
      {updating && <Text as="p" variant="bodySm">
        {t('maintenance.recallWatch.editHint', 'Saving replaces the previous watch and clears its saved matches.')}
      </Text>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" wrapLabel disabled={!ready || disabled}>
          {t('maintenance.recallWatch.save', 'Save private recall watch')}
        </Button>
        <Button type="button" className="min-h-11" variant="secondary" disabled={disabled} onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  );
}
