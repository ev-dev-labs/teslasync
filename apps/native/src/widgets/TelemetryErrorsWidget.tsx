import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
} from '../api/hooks';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ListRow } from '../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../components/data/MetricGrid';
import { formatCount, formatDateTime } from '../lib/format';
import { spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';

export function TelemetryErrorsWidget(_props: NativeWidgetProps) {
  const vinsQuery = useFleetTelemetryErrorVINs();
  const errorsQuery = useFleetTelemetryErrors();
  const errorVINs = vinsQuery.data ?? [];
  const errors = errorsQuery.data ?? [];
  const activeVINs = errorVINs.filter(entry => entry.active).length;
  const latestError = errors[0];

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'telemetry-error-vins',
        label: 'Error VINs',
        value: formatCount(errorVINs.length),
        helper: `${formatCount(activeVINs)} active`,
        tone: activeVINs > 0 ? 'warning' : 'success',
        icon: 'bug',
      },
      {
        id: 'telemetry-errors',
        label: 'Errors',
        value: formatCount(errors.length),
        helper: 'Latest telemetry error rows',
        tone: errors.length > 0 ? 'warning' : 'success',
        icon: 'scanSearch',
      },
      {
        id: 'telemetry-dlq',
        label: 'DLQ drill-through',
        value: 'Summary',
        helper: 'Native diagnostics only',
        tone: 'neutral',
        icon: 'database',
      },
    ],
    [activeVINs, errorVINs.length, errors.length],
  );

  return (
    <WidgetCard
      title="Telemetry errors"
      subtitle="Native Fleet Telemetry error monitor without claiming full DLQ drill-through."
      icon="bug"
      testID="widget-telemetry-errors"
      statusLabel={activeVINs > 0 ? 'Attention' : 'Telemetry'}
      statusState={
        vinsQuery.error || errorsQuery.error
          ? 'warning'
          : activeVINs > 0
            ? 'warning'
            : 'online'
      }
      footer="Full DLQ/API-log repair actions stay out of the dashboard; this widget exposes typed telemetry error evidence.">
      {vinsQuery.isLoading && errorsQuery.isLoading ? (
        <WidgetMessage
          title="Loading telemetry errors"
          message="Fetching telemetry error VINs and latest error rows."
          icon="loading"
        />
      ) : vinsQuery.error && errorsQuery.error ? (
        <WidgetMessage
          title="Telemetry error APIs unavailable"
          message="Fleet Telemetry error endpoints could not be loaded."
          icon="warning"
        />
      ) : (
        <View style={styles.content}>
          <MetricGrid items={metrics} minItemWidth={150} />
          <View>
            <KeyValueRow
              label="Latest VIN"
              value={latestError?.vin ?? errorVINs[0]?.vin ?? '-'}
            />
            <KeyValueRow
              label="Latest code"
              value={latestError?.error_code ?? '-'}
            />
            <KeyValueRow
              label="Latest report"
              value={formatDateTime(latestError?.reported_at)}
            />
          </View>
          {latestError ? (
            <ListRow
              title={latestError.error_code ?? 'Telemetry error'}
              subtitle={latestError.error_message ?? 'No error message provided.'}
              meta={formatDateTime(latestError.fetched_at)}
              icon="bug"
            />
          ) : null}
        </View>
      )}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
});
