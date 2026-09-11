import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, Button, Input, Badge, ErrorText } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAdviseChargeQueue } from '@/api/hooks/useCharging';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtNumber } from '@/lib/numberFormat';

interface QueueRow {
  currentSoc: string;
  targetSoc: string;
  readyBy: string;
}

const DEFAULT_ROW: QueueRow = { currentSoc: '40', targetSoc: '80', readyBy: '07:30' };

/**
 * Shared-charger queue planner: one charger, many Teslas. Each vehicle row
 * feeds the least-slack-first advisor; the result is an ordered overnight
 * queue with feasibility per car.
 */
export function ChargeQueuePlanner() {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const advise = useAdviseChargeQueue();

  const [rows, setRows] = useState<Record<number, QueueRow>>({});
  const [chargerKw, setChargerKw] = useState('11');
  const result = advise.data ?? null;

  const cars = vehicles ?? [];
  const rowFor = (id: number): QueueRow => rows[id] ?? DEFAULT_ROW;
  const setRow = (id: number, patch: Partial<QueueRow>) =>
    setRows((prev) => ({ ...prev, [id]: { ...rowFor(id), ...patch } }));

  const handleAdvise = () => {
    const kw = Number(chargerKw);
    if (!Number.isFinite(kw) || kw < 1 || kw > 22) return;
    advise.mutate({
      charger_kw: kw,
      vehicles: cars.map((c) => {
        const row = rowFor(c.id);
        return {
          vehicle_id: c.id,
          current_soc: Number(row.currentSoc),
          target_soc: Number(row.targetSoc),
          ready_by: row.readyBy,
        };
      }),
    });
  };

  const nameFor = (id: number) => cars.find((c) => c.id === id)?.display_name ?? `#${id}`;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('chargeQueue.title', 'Shared-Charger Queue')}
        </PanelTitle>
        {result && (
          <Badge variant={result.all_feasible ? 'success' : 'warning'} size="sm">
            {result.all_feasible
              ? t('chargeQueue.feasible', 'All cars ready on time')
              : t('chargeQueue.tight', 'Queue overruns a ready-by')}
          </Badge>
        )}
      </div>

      {cars.length < 2 ? (
        <EmptyState
          icon={<ListOrdered className="h-8 w-8" />}
          message={t('chargeQueue.singleCar', 'Add a second vehicle to plan a shared-charger queue.')}
        />
      ) : (
        <div className="space-y-3">
          {cars.map((car) => {
            const row = rowFor(car.id);
            return (
              <div key={car.id} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Text as="p" variant="bodySm" className="col-span-2 font-medium sm:col-span-1 sm:self-center">
                  {car.display_name}
                </Text>
                <Input
                  label={t('chargeQueue.current', 'Now %')}
                  type="number"
                  min={0}
                  max={100}
                  value={row.currentSoc}
                  onChange={(e) => setRow(car.id, { currentSoc: e.target.value })}
                />
                <Input
                  label={t('chargeQueue.target', 'Target %')}
                  type="number"
                  min={1}
                  max={100}
                  value={row.targetSoc}
                  onChange={(e) => setRow(car.id, { targetSoc: e.target.value })}
                />
                <Input
                  label={t('chargeQueue.readyBy', 'Ready by')}
                  type="time"
                  value={row.readyBy}
                  onChange={(e) => setRow(car.id, { readyBy: e.target.value })}
                />
              </div>
            );
          })}

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input
                label={t('chargeQueue.chargerKw', 'Charger (kW)')}
                type="number"
                min={1}
                max={22}
                value={chargerKw}
                onChange={(e) => setChargerKw(e.target.value)}
              />
            </div>
            <Button onClick={handleAdvise} disabled={advise.isPending} loading={advise.isPending}>
              {t('chargeQueue.plan', 'Plan queue')}
            </Button>
          </div>

          {advise.isPending ? (
            <Skeleton height={80} />
          ) : advise.isError ? (
            <ErrorText>{(advise.error as Error)?.message || t('chargeQueue.error', 'Queue planning failed')}</ErrorText>
          ) : result ? (
            <div className="space-y-2">
              <Text as="p" variant="bodySm">{result.explanation}</Text>
              <ol className="space-y-1.5">
                {result.slots.map((slot) => (
                  <li key={slot.vehicle_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                    <Badge variant={slot.feasible ? 'neutral' : 'warning'} size="sm">
                      {slot.position}
                    </Badge>
                    <Text variant="bodySm" className="font-medium">{nameFor(slot.vehicle_id)}</Text>
                    <Caption className="ml-auto tabular-nums">
                      {t('chargeQueue.slot', '{{start}}–{{end}} · {{kwh}} kWh · ready {{ready}}', {
                        start: formatTime(slot.start_time),
                        end: formatTime(slot.end_time),
                        kwh: fmtNumber(slot.kwh_needed, 1),
                        ready: formatTime(slot.ready_by),
                      })}
                    </Caption>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </GlassPanel>
  );
}
