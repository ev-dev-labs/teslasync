import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ListRow } from '../components/data/ListRow';
import type { RouteId } from '../navigation/routes';
import { spacing } from '../theme/tokens';
import type { NativeWidgetProps } from './types';
import { WidgetCard } from './WidgetCard';

const quickNavItems: Array<{
  id: RouteId;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof ListRow>['icon'];
}> = [
  {
    id: 'vehicles',
    title: 'Garage',
    subtitle: 'Vehicle cards, health, model, and Tesla metadata.',
    icon: 'vehicle',
  },
  {
    id: 'charging',
    title: 'Charging',
    subtitle: 'Sessions, energy added, charge power, and live charging state.',
    icon: 'charging',
  },
  {
    id: 'driving',
    title: 'Drives',
    subtitle: 'Recent trips, distance, efficiency, and score metadata.',
    icon: 'drives',
  },
  {
    id: 'system',
    title: 'System',
    subtitle: 'Backend health, telemetry, version, and platform readiness.',
    icon: 'server',
  },
];

export function QuickNavWidget({onNavigate}: NativeWidgetProps) {
  return (
    <WidgetCard
      title="Quick navigation"
      subtitle="Native shortcuts matching the web dashboard quick-nav intent."
      icon="mapPinned"
      testID="widget-quick-nav"
      statusLabel="Shortcuts"
      statusState="online"
      footer={
        onNavigate
          ? 'Tap a shortcut to change the native shell route.'
          : 'The app shell sidebar owns navigation in this parity slice.'
      }>
      <View style={styles.grid}>
        {quickNavItems.map(item => (
          <ListRow
            key={item.id}
            title={item.title}
            subtitle={item.subtitle}
            icon={item.icon}
            meta={item.id}
            onPress={onNavigate ? () => onNavigate(item.id) : undefined}
            accessibilityLabel={`Open ${item.title}`}
          />
        ))}
      </View>
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: spacing.sm,
  },
});

