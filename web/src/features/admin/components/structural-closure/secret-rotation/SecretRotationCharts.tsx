import { ChartCard } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { ChartTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SEVERITY_ORDER, SEVERITY_VARIANT, SEVERITY_HEX, rowKey, truncate } from './helpers';

type Props = { controller: ReturnType<typeof useSecretRotationPage> };

export function SecretRotationCharts({ controller }: Props) {
  const { fmtNumber, t, source, showError, isLoading, severityLabel, counts, topByAge, severitySlices, retry } = controller;

  return (
<FadeIn delay={0.1}>
        <section
          aria-label={t('admin.secretRotation.ageSection', 'Secret age and severity')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="min-w-0 xl:col-span-2">
            <ChartCard size="compact" fluid
              title={t('admin.secretRotation.ageTitle', 'Secret age by kind')}
              ariaLabel={t('admin.secretRotation.ageAria', 'Horizontal bar chart of the oldest tracked secrets by age in days, colored by severity tier')}
              loading={isLoading}
              error={showError ? (source.fatalError ?? undefined) : undefined}
              onRetry={retry}
              empty={!isLoading && !showError && topByAge.length === 0}
              emptyMessage={t('admin.secretRotation.noAgeData', 'No rotation ages to chart yet.')}
              data={topByAge}
              dataColumns={[
                { key: 'label', label: t('admin.secretRotation.colKind', 'Kind') },
                { key: 'age_days', label: t('admin.secretRotation.colAge', 'Age (days)'), format: (v) => v == null ? '—' : `${fmtNumber(Number(v))}d` },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={topByAge} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    tickFormatter={(v) => `${fmtNumber(Number(v))}d`}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={148}
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    tickFormatter={(v) => truncate(String(v))}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(v) => t('admin.secretRotation.daysValue', '{{days}} d', { days: fmtNumber(Number(v)) })}
                  />
                  <Bar
                    dataKey="age_days"
                    name={t('admin.secretRotation.colAge', 'Age (days)')}
                    radius={[0, 4, 4, 0]}
                    fillOpacity={0.9}
                  >
                    {topByAge.map((r) => (
                      <Cell key={rowKey(r)} fill={SEVERITY_HEX[r.severity] ?? SEVERITY_HEX.unknown} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

              <ChartCard size="compact" fluid
                title={t('admin.secretRotation.severityTitle', 'Severity mix')}
                ariaLabel={t('admin.secretRotation.severityAria', 'Donut chart of tracked secrets grouped by rotation severity tier')}
                loading={isLoading}
                error={showError ? (source.fatalError ?? undefined) : undefined}
                onRetry={retry}
                empty={!isLoading && !showError && severitySlices.length === 0}
                emptyMessage={t('admin.secretRotation.noSeverity', 'No severity data available yet.')}
                data={severitySlices}
                dataColumns={[
                  { key: 'label', label: t('admin.secretRotation.col.severity', 'Severity') },
                  { key: 'value', label: t('admin.secretRotation.col.count', 'Count') },
                ]}
                footer={!isLoading && !showError && severitySlices.length > 0 && (
                <ul className="space-y-1.5">
                  {SEVERITY_ORDER.map((key) => (
                    <li key={key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: SEVERITY_HEX[key] }}
                          aria-hidden="true"
                        />
                        <Text variant="bodySm">{severityLabel[key]}</Text>
                      </span>
                      <Badge variant={SEVERITY_VARIANT[key]} size="sm">
                        {fmtNumber(counts[key] ?? 0)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                )}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severitySlices}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {severitySlices.map((s) => (
                        <Cell key={s.key} fill={SEVERITY_HEX[s.key]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
        </section>
      </FadeIn>
  );
}
