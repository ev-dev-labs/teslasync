import { vi } from 'vitest';

vi.mock('@/hooks/useUnits', async () => {
  const { useNumberFormatting } = await import('@/hooks/useNumberFormatting');
  return {
    useUnits: () => {
      const { precision, locale } = useNumberFormatting();
      return { unitPrefs: {
        distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'kPa',
        energy: 'kWh', duration: 'h', power: 'kW', precision, locale,
      } };
    },
  };
});
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
