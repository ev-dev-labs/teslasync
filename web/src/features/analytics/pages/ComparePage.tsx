import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { KVList } from '@/components/data-display/KVList';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/types/vehicle';

export default function ComparePage() {
  const { t } = useTranslation();
  const { data: vehicles, isLoading, error } = useVehicles();
  const [selected, setSelected] = useState<string[]>([]);

  const toggleVehicle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : prev.length < 3 ? [...prev, id] : prev,
    );
  };

  const selectedVehicles = vehicles?.filter((v) => selected.includes(String(v.id))) ?? [];
  const canCompare = selected.length >= 2;

  return (
    <PageContainer
      title={t('Compare Vehicles')}
      subtitle="Select 2–3 vehicles to compare side by side"
      loading={isLoading}
      error={error as Error | null}
      empty={vehicles?.length === 0}
      emptyMessage="No vehicles available to compare."
    >
      <Card>
        <CardHeader title="Select Vehicles (2–3)" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles?.map((v: Vehicle) => {
            const isSelected = selected.includes(String(v.id));
            const isDisabled = !isSelected && selected.length >= 3;
            return (
              <Button
                key={v.id}
                variant={isSelected ? 'primary' : 'ghost'}
                disabled={isDisabled}
                onClick={() => toggleVehicle(String(v.id))}
                className="justify-start"
              >
                {v.display_name || v.vin}
                {isSelected && <Badge variant="info" className="ml-2">✓</Badge>}
              </Button>
            );
          })}
        </div>
      </Card>

      {canCompare ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Comparison Table" />
            {selectedVehicles.map((v) => (
              <KVList
                key={v.id}
                items={[
                  { label: 'Vehicle', value: v.display_name },
                  { label: 'Model', value: v.model },
                  { label: 'Battery', value: `${v.battery_level}%` },
                  { label: 'Odometer', value: `${(v.odometer ?? 0).toLocaleString()} mi` },
                ]}
                className="mb-4"
              />
            ))}
          </Card>

          <Card>
            <CardHeader title="Visual Comparison" subtitle="Chart placeholder" />
            <div className="flex h-64 items-center justify-center text-sm text-gray-400">
              Radar chart comparing selected vehicles
            </div>
          </Card>
        </div>
      ) : (
        <EmptyState
          message="Select at least 2 vehicles to compare."
          className="mt-6"
        />
      )}
    </PageContainer>
  );
}
