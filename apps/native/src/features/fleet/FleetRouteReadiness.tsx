import React from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionHeader } from '../../components/data/SectionHeader';
import { AppText } from '../../components/ui/AppText';
import { PremiumCard } from '../../components/ui/PremiumCard';
import { StatusPill } from '../../components/ui/StatusPill';
import { colors, spacing } from '../../theme/tokens';

export type FleetRouteReadinessStatus = 'implemented' | 'native-summary' | 'pending';

export interface FleetRouteReadinessItem {
  id: string;
  label: string;
  route: string;
  api: string;
  status: FleetRouteReadinessStatus;
  evidence: string;
}

interface FleetRouteReadinessProps {
  title: string;
  subtitle: string;
  items: FleetRouteReadinessItem[];
}

function statusCopy(status: FleetRouteReadinessStatus) {
  switch (status) {
    case 'implemented':
      return {label: 'Implemented', state: 'online' as const};
    case 'native-summary':
      return {label: 'Native summary', state: 'warning' as const};
    case 'pending':
      return {label: 'Pending', state: 'offline' as const};
  }
}

export function FleetRouteReadiness({title, subtitle, items}: FleetRouteReadinessProps) {
  return (
    <PremiumCard testID="fleet-route-readiness">
      <SectionHeader title={title} subtitle={subtitle} icon="drillThrough" />
      <View style={styles.list}>
        {items.map(item => {
          const status = statusCopy(item.status);

          return (
            <View key={item.id} style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.copy}>
                  <AppText weight="semibold">{item.label}</AppText>
                  <AppText variant="caption" tone="muted">
                    {item.route}
                    {' -> '}
                    {item.api}
                  </AppText>
                </View>
                <StatusPill label={status.label} state={status.state} />
              </View>
              <AppText tone="secondary">{item.evidence}</AppText>
            </View>
          );
        })}
      </View>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
});
