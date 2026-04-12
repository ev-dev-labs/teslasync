import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Grid } from '@/components/layout/Grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AppSettings {
  unit_of_length: string;
  unit_of_temp: string;
  base_cost_per_kwh: number;
  theme: string;
  mode: string;
  gas_price_per_unit: number;
  gas_efficiency_mpg: number;
  decimal_precision: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export default function SettingsPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: () => request<AppSettings>('/settings'),
  });

  const [unitLength, setUnitLength] = useState('km');
  const [unitTemp, setUnitTemp] = useState('C');
  const [costPerKwh, setCostPerKwh] = useState('0');
  const [theme, setTheme] = useState('neon-cyan');

  useEffect(() => {
    if (settings) {
      setUnitLength(settings.unit_of_length || 'km');
      setUnitTemp(settings.unit_of_temp || 'C');
      setCostPerKwh(String(settings.base_cost_per_kwh || 0));
      setTheme(settings.theme || 'neon-cyan');
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<AppSettings>) =>
      request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const handleSave = () => {
    saveMutation.mutate({
      unit_of_length: unitLength,
      unit_of_temp: unitTemp,
      base_cost_per_kwh: parseFloat(costPerKwh) || 0,
      theme,
    });
  };

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Manage your account and preferences')}
      loading={isLoading}
      error={error as Error | null}
    >
      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <Card>
          <CardHeader title={t('Units', 'Units')} subtitle={t('units.subtitle', 'Display preferences')} />
          <div className="space-y-4">
            <Select
              label={t('Distance Unit', 'Distance Unit')}
              options={[
                { value: 'km', label: 'Kilometers (km)' },
                { value: 'mi', label: 'Miles (mi)' },
              ]}
              value={unitLength}
              onChange={(e) => setUnitLength(e.target.value)}
            />
            <Select
              label={t('Temperature Unit', 'Temperature Unit')}
              options={[
                { value: 'C', label: 'Celsius (°C)' },
                { value: 'F', label: 'Fahrenheit (°F)' },
              ]}
              value={unitTemp}
              onChange={(e) => setUnitTemp(e.target.value)}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('Costs', 'Costs')} subtitle={t('costs.subtitle', 'Energy pricing')} />
          <div className="space-y-4">
            <Input
              label={t('Cost per kWh', 'Cost per kWh')}
              type="number"
              value={costPerKwh}
              onChange={(e) => setCostPerKwh(e.target.value)}
              hint={t('costs.hint', 'Used for charging cost calculations')}
            />
            <Select
              label={t('Theme', 'Theme')}
              options={[
                { value: 'neon-cyan', label: 'Neon Cyan' },
                { value: 'neon-green', label: 'Neon Green' },
                { value: 'neon-purple', label: 'Neon Purple' },
              ]}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
          </div>
        </Card>
      </Grid>

      <div className="mt-6">
        <Button loading={saveMutation.isPending} onClick={handleSave}>
          {t('Save Changes', 'Save Changes')}
        </Button>
        {saveMutation.isSuccess && (
          <span className="ml-3 text-sm text-green-500">{t('Saved!', 'Saved!')}</span>
        )}
      </div>
    </PageContainer>
  );
}
