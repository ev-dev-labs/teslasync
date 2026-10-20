import { useTranslation } from 'react-i18next';
import { GlassPanel, Heading, Select, Text } from '@/components/ui';
import type { MetricPreferences } from '@/lib/metric-reference';

export interface ReferencePreferencesProps {
  profile: string;
  onProfile: (profile: string) => void;
  preferences: MetricPreferences;
  onPreferences: (preferences: MetricPreferences) => void;
  savedCurrencySymbol: string;
}

export function ReferencePreferences({ profile, onProfile, preferences, onPreferences, savedCurrencySymbol }: ReferencePreferencesProps) {
  const { t } = useTranslation();
  return <GlassPanel className="space-y-3 p-4">
    <Heading>{t('developerReference.stats.preferences.title', 'Local formatting showcase')}</Heading>
    <Text as="p">{t('developerReference.stats.preferences.policy',
      'Chosen candidate policy: preserve saved precision, locale, units, currency and duration. Local demo controls are explicitly opt-in and never save global settings. Workspace date and vehicle controls remain in the application header.')}</Text>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select label={t('developerReference.stats.preferences.profile', 'Preference source')} value={profile}
        options={[
          { value: 'saved', label: t('developerReference.stats.preferences.saved', 'Saved preferences') },
          { value: 'local', label: t('developerReference.stats.preferences.local', 'Opt-in local demonstration') },
        ]} onChange={event => onProfile(event.target.value)} />
      <Select label={t('developerReference.stats.preferences.precision', 'Local precision')}
        disabled={profile === 'saved'} value={String(preferences.units.precision ?? 2)}
        options={[0, 1, 2, 4, 8, 20].map(value => ({ value: String(value), label: String(value) }))}
        onChange={event => onPreferences({ ...preferences, units: { ...preferences.units, precision: Number(event.target.value) } })} />
      <Select label={t('developerReference.stats.preferences.locale', 'Local locale')}
        disabled={profile === 'saved'} value={preferences.units.locale ?? 'en-US'}
        options={['en-US', 'de-DE', 'fr-FR', 'ar-EG'].map(value => ({ value, label: value }))}
        onChange={event => onPreferences({ ...preferences, units: { ...preferences.units, locale: event.target.value } })} />
      <Select label={t('developerReference.stats.preferences.units', 'Local measurement profile')}
        disabled={profile === 'saved'} value={preferences.units.distance === 'mi' ? 'imperial' : 'metric'}
        options={[
          { value: 'metric', label: t('developerReference.stats.preferences.metric', 'Metric units') },
          { value: 'imperial', label: t('developerReference.stats.preferences.imperial', 'Imperial units') },
        ]} onChange={event => onPreferences({ ...preferences, units: { ...preferences.units,
          distance: event.target.value === 'imperial' ? 'mi' : 'km', speed: event.target.value === 'imperial' ? 'mph' : 'km/h',
          temperature: event.target.value === 'imperial' ? '°F' : '°C', pressure: event.target.value === 'imperial' ? 'psi' : 'bar' } })} />
      <Select label={t('developerReference.stats.preferences.duration', 'Local duration unit')}
        disabled={profile === 'saved'} value={preferences.units.duration}
        options={['s', 'min', 'h', 'd'].map(value => ({ value, label: value }))}
        onChange={event => onPreferences({ ...preferences, units: { ...preferences.units,
          duration: event.target.value as MetricPreferences['units']['duration'] } })} />
      <Select label={t('developerReference.stats.preferences.currency', 'Local currency demonstration')}
        disabled={profile === 'saved'} value={preferences.currency.kind === 'iso' ? preferences.currency.value : 'symbol'}
        options={[
          { value: 'symbol', label: t('developerReference.stats.preferences.symbol', 'Existing currency symbol') },
          ...['USD', 'EUR', 'JPY', 'BHD'].map(value => ({ value, label: value })),
        ]} onChange={event => onPreferences({ ...preferences, currency: event.target.value === 'symbol'
          ? { kind: 'symbol', value: savedCurrencySymbol } : { kind: 'iso', value: event.target.value } })} />
    </div>
  </GlassPanel>;
}
