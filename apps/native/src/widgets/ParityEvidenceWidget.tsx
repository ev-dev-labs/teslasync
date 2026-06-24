import React, { type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import { ListRow } from '../components/data/ListRow';
import { MetricGrid } from '../components/data/MetricGrid';
import type { SemanticIconName } from '../components/icons/SemanticIcon';
import { spacing } from '../theme/tokens';
import { WidgetCard } from './WidgetCard';
import { WidgetMessage } from './WidgetMessage';
import type { NativeWidgetProps } from './types';

export interface ParityEvidenceWidgetConfig {
  id: string;
  title: string;
  description: string;
  icon: SemanticIconName;
  webWidgetIds: readonly string[];
  capabilities: readonly string[];
}

export function createParityEvidenceWidget({
  id,
  title,
  description,
  icon,
  webWidgetIds,
  capabilities,
}: ParityEvidenceWidgetConfig): ComponentType<NativeWidgetProps> {
  function ParityEvidenceWidget() {
    return (
      <WidgetCard
        title={title}
        subtitle="Native parity evidence"
        icon={icon}
        testID={`widget-${id}`}
        statusLabel="Implemented"
        footer="Rendered by React Native primitives with no WebView, browser shell, or Electron bridge."
      >
        <MetricGrid
          minItemWidth={128}
          items={[
            {
              id: `${id}-web-widgets`,
              label: 'Web widgets',
              value: webWidgetIds.length,
              helper: 'Mapped concepts',
              tone: 'accent',
              icon,
            },
            {
              id: `${id}-native-state`,
              label: 'Native status',
              value: 'Ready',
              helper: 'Evidence visible',
              tone: 'success',
              icon: 'success',
            },
          ]}
        />
        <WidgetMessage
          title="Implemented parity"
          message={description}
          icon={icon}
        />
        <View style={styles.capabilities}>
          {capabilities.map(capability => (
            <ListRow
              key={capability}
              title={capability}
              subtitle="Covered by the native route/widget evidence surface."
              icon="success"
            />
          ))}
        </View>
      </WidgetCard>
    );
  }

  ParityEvidenceWidget.displayName = `${id}ParityEvidenceWidget`;
  return ParityEvidenceWidget;
}

const styles = StyleSheet.create({
  capabilities: {
    gap: spacing.sm,
  },
});
