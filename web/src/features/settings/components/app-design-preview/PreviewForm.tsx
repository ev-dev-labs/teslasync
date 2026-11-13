import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Checkbox, GlassPanel, Input, PanelTitle, RadioCard, Select, Slider, Text, Textarea, Toggle } from '@/components/ui';

export default function PreviewForm() {
  const { t } = useTranslation('settings');
  const [name, setName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [applied, setApplied] = useState(false);
  const [layout, setLayout] = useState('summary');
  const [choice, setChoice] = useState('loaded');
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(80);
  const [notes, setNotes] = useState('');
  const invalid = attempted && !name.trim();
  return (
    <GlassPanel data-preview-section="form" className="min-w-0 space-y-4 p-4">
      <PanelTitle>{t('theme.appDesignPreview.form', 'Local view options')}</PanelTitle>
      <Text variant="bodySm">{t('theme.appDesignPreview.formHelp', 'Try validation, keyboard focus and selection. Apply updates this sandbox only and is discarded when it closes.')}</Text>
      <form noValidate onSubmit={event => {
        event.preventDefault();
        setAttempted(true);
        setApplied(Boolean(name.trim()));
      }} className="space-y-4">
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Input label={t('theme.appDesignPreview.viewName', 'Sample view name')} value={name}
            onChange={event => { setName(event.target.value); setApplied(false); }} required
            error={invalid ? t('theme.appDesignPreview.nameRequired', 'Enter a name for this local example.') : undefined}
            hint={t('theme.appDesignPreview.nameHint', 'This name is not saved to your account.')} />
          <Input label={t('theme.appDesignPreview.disabledField', 'Disabled source identifier')}
            value={t('theme.appDesignPreview.syntheticSource', 'Synthetic source')} disabled />
          <Select label={t('theme.appDesignPreview.layout', 'Sample layout')} value={layout}
            onChange={event => setLayout(event.target.value)} options={[
              { value: 'summary', label: t('theme.appDesignPreview.summaryLayout', 'Summary first') },
              { value: 'detail', label: t('theme.appDesignPreview.detailLayout', 'Detail first') },
            ]} />
          <Slider label={t('theme.appDesignPreview.threshold', 'Sample review threshold')} value={threshold}
            min={0} max={100} onChange={setThreshold} formatValue={value => `${value}%`} />
        </div>
        <div role="radiogroup" aria-label={t('theme.appDesignPreview.sourceScope', 'Sample source scope')}
          className="grid min-w-0 gap-3 md:grid-cols-2">
          <RadioCard name="preview-source" value="loaded" checked={choice === 'loaded'} onChange={setChoice}
            label={t('theme.appDesignPreview.loaded', 'Loaded examples')} />
          <RadioCard name="preview-source" value="partial" checked={choice === 'partial'} onChange={setChoice}
            label={t('theme.appDesignPreview.includePartial', 'Include partial examples')} />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox checked={checked} onChange={setChecked} label={t('theme.appDesignPreview.showQuality', 'Show source quality')} />
          <Checkbox indeterminate checked={false} readOnly label={t('theme.appDesignPreview.mixed', 'Mixed selection example')} />
          <Toggle checked={enabled} onChange={setEnabled} label={t('theme.appDesignPreview.showContext', 'Show comparison context')} />
          <Toggle checked={false} onChange={() => undefined} disabled label={t('theme.appDesignPreview.liveDisabled', 'Live connection disabled')} />
        </div>
        <Textarea label={t('theme.appDesignPreview.notes', 'Local review notes')} value={notes}
          onChange={event => setNotes(event.target.value)} />
        <div data-app-part="page-actions" className="flex flex-wrap items-center gap-3">
          <Button type="submit">{t('theme.appDesignPreview.applyLocal', 'Apply locally')}</Button>
          <Button disabled variant="secondary">{t('theme.appDesignPreview.saveDisabled', 'Server save disabled')}</Button>
          <Button loading variant="secondary">{t('theme.appDesignPreview.loadingAction', 'Loading example')}</Button>
          {applied && <Badge variant="success" role="status">{t('theme.appDesignPreview.applied', 'Applied in this sandbox only')}</Badge>}
        </div>
      </form>
    </GlassPanel>
  );
}
