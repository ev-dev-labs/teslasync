import React from 'react';
import {View} from 'react-native';

import {ListRow} from '../../components/data/ListRow';
import {
  RouteReadinessPanel,
  type RouteReadinessItem,
} from '../../components/data/RouteReadinessPanel';
import {ScreenSection} from '../../components/data/ScreenSection';
import {parseDeepLink} from '../../platform/deepLinks';
import {spacing} from '../../theme/tokens';

const notFoundRouteItems: RouteReadinessItem[] = [
  {
    id: 'not-found-layout',
    label: 'Layout Not Found route',
    route: '*',
    api: 'native deep-link parser',
    status: 'implemented',
    evidence:
      'Unknown route paths produce an explicit unmatched parser state and stay in the native shell instead of silently embedding the web fallback.',
  },
  {
    id: 'not-found-root',
    label: 'Root Not Found route',
    route: '*',
    api: 'native route manifest',
    status: 'implemented',
    evidence:
      'Root-level fallbacks are represented by System diagnostics and route parity evidence with no browser redirect or fake destination.',
  },
];

export function NotFoundRouteSection() {
  const unmatched = parseDeepLink('teslasync://route-that-does-not-exist');

  return (
    <ScreenSection
      title="Not-found route surfaces"
      subtitle="Wildcard web routes are implemented as explicit native unmatched-route diagnostics."
    >
      <View style={styles.list}>
        <ListRow
          title="Unmatched route state"
          subtitle={unmatched.reason}
          meta={unmatched.implementationStatus}
          icon="warning"
        />
        <ListRow
          title="Fallback route target"
          subtitle="The native shell keeps users in System diagnostics when a path is not matched by the route manifest."
          meta="system"
          icon="server"
        />
      </View>
      <RouteReadinessPanel
        title="R0001 not-found route evidence"
        subtitle="Both wildcard route ids have visible React Native fallback evidence and remain old-web deletion-blocked only by the final parity gate."
        items={notFoundRouteItems}
        testID="r0001-not-found-route-evidence"
      />
    </ScreenSection>
  );
}

const styles = {
  list: {
    gap: spacing.sm,
  },
};
