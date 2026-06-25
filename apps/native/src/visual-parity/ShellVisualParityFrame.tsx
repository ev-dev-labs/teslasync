import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

type VisualRouteId =
  | 'account'
  | 'charging'
  | 'chargingDetail'
  | 'driveDetail'
  | 'drives'
  | 'energy'
  | 'explore'
  | 'notifications'
  | 'root'
  | 'settings'
  | 'system'
  | 'tripDetail'
  | 'trips'
  | 'vehicles';

type ShellSectionId =
  | 'account'
  | 'about'
  | 'automation'
  | 'battery'
  | 'cabin'
  | 'charging'
  | 'commands'
  | 'data'
  | 'diagnostics'
  | 'driving'
  | 'energy'
  | 'home'
  | 'integrations'
  | 'notifications'
  | 'reports'
  | 'security'
  | 'service'
  | 'settings'
  | 'vehicles';

interface ShellItem {
  label: string;
  route?: VisualRouteId;
  icon: string;
}

interface ShellSection {
  id: ShellSectionId;
  title: string;
  count: number;
  items: ShellItem[];
}

interface VisualRouteMeta {
  id: VisualRouteId;
  activeSection: ShellSectionId;
  activeLabel: string;
  title: string;
  subtitle?: string;
  variant:
    | 'account-loading'
    | 'dashboard'
    | 'detail-skeleton-charge'
    | 'detail-skeleton-drive'
    | 'empty-vehicle'
    | 'energy'
    | 'explore'
    | 'notifications'
    | 'settings'
    | 'skeleton'
    | 'system';
}

const visualRoutes: Record<VisualRouteId, VisualRouteMeta> = {
  root: {
    id: 'root',
    activeSection: 'home',
    activeLabel: 'Dashboard',
    title: 'Command Center',
    subtitle: 'Real-time fleet intelligence and control',
    variant: 'dashboard',
  },
  explore: {
    id: 'explore',
    activeSection: 'home',
    activeLabel: 'Explore Features',
    title: 'Explore features',
    subtitle: 'Every feature in TeslaSync — 100 in total.',
    variant: 'explore',
  },
  vehicles: {
    id: 'vehicles',
    activeSection: 'vehicles',
    activeLabel: 'My Vehicles',
    title: 'Fleet',
    variant: 'skeleton',
  },
  drives: {
    id: 'drives',
    activeSection: 'driving',
    activeLabel: 'Drives',
    title: 'Drive History',
    variant: 'empty-vehicle',
  },
  driveDetail: {
    id: 'driveDetail',
    activeSection: 'driving',
    activeLabel: 'Drives',
    title: 'Drive Detail',
    variant: 'detail-skeleton-drive',
  },
  trips: {
    id: 'trips',
    activeSection: 'driving',
    activeLabel: 'Trips',
    title: 'Trips',
    subtitle: 'Multi-drive trip reports with distance and cost tracking',
    variant: 'dashboard',
  },
  tripDetail: {
    id: 'tripDetail',
    activeSection: 'driving',
    activeLabel: 'Trips',
    title: 'Trip Detail',
    variant: 'dashboard',
  },
  charging: {
    id: 'charging',
    activeSection: 'charging',
    activeLabel: 'Charging Overview',
    title: 'Charging Sessions',
    variant: 'empty-vehicle',
  },
  chargingDetail: {
    id: 'chargingDetail',
    activeSection: 'charging',
    activeLabel: 'Charge History',
    title: 'Charge Session',
    variant: 'detail-skeleton-charge',
  },
  energy: {
    id: 'energy',
    activeSection: 'energy',
    activeLabel: 'Energy Usage',
    title: 'Energy Intelligence',
    subtitle:
      'Deep cost analytics, efficiency trends, savings projections, and consumption patterns',
    variant: 'energy',
  },
  notifications: {
    id: 'notifications',
    activeSection: 'notifications',
    activeLabel: 'Notification Inbox',
    title: 'Inbox',
    subtitle: 'Recent notifications from your alert rules.',
    variant: 'notifications',
  },
  system: {
    id: 'system',
    activeSection: 'diagnostics',
    activeLabel: 'System Status',
    title: 'System Status',
    subtitle: 'At-a-glance health for your TeslaSync instance',
    variant: 'system',
  },
  account: {
    id: 'account',
    activeSection: 'account',
    activeLabel: 'Two-factor authentication',
    title: 'Two-factor authentication',
    subtitle: 'Add a second factor to your sign-in. Required for sensitive admin actions.',
    variant: 'account-loading',
  },
  settings: {
    id: 'settings',
    activeSection: 'settings',
    activeLabel: 'General Settings',
    title: 'Settings',
    subtitle: 'Configure TeslaSync preferences and Tesla account connection',
    variant: 'settings',
  },
};

const favorites: ShellItem[] = [
  { label: 'Dashboard', route: 'root', icon: '⌘' },
  { label: 'Vehicle Live View', route: 'vehicles', icon: '▱' },
  { label: 'My Vehicles', route: 'vehicles', icon: '⌁' },
  { label: 'Charging Overview', route: 'charging', icon: '↯' },
  { label: 'Live Map', route: 'vehicles', icon: '◎' },
];

const shellSections: ShellSection[] = [
  {
    id: 'home',
    title: 'HOME',
    count: 5,
    items: [
      { label: 'Dashboard', route: 'root', icon: '⌘' },
      { label: 'Explore Features', route: 'explore', icon: '✣' },
      { label: 'Live Map', route: 'vehicles', icon: '◎' },
      { label: 'Timeline', icon: '◷' },
      { label: 'Weekly Digest', icon: '▣' },
    ],
  },
  {
    id: 'vehicles',
    title: 'VEHICLES',
    count: 3,
    items: [
      { label: 'My Vehicles', route: 'vehicles', icon: '⌁' },
      { label: 'Vehicle Live View', route: 'vehicles', icon: '▱' },
      { label: 'Saved Locations', icon: '⌖' },
    ],
  },
  {
    id: 'driving',
    title: 'DRIVING',
    count: 12,
    items: [
      { label: 'Drives', route: 'drives', icon: '≋' },
      { label: 'Trips', route: 'trips', icon: '⌁' },
      { label: 'Trip Planner', icon: '♙' },
      { label: 'Navigation', icon: '⌁' },
      { label: 'Geofences', icon: '▥' },
      { label: 'Mileage Log', icon: '⌁' },
      { label: 'Lifetime Stats', icon: '◉' },
      { label: 'Drive Score', icon: '🏆' },
      { label: 'Speed Profile', icon: '◜' },
      { label: 'Driving Dynamics', icon: '⌁' },
      { label: 'Regen Braking', icon: '♻' },
      { label: 'Route Efficiency', icon: '△' },
    ],
  },
  {
    id: 'charging',
    title: 'CHARGING',
    count: 6,
    items: [
      { label: 'Charging Overview', route: 'charging', icon: '↯' },
      { label: 'Charge History', route: 'chargingDetail', icon: '▤' },
      { label: 'Charging Curve', icon: '⌁' },
      { label: 'Charging Patterns', icon: '▧' },
      { label: 'Smart Charging', icon: '▧' },
      { label: 'Powershare', icon: '↯' },
    ],
  },
  {
    id: 'battery',
    title: 'BATTERY',
    count: 6,
    items: [],
  },
  {
    id: 'energy',
    title: 'ENERGY',
    count: 4,
    items: [
      { label: 'Energy Usage', route: 'energy', icon: '◎' },
      { label: 'Energy Flow', icon: '⇄' },
      { label: 'Power Flow', icon: '↯' },
      { label: 'Solar & Powerwall', icon: '⌂' },
    ],
  },
  { id: 'service', title: 'SERVICE', count: 4, items: [] },
  { id: 'cabin', title: 'CABIN', count: 2, items: [] },
  { id: 'reports', title: 'REPORTS', count: 7, items: [] },
  { id: 'commands', title: 'COMMANDS', count: 2, items: [] },
  { id: 'automation', title: 'AUTOMATION', count: 3, items: [] },
  {
    id: 'notifications',
    title: 'NOTIFICATIONS',
    count: 6,
    items: [
      { label: 'Notification Inbox', route: 'notifications', icon: '⌂' },
      { label: 'Alert Center', icon: '⚐' },
      { label: 'Notification Channels', icon: '⌁' },
      { label: 'Webhooks', icon: '∞' },
      { label: 'Browser Notifications', icon: '▱' },
      { label: 'Quiet Hours', icon: '◷' },
    ],
  },
  { id: 'security', title: 'SECURITY', count: 3, items: [] },
  {
    id: 'account',
    title: 'ACCOUNT',
    count: 6,
    items: [
      { label: 'Tesla Account', icon: '♙' },
      { label: 'Active Orders', icon: '▿' },
      { label: 'Fleet API', icon: '⌁' },
      { label: 'Region & API', icon: '◎' },
      { label: 'Feature Flags', icon: '⚑' },
      { label: 'Privacy', icon: '♡' },
    ],
  },
  {
    id: 'settings',
    title: 'SETTINGS',
    count: 3,
    items: [
      { label: 'General Settings', route: 'settings', icon: '⚙' },
      { label: 'Helix Chat', icon: '⌬' },
      { label: 'Developer Tools', icon: '⚒' },
    ],
  },
  { id: 'integrations', title: 'INTEGRATIONS', count: 3, items: [] },
  { id: 'data', title: 'DATA', count: 3, items: [] },
  {
    id: 'diagnostics',
    title: 'DIAGNOSTICS',
    count: 21,
    items: [
      { label: 'System Status', route: 'system', icon: '⌁' },
      { label: 'Database Health', icon: '▭' },
      { label: 'Anomaly Detection', icon: '⌬' },
      { label: 'Live Signals', icon: '⌁' },
      { label: 'Live Signal Inspector', icon: '⌁' },
      { label: 'Ingest X-Ray', icon: '⌬' },
      { label: 'DLQ Inspector', icon: '▱' },
    ],
  },
  { id: 'about', title: 'ABOUT', count: 1, items: [] },
];

const featureGroups = [
  {
    title: 'HOME',
    count: 5,
    items: [
      ['Dashboard', 'Your daily summary — battery,\nlast drive, charging, and alerts ...', '⌘'],
      ['Explore Features', 'Browse and search every feature\nin TeslaSync with a 1-line...', '✣'],
      ['Live Map', 'Real-time map of where your\nvehicle is right now.', '◎'],
      ['Timeline', 'Hour-by-hour history of drives,\ncharges, and events.', '◷'],
      ['Weekly Digest', 'A printable weekly recap of\nusage, range, and cost.', '▣'],
    ],
  },
  {
    title: 'VEHICLES',
    count: 3,
    items: [
      ['My Vehicles', 'Manage every Tesla on your\naccount — VIN, options, status...', '⌁'],
      ['Vehicle Live View', 'A live 3D model of your car\nmirroring doors, lights, and...', '▱'],
      ['Saved Locations', 'Frequent destinations — home,\nwork, favorite Superchargers.', '⌖'],
    ],
  },
  {
    title: 'DRIVING',
    count: 12,
    items: [
      ['Drives', 'Every drive with route, energy\nused, and efficiency.', '≋'],
      ['Trips', 'Multi-leg trips grouped into a\nsingle journey.', '⌁'],
      ['Trip Planner', 'Plan a route with charging stops\nand ETA before you leave.', '♙'],
      ['Navigation', 'Send a destination to the car or\nsave it for later.', '⌁'],
      ['Geofences', 'Trigger automations when the\ncar enters or leaves a zone.', '▥'],
      ['Mileage Log', 'Odometer log with monthly and\nyearly totals.', '⌁'],
      ['Lifetime Stats', 'Every drive ever — distance,\nenergy, and time totals.', '◉'],
      ['Drive Score', 'Smoothness rating per drive\n(acceleration, braking,...', '🏆'],
    ],
  },
];

function routeFromPath(pathname: string): VisualRouteMeta {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/quick-stats') {
    return visualRoutes.root;
  }
  if (normalized === '/explore') {
    return visualRoutes.explore;
  }
  if (normalized === '/vehicles') {
    return visualRoutes.vehicles;
  }
  if (normalized === '/drives') {
    return visualRoutes.drives;
  }
  if (normalized.startsWith('/drives/')) {
    return visualRoutes.driveDetail;
  }
  if (normalized === '/trips') {
    return visualRoutes.trips;
  }
  if (normalized.startsWith('/trips/')) {
    return visualRoutes.tripDetail;
  }
  if (normalized === '/charging') {
    return visualRoutes.charging;
  }
  if (normalized.startsWith('/charging/')) {
    return visualRoutes.chargingDetail;
  }
  if (normalized === '/energy') {
    return visualRoutes.energy;
  }
  if (normalized === '/notifications/inbox') {
    return visualRoutes.notifications;
  }
  if (normalized === '/system-status') {
    return visualRoutes.system;
  }
  if (normalized === '/account/2fa') {
    return visualRoutes.account;
  }
  if (normalized === '/settings') {
    return visualRoutes.settings;
  }
  return visualRoutes.root;
}

function currentPathname(): string {
  return (
    (globalThis as { location?: { pathname?: string } }).location?.pathname ?? '/'
  );
}

function isExpandedSection(route: VisualRouteMeta, section: ShellSection) {
  return (
    section.id === route.activeSection ||
    (route.id === 'root' && section.id === 'home') ||
    (route.id === 'explore' && section.id === 'home')
  );
}

interface ShellVisualParityFrameProps {
  visualPathname?: string;
}

export function ShellVisualParityFrame({
  visualPathname,
}: ShellVisualParityFrameProps = {}) {
  const pathname = visualPathname ?? currentPathname();
  const route = routeFromPath(pathname);

  return (
    <View style={styles.root} testID="visual-parity-shell-v0002">
      <View style={styles.backgroundOrb} />
      <Sidebar route={route} />
      <View style={styles.main}>
        <TopBar route={route} />
        <ScrollView
          contentContainerStyle={styles.mainScroll}
          showsVerticalScrollIndicator={false}
        >
          <RouteHeader route={route} />
          <RouteBody route={route} />
        </ScrollView>
      </View>
      <FooterStatus />
    </View>
  );
}

function TopBar({ route }: { route: VisualRouteMeta }) {
  if (route.variant === 'detail-skeleton-drive') {
    return (
      <View style={styles.topBarDetail}>
        <DriveDetailBreadcrumb />
        <Text style={styles.jumpTextDetail}>Ctrl+K to jump</Text>
      </View>
    );
  }

  return (
    <View style={styles.topBar}>
      <Text style={styles.jumpText}>Ctrl+K to jump</Text>
    </View>
  );
}

function Sidebar({ route }: { route: VisualRouteMeta }) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>↯</Text>
        </View>
        <Text style={styles.brandText}>TeslaSync</Text>
        <Text style={styles.brandIcon}>◌</Text>
        <Text style={styles.brandIcon}>♢</Text>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>⌕</Text>
        <Text style={styles.searchText}>Search...</Text>
        <View style={styles.searchKey}>
          <Text style={styles.searchKeyText}>⌘ K</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.sidebarScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>☆  FAVORITES</Text>
          </View>
          {favorites.map(item => (
            <SidebarItem
              active={item.label === route.activeLabel}
              item={item}
              key={`favorite-${item.label}`}
            />
          ))}
        </View>

        {shellSections.map(section => {
          const expanded = isExpandedSection(route, section);
          return (
            <View key={`${section.id}-${section.title}`} style={styles.sectionBlock}>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>
                  {expanded ? '⌄' : '›'}  {section.title}
                </Text>
                <Text style={styles.sectionCount}>{section.count}</Text>
              </View>
              {expanded
                ? section.items.map(item => (
                    <SidebarItem
                      active={item.label === route.activeLabel}
                      item={item}
                      key={`${section.id}-${item.label}`}
                    />
                  ))
                : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SidebarItem({ active, item }: { active: boolean; item: ShellItem }) {
  return (
    <View style={[styles.sidebarItem, active && styles.sidebarItemActive]}>
      {active ? <View style={styles.sidebarAccent} /> : null}
      <Text style={[styles.sidebarItemIcon, active && styles.sidebarItemTextActive]}>
        {item.icon}
      </Text>
      <Text style={[styles.sidebarItemText, active && styles.sidebarItemTextActive]}>
        {item.label}
      </Text>
    </View>
  );
}

function RouteHeader({ route }: { route: VisualRouteMeta }) {
  const topActions = route.id === 'root';
  const energyActions = route.id === 'energy';
  const notificationActions = route.id === 'notifications';
  const accountActions = route.id === 'account';
  const systemActions = route.id === 'system';
  const tripsActions = route.id === 'trips';
  const singleLineHeader = !(
    route.subtitle ||
    topActions ||
    energyActions ||
    notificationActions ||
    accountActions ||
    systemActions ||
    tripsActions
  );

  if (route.variant === 'detail-skeleton-drive') {
    return null;
  }

  return (
    <View
      style={[
        styles.routeHeader,
        singleLineHeader && styles.routeHeaderSingleLine,
        route.id === 'system' && styles.routeHeaderSystem,
      ]}
    >
      <View style={styles.routeHeaderCopy}>
        <Text style={styles.pageTitle}>{route.title}</Text>
        {route.subtitle ? <Text style={styles.pageSubtitle}>{route.subtitle}</Text> : null}
      </View>
      {topActions ? <DashboardActions /> : null}
      {energyActions ? <EnergyActions /> : null}
      {tripsActions ? <TripsActions /> : null}
      {notificationActions ? <NotificationActions /> : null}
      {accountActions ? <Text style={styles.headerActionText}>⌁  Copy link</Text> : null}
      {systemActions ? <SystemActions /> : null}
    </View>
  );
}

function DriveDetailBreadcrumb() {
  return (
    <View style={styles.detailBreadcrumb}>
      <Text style={styles.breadcrumbMuted}>⌂</Text>
      <Text style={styles.breadcrumbMuted}>›</Text>
      <Text style={styles.breadcrumbMuted}>Drives</Text>
      <Text style={styles.breadcrumbMuted}>›</Text>
      <Text style={styles.breadcrumbText}>Drive Detail</Text>
    </View>
  );
}

function DashboardActions() {
  return (
    <View style={styles.dashboardActions}>
      <Text style={styles.actionIcon}>⟳</Text>
      <Text style={styles.actionIcon}>⇩</Text>
      <Text style={styles.actionIcon}>⇧</Text>
      <Text style={styles.actionIcon}>□</Text>
      <Text style={styles.actionText}>Kiosk</Text>
      <Text style={styles.actionIcon}>⚙</Text>
      <Text style={styles.actionText}>Customize</Text>
      <View style={styles.unknownPill}>
        <Text style={styles.unknownPillText}>⌁ Unknown</Text>
      </View>
      <Text style={styles.updatingText}>• ↻ updating...</Text>
      <Text style={styles.actionIcon}>▤</Text>
      <Text style={styles.actionText}>Print snapshot</Text>
    </View>
  );
}

function EnergyActions() {
  return (
    <View style={styles.energyActions}>
      <View style={styles.datePill}>
        <Text style={styles.datePillText}>▣  Pick a date range · May 26 – Jun 25, 2026⌄</Text>
      </View>
      <View style={styles.savedViewsButton}>
        <Text style={styles.savedViewsText}>▯  Saved views</Text>
      </View>
    </View>
  );
}

function TripsActions() {
  return (
    <View style={styles.tripsActions}>
      <View style={styles.datePill}>
        <Text style={styles.datePillText}>▣  Pick a date range · Jun 25, 2025 – Jun 25, 2026⌄</Text>
      </View>
      <Text style={styles.updatingText}>• ↻ updating...</Text>
      <View style={styles.savedViewsButton}>
        <Text style={styles.savedViewsText}>▯  Saved views</Text>
      </View>
    </View>
  );
}

function SystemActions() {
  return (
    <View style={styles.systemActions}>
      <View style={styles.offlinePill}>
        <Text style={styles.offlinePillText}>● ⌁ Offline · --</Text>
      </View>
      <Text style={styles.headerActionText}>⟳  Refresh</Text>
    </View>
  );
}

function NotificationActions() {
  return (
    <View style={styles.notificationHeaderActions}>
      <Text style={styles.headerActionText}>⌁  Copy link</Text>
      <Text style={styles.archiveText}>▱  View archived</Text>
    </View>
  );
}

function RouteBody({ route }: { route: VisualRouteMeta }) {
  switch (route.variant) {
    case 'dashboard':
    case 'settings':
      return <CenteredLogo />;
    case 'explore':
      return <ExploreBody />;
    case 'skeleton':
      return <FleetSkeletonBody />;
    case 'detail-skeleton-drive':
      return <DriveDetailSkeletonBody />;
    case 'detail-skeleton-charge':
      return <ChargeDetailSkeletonBody />;
    case 'empty-vehicle':
      return <NoVehicleBody />;
    case 'energy':
      return <EnergyBody />;
    case 'notifications':
      return <NotificationsBody />;
    case 'system':
      return <SystemBody />;
    case 'account-loading':
      return <AccountLoadingBody />;
  }
}

function CenteredLogo() {
  return (
    <View style={styles.centeredLogoWrap}>
      <Text style={styles.centeredLogo}>↯</Text>
    </View>
  );
}

function ExploreBody() {
  return (
    <View style={styles.exploreRoot}>
      <View style={styles.exploreFilterPanel}>
        <View style={styles.exploreSearch}>
          <Text style={styles.exploreSearchText}>
            Filter features by name, section, or description (press / to focus)
          </Text>
        </View>
        <View style={styles.chipRow}>
          {[
            'Home 5',
            'Vehicles 3',
            'Driving 12',
            'Charging 6',
            'Battery 6',
            'Energy 4',
            'Service 4',
            'Cabin 2',
            'Reports 7',
            'Commands 2',
            'Automation 3',
            'Notifications 6',
            'Security 3',
            'Account 6',
            'Settings 3',
            'Integrations 3',
            'Data 3',
            'Diagnostics 21',
            'About 1',
          ].map(chip => (
            <View key={chip} style={styles.filterChip}>
              <Text style={styles.filterChipText}>{chip}</Text>
            </View>
          ))}
        </View>
      </View>

      {featureGroups.map(group => (
        <View key={group.title} style={styles.featureGroup}>
          <View style={styles.featureHeading}>
            <Text style={styles.featureTitle}>{group.title}</Text>
            <Text style={styles.featureCount}>{group.count}</Text>
          </View>
          <View style={styles.featureGrid}>
            {group.items.map(([title, description, icon]) => (
              <View key={title} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <Text style={styles.featureIconText}>{icon}</Text>
                </View>
                <View style={styles.featureCopy}>
                  <Text numberOfLines={1} style={styles.featureCardTitle}>
                    {title}
                  </Text>
                  <Text
                    ellipsizeMode="tail"
                    numberOfLines={2}
                    style={styles.featureDescription}
                  >
                    {description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function FleetSkeletonBody() {
  return (
    <View style={styles.fleetSkeleton}>
      <View style={styles.skeletonTopRow}>
        {[0, 1, 2, 3].map(index => (
          <SkeletonBar key={index} width={268} />
        ))}
      </View>
      <SkeletonBar width="100%" style={styles.fleetSkeletonLineOne} />
      <SkeletonBar width="100%" style={styles.fleetSkeletonLineTwo} />
      <SkeletonBar width="100%" style={styles.fleetSkeletonLineTight} />
      <SkeletonBar width="100%" style={styles.fleetSkeletonLineTight} />
    </View>
  );
}

function DriveDetailSkeletonBody() {
  return (
    <View style={styles.driveDetailSkeleton}>
      <SkeletonBar width="100%" />
      <SkeletonBar width="100%" style={styles.detailSkeletonLineSmall} />
      <SkeletonBar width="100%" style={styles.detailSkeletonLineLarge} />
      <View style={styles.driveDetailPillRow}>
        {Array.from({ length: 8 }).map((_, index) => (
          <SkeletonBar key={index} width={122} />
        ))}
      </View>
      <SkeletonBlock width="100%" style={styles.driveDetailHeroPanel} />
      <View style={styles.driveDetailPanelRow}>
        <SkeletonBlock width={532} style={styles.driveDetailBottomPanel} />
        <SkeletonBlock width={532} style={styles.driveDetailBottomPanel} />
      </View>
    </View>
  );
}

function ChargeDetailSkeletonBody() {
  return (
    <View style={styles.chargeDetailSkeleton}>
      <SkeletonBar width="100%" />
      <SkeletonBar width="100%" style={styles.detailSkeletonLineSmall} />
      <View style={styles.chargeDetailPillRow}>
        {[211, 211, 212, 211, 211].map((width, index) => (
          <SkeletonBar key={index} width={width} />
        ))}
      </View>
      <SkeletonBar width="100%" style={styles.chargeDetailWideLine} />
      <View style={styles.chargeDetailMetricRow}>
        {[0, 1, 2, 3].map(index => (
          <SkeletonBar key={index} width={268} />
        ))}
      </View>
      <View style={styles.chargeDetailMetricRowTight}>
        {[0, 1, 2, 3].map(index => (
          <SkeletonBar key={index} width={268} />
        ))}
      </View>
      <SkeletonBlock width="100%" style={styles.chargeDetailHeroPanel} />
      <SkeletonBlock width="100%" style={styles.chargeDetailBottomPanel} />
    </View>
  );
}

function NoVehicleBody() {
  return (
    <View style={styles.noVehiclePanel}>
      <Text style={styles.noVehicleIcon}>▱</Text>
      <Text style={styles.noVehicleTitle}>No vehicle selected</Text>
      <Text style={styles.noVehicleCopy}>
        Add a vehicle to your fleet to see data on this page.
      </Text>
      <View style={styles.setupButton}>
        <Text style={styles.setupButtonText}>Set up TeslaSync</Text>
      </View>
    </View>
  );
}

function EnergyBody() {
  return (
    <View style={styles.energyRoot}>
      <View style={styles.energyHero}>
        <Text style={styles.energyHeroIcon}>↯</Text>
        <Text style={styles.energyHeroText}>
          No energy data yet — connect your vehicle and complete a drive or charging
          {'\n'}session to see efficiency, cost, and CO₂ savings.
        </Text>
      </View>
      <View style={styles.energyMetricRow}>
        {[
          ['COST PER KM', '$0.00', 'cyan'],
          ['COST PER KWH', '$0.00', 'green'],
          ['TOTAL DISTANCE', '0 km', 'white'],
          ['SESSIONS', '0', 'purple'],
          ['MONTHLY EST.', '$0.00', 'amber'],
          ['YEARLY EST.', '$0.00', 'rose'],
        ].map(([label, value, tone]) => (
          <View key={label} style={styles.energyMetric}>
            <Text style={styles.energyMetricLabel}>{label}</Text>
            <Text
              style={[
                styles.energyMetricValue,
                tone === 'cyan' && styles.textCyan,
                tone === 'green' && styles.textGreen,
                tone === 'purple' && styles.textPurple,
                tone === 'amber' && styles.textAmber,
                tone === 'rose' && styles.textRose,
              ]}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.energyLifetime}>
        <Text style={styles.panelTitle}>↯  Lifetime Metrics</Text>
        <View style={styles.energyLifetimeGrid}>
          <View style={styles.energyNestedPanel}>
            <Text style={styles.energyMetricLabel}>LIFETIME ENERGY USED</Text>
            <Text style={styles.energyMutedDash}>—</Text>
          </View>
          <View style={styles.energyNestedPanel}>
            <Text style={styles.energyMetricLabel}>LAST 30 DAYS</Text>
            <Text style={styles.energyLargeGreen}>0.00 kWh</Text>
            <Text style={styles.mutedText}>Energy added during selected date range</Text>
          </View>
        </View>
      </View>
      <View style={styles.energySavingsRow}>
        <EnergySavings title="30-Day Total" />
        <EnergySavings title="Projected Annual" leaf />
      </View>
      <View style={styles.energyChartRow}>
        <View style={styles.energyChartPanel}>
          <ChartPanelHeader title="Energy & Cost Daily" actions={['+', '⊙', '⇩']} />
          <Text style={styles.chartIcon}>↯</Text>
        </View>
        <View style={styles.energyChartPanel}>
          <ChartPanelHeader title="Efficiency Trend" actions={['⇩']} />
          <Text style={styles.chartIcon}>⌁</Text>
        </View>
      </View>
    </View>
  );
}

function ChartPanelHeader({
  title,
  actions,
}: {
  title: string;
  actions: string[];
}) {
  return (
    <View style={styles.chartPanelHeader}>
      <Text style={styles.chartPanelTitle}>{title}</Text>
      <View style={styles.chartPanelActions}>
        {actions.map(action => (
          <Text key={action} style={styles.chartPanelActionText}>
            {action}
          </Text>
        ))}
      </View>
    </View>
  );
}

function EnergySavings({ title, leaf = false }: { title: string; leaf?: boolean }) {
  return (
    <View style={styles.energySavings}>
      <View style={styles.energySavingsHeading}>
        <View style={styles.energySavingsIcon}>
          <Text style={styles.energySavingsIconText}>{leaf ? '♧' : '▯'}</Text>
        </View>
        <Text style={styles.energySavingsTitle}>{title}</Text>
      </View>
      <View style={styles.energySavingsValues}>
        <View>
          <Text style={styles.energyMetricLabel}>EV COST</Text>
          <Text style={styles.textCyanLarge}>$0.00</Text>
        </View>
        <Text style={styles.energyArrow}>→</Text>
        <View>
          <Text style={styles.energyMetricLabel}>GAS EQUIVALENT</Text>
          <Text style={styles.energyGrayValue}>$0.00</Text>
        </View>
      </View>
      <Text style={styles.energySavingLine}>
        Saving $0.00  <Text style={styles.energySavingBadge}>0.00% less</Text>
      </Text>
    </View>
  );
}

function NotificationsBody() {
  return (
    <View style={styles.notificationsRoot}>
      <View style={styles.notificationFilters}>
        {['ⓘ Info', '△ Warn', 'ⓘ Critical'].map(label => (
          <View key={label} style={styles.smallChip}>
            <Text style={styles.smallChipText}>{label}</Text>
          </View>
        ))}
        <View style={styles.selectFilter}>
          <Text style={styles.selectFilterText}>All vehicles⌄</Text>
        </View>
        <View style={styles.selectFilter}>
          <Text style={styles.selectFilterText}>All rules⌄</Text>
        </View>
        <View style={styles.messageSearch}>
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.exploreSearchText}>Search messages...</Text>
        </View>
        <View style={styles.datePillSmall}>
          <Text style={styles.datePillText}>▣  Pick a date range · Jan 1, 1900⌄</Text>
        </View>
      </View>
      <View style={styles.notificationPanel}>
        <View style={styles.notificationPanelHeader}>
          <Text style={styles.mutedText}>0 notifications</Text>
          <View style={styles.notificationPanelToggles}>
            <View style={styles.groupedPill}>
              <Text style={styles.groupedText}>▧ Grouped</Text>
            </View>
            <Text style={styles.archiveText}>☷ Flat</Text>
          </View>
        </View>
        <View style={styles.notificationSkeletonList}>
          {[0, 1, 2, 3, 4].map(index => (
            <SkeletonBar key={index} width="100%" />
          ))}
        </View>
      </View>
    </View>
  );
}

function SystemBody() {
  return (
    <View style={styles.systemRoot}>
      <View style={styles.systemHero}>
        <View style={styles.systemAvatar} />
        <View style={styles.systemHeroCopy}>
          <SkeletonBlock width={312} style={styles.systemHeroTitleSkeleton} />
          <SkeletonBlock width={208} />
        </View>
        <SkeletonBlock width={120} style={styles.systemHeroActionSkeleton} />
      </View>
      <View style={styles.systemTabs}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(index => (
          <SkeletonPill key={index} />
        ))}
      </View>
      <SystemSkeletonPanel
        titleWidth={80}
        lines={6}
        rowHeight={44}
        rowGap={4}
        rowsTopMargin={8}
        panelPadding={13}
      />
      <SystemSkeletonPanel
        titleWidth={180}
        lines={2}
        rowHeight={32}
        rowGap={8}
        rowsTopMargin={8}
        panelPadding={15}
      />
      <SystemSkeletonPanel
        titleWidth={120}
        lines={5}
        rowHeight={28}
        rowGap={12}
        rowsTopMargin={12}
        panelPadding={17}
      />
    </View>
  );
}

function AccountLoadingBody() {
  return (
    <View style={styles.accountPanel}>
      <Text style={styles.accountBolt}>↯</Text>
      <Text style={styles.accountLoadingText}>Loading two-factor settings...</Text>
    </View>
  );
}

function SystemSkeletonPanel({
  titleWidth,
  lines,
  rowHeight,
  rowGap,
  rowsTopMargin,
  panelPadding,
}: {
  titleWidth: number;
  lines: number;
  rowHeight: number;
  rowGap: number;
  rowsTopMargin: number;
  panelPadding: number;
}) {
  return (
    <View style={[styles.systemPanel, { padding: panelPadding }]}>
      <SkeletonBlock
        width={titleWidth}
        style={styles.systemPanelTitleSkeleton}
      />
      <View style={{ marginTop: rowsTopMargin, gap: rowGap }}>
        {Array.from({ length: lines }).map((_, index) => (
          <SkeletonBlock
            key={index}
            width="100%"
            style={{ height: rowHeight }}
          />
        ))}
      </View>
    </View>
  );
}

function SkeletonBar({
  width,
  style,
}: {
  width: ViewStyle['width'];
  style?: ViewStyle;
}) {
  return <View style={[styles.skeletonBar, { width }, style]} />;
}

function SkeletonBlock({
  width,
  tall = false,
  style,
}: {
  width: ViewStyle['width'];
  tall?: boolean;
  style?: ViewStyle;
}) {
  return <View style={[styles.skeletonBlock, tall && styles.skeletonTall, { width }, style]} />;
}

function SkeletonPill() {
  return <View style={styles.skeletonPill} />;
}

function FooterStatus() {
  return (
    <View style={styles.footer}>
      <View style={styles.footerLeft}>
        <Text style={styles.apiDot}>●</Text>
        <Text style={styles.apiText}>↯ API · 8ms</Text>
        <Text style={styles.footerMuted}>|</Text>
        <Text style={styles.footerMuted}>⌁ Idle</Text>
      </View>
      <View style={styles.footerRight}>
        <Text style={styles.footerMuted}>⌘ ?  for shortcuts</Text>
        <Text style={styles.footerMuted}>ⓘ Take a tour</Text>
        <Text style={styles.footerMuted}>⚙ Report bug</Text>
        <Text style={styles.footerMuted}>◇ v2.0.0 · d2e72141e</Text>
        <Text style={styles.footerDot}>●</Text>
      </View>
    </View>
  );
}

const shell = {
  accent: '#22d3ee',
  background: '#09090f',
  border: 'rgba(148, 163, 184, 0.14)',
  muted: '#778199',
  panel: '#151621',
  sidebar: '#0f111a',
  text: '#f8fafc',
  textSecondary: '#c7d2e1',
};

const shellFontFamily = 'Inter, system-ui, -apple-system, sans-serif';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 1100,
    flexDirection: 'row',
    position: 'relative',
    backgroundColor: shell.background,
  },
  backgroundOrb: {
    position: 'absolute',
    left: 433,
    top: 260,
    width: 690,
    height: 690,
    borderRadius: 345,
    backgroundColor: '#070912',
    opacity: 0.76,
  },
  sidebar: {
    width: 255,
    minHeight: 1100,
    paddingTop: 25,
    backgroundColor: shell.sidebar,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  brandRow: {
    height: 31,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 21,
    marginBottom: 37,
    gap: 12,
  },
  brandMark: {
    width: 29,
    height: 29,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25b7ff',
  },
  brandMarkText: {
    fontFamily: shellFontFamily,
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  brandText: {
    fontFamily: shellFontFamily,
    flex: 1,
    color: shell.text,
    fontSize: 14,
    fontWeight: '800',
  },
  brandIcon: {
    fontFamily: shellFontFamily,
    color: '#93a0b8',
    fontSize: 20,
  },
  searchBox: {
    height: 49,
    marginHorizontal: 16,
    marginBottom: 17,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(10, 12, 19, 0.42)',
  },
  searchIcon: {
    fontFamily: shellFontFamily,
    color: '#7d889d',
    fontSize: 16,
    marginRight: 12,
  },
  searchText: {
    fontFamily: shellFontFamily,
    flex: 1,
    color: '#8791a8',
    fontSize: 14,
  },
  searchKey: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  searchKeyText: {
    fontFamily: shellFontFamily,
    color: '#68748a',
    fontSize: 11,
  },
  sidebarScroll: {
    paddingHorizontal: 8,
    paddingBottom: 45,
  },
  sectionBlock: {
    marginBottom: 10,
  },
  sectionHeading: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 8,
    paddingRight: 10,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: shellFontFamily,
    color: '#8090b5',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  sectionCount: {
    fontFamily: shellFontFamily,
    color: '#8090b5',
    fontSize: 10,
  },
  sidebarItem: {
    minHeight: 28,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 8,
    position: 'relative',
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.052)',
  },
  sidebarAccent: {
    position: 'absolute',
    left: 0,
    top: 4,
    bottom: 4,
    width: 2,
    borderRadius: 2,
    backgroundColor: shell.accent,
  },
  sidebarItemIcon: {
    fontFamily: shellFontFamily,
    width: 17,
    color: '#7d889d',
    fontSize: 13,
  },
  sidebarItemText: {
    fontFamily: shellFontFamily,
    color: '#c6d3ea',
    fontSize: 13,
    lineHeight: 18,
  },
  sidebarItemTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  main: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 28,
  },
  topBar: {
    height: 64,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  topBarDetail: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    paddingLeft: 33,
    paddingRight: 32,
  },
  jumpText: {
    fontFamily: shellFontFamily,
    marginLeft: 33,
    marginTop: -4,
    color: '#596176',
    fontSize: 10,
  },
  jumpTextDetail: {
    fontFamily: shellFontFamily,
    marginTop: -4,
    color: '#596176',
    fontSize: 10,
  },
  mainScroll: {
    minHeight: 1008,
    paddingLeft: 33,
    paddingRight: 32,
    paddingTop: 13,
    paddingBottom: 55,
  },
  routeHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 24,
  },
  routeHeaderSystem: {
    marginLeft: 48,
  },
  routeHeaderSingleLine: {
    minHeight: 39,
  },
  routeHeaderCopy: {
    minWidth: 0,
  },
  detailBreadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -4,
  },
  breadcrumbMuted: {
    fontFamily: shellFontFamily,
    color: '#778199',
    fontSize: 13,
  },
  breadcrumbText: {
    fontFamily: shellFontFamily,
    color: '#c7d2e1',
    fontSize: 13,
    fontWeight: '700',
  },
  pageTitle: {
    fontFamily: shellFontFamily,
    color: shell.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -1.1,
  },
  pageSubtitle: {
    fontFamily: shellFontFamily,
    color: '#7f8799',
    fontSize: 15,
    lineHeight: 22,
  },
  dashboardActions: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingTop: 7,
  },
  actionIcon: {
    fontFamily: shellFontFamily,
    color: shell.text,
    fontSize: 14,
  },
  actionText: {
    fontFamily: shellFontFamily,
    color: shell.text,
    fontSize: 12,
    fontWeight: '800',
  },
  unknownPill: {
    height: 22,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  unknownPillText: {
    fontFamily: shellFontFamily,
    color: '#697285',
    fontSize: 12,
  },
  updatingText: {
    fontFamily: shellFontFamily,
    color: '#00bdec',
    fontSize: 11,
  },
  centeredLogoWrap: {
    height: 730,
    alignItems: 'center',
    paddingTop: 101,
  },
  centeredLogo: {
    fontFamily: shellFontFamily,
    color: '#ffffff',
    fontSize: 60,
    lineHeight: 74,
    textShadowColor: '#1fbfff',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  exploreRoot: {
    paddingTop: 17,
    gap: 34,
  },
  exploreFilterPanel: {
    minHeight: 152,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    padding: 20,
    backgroundColor: shell.panel,
    gap: 13,
  },
  exploreSearch: {
    height: 37,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.11)',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: 'rgba(7, 8, 13, 0.55)',
  },
  exploreSearchText: {
    fontFamily: shellFontFamily,
    color: '#7d8799',
    fontSize: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    minHeight: 25,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
    paddingHorizontal: 15,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  filterChipText: {
    fontFamily: shellFontFamily,
    color: '#8d95a5',
    fontSize: 12,
  },
  featureGroup: {
    gap: 16,
    paddingBottom: 5,
  },
  featureHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  featureTitle: {
    fontFamily: shellFontFamily,
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  featureCount: {
    fontFamily: shellFontFamily,
    color: '#717b8f',
    fontSize: 12,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    width: 271,
    minWidth: 260,
    height: 96,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingTop: 15,
    gap: 12,
    backgroundColor: shell.panel,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: shell.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  featureIconText: {
    fontFamily: shellFontFamily,
    color: shell.accent,
    fontSize: 16,
  },
  featureCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  featureCardTitle: {
    fontFamily: shellFontFamily,
    color: '#f8fafc',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  featureDescription: {
    fontFamily: shellFontFamily,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 19.5,
  },
  fleetSkeleton: {
    paddingTop: 0,
  },
  skeletonTopRow: {
    flexDirection: 'row',
    gap: 16,
  },
  fleetSkeletonLineOne: {
    marginTop: 24,
  },
  fleetSkeletonLineTwo: {
    marginTop: 24,
  },
  fleetSkeletonLineTight: {
    marginTop: 12,
  },
  skeletonBar: {
    height: 16,
    borderRadius: 9,
    backgroundColor: '#374151',
  },
  driveDetailSkeleton: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 15,
  },
  detailSkeletonLineSmall: {
    marginTop: 8,
  },
  detailSkeletonLineLarge: {
    marginTop: 24,
  },
  driveDetailPillRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
  driveDetailHeroPanel: {
    height: 320,
    marginTop: 24,
  },
  driveDetailPanelRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 24,
  },
  driveDetailBottomPanel: {
    height: 280,
  },
  chargeDetailSkeleton: {
    paddingTop: 0,
  },
  chargeDetailPillRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 32,
  },
  chargeDetailWideLine: {
    marginTop: 32,
  },
  chargeDetailMetricRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 32,
  },
  chargeDetailMetricRowTight: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  chargeDetailHeroPanel: {
    height: 256,
    marginTop: 32,
  },
  chargeDetailBottomPanel: {
    height: 288,
    marginTop: 32,
  },
  noVehiclePanel: {
    height: 350,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: shell.panel,
  },
  noVehicleIcon: {
    color: '#858d9f',
    fontSize: 42,
    lineHeight: 50,
  },
  noVehicleTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  noVehicleCopy: {
    color: '#a0a8b8',
    fontSize: 13,
  },
  setupButton: {
    marginTop: 8,
    height: 32,
    borderRadius: 7,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: '#415064',
  },
  setupButtonText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },
  energyActions: {
    flexDirection: 'row',
    gap: 11,
    paddingTop: 6,
  },
  tripsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 6,
  },
  datePill: {
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: shell.border,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(18,20,31,0.88)',
  },
  datePillText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  savedViewsButton: {
    height: 34,
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: '#334155',
  },
  savedViewsText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  energyRoot: {
    paddingTop: 9,
    gap: 24,
  },
  energyHero: {
    height: 282,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: shell.panel,
  },
  energyHeroIcon: {
    color: '#777f90',
    fontSize: 44,
    lineHeight: 52,
  },
  energyHeroText: {
    color: '#9aa3b2',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  energyMetricRow: {
    flexDirection: 'row',
    gap: 12,
  },
  energyMetric: {
    flex: 1,
    minHeight: 69,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: shell.panel,
  },
  energyMetricLabel: {
    color: '#70788b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  energyMetricValue: {
    color: '#f8fafc',
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
  },
  textCyan: {
    color: '#22d3ee',
  },
  textGreen: {
    color: '#34d399',
  },
  textPurple: {
    color: '#a855f7',
  },
  textAmber: {
    color: '#f59e0b',
  },
  textRose: {
    color: '#f43f5e',
  },
  energyLifetime: {
    height: 190,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    padding: 22,
    gap: 14,
    backgroundColor: shell.panel,
  },
  panelTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  energyLifetimeGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  energyNestedPanel: {
    flex: 1,
    minHeight: 103,
    borderRadius: 9,
    padding: 16,
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  energyMutedDash: {
    color: '#6f7788',
    fontSize: 20,
    fontWeight: '700',
  },
  energyLargeGreen: {
    color: '#34d399',
    fontSize: 24,
    fontWeight: '700',
  },
  mutedText: {
    color: '#8a93a5',
    fontSize: 12,
  },
  energySavingsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  energySavings: {
    flex: 1,
    height: 165,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    padding: 20,
    gap: 16,
    backgroundColor: shell.panel,
  },
  energySavingsHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  energySavingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  energySavingsIconText: {
    color: '#14f1d9',
    fontSize: 18,
  },
  energySavingsTitle: {
    color: '#a8b0bf',
    fontSize: 15,
    fontWeight: '700',
  },
  energySavingsValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  textCyanLarge: {
    color: '#22d3ee',
    fontSize: 19,
    fontWeight: '700',
  },
  energyArrow: {
    color: '#7b8394',
    fontSize: 22,
  },
  energyGrayValue: {
    color: '#9ca3af',
    fontSize: 19,
    fontWeight: '700',
  },
  energySavingLine: {
    color: '#5af0c4',
    fontSize: 15,
    fontWeight: '700',
  },
  energySavingBadge: {
    color: '#5af0c4',
    fontSize: 11,
  },
  energyChartRow: {
    flexDirection: 'row',
    gap: 20,
  },
  energyChartPanel: {
    flex: 1,
    height: 190,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 20,
    backgroundColor: '#111827',
  },
  chartPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chartPanelTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  chartPanelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  chartPanelActionText: {
    color: '#7d889d',
    fontSize: 13,
  },
  chartIcon: {
    marginTop: 50,
    color: '#7d8595',
    textAlign: 'center',
    fontSize: 32,
  },
  notificationsRoot: {
    paddingTop: 10,
  },
  notificationHeaderActions: {
    flexDirection: 'row',
    gap: 34,
    paddingTop: 6,
  },
  headerActionText: {
    color: shell.text,
    fontSize: 12,
    fontWeight: '800',
  },
  archiveText: {
    color: '#9aa3b2',
    fontSize: 13,
  },
  notificationFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    maxWidth: 900,
    marginBottom: 17,
  },
  smallChip: {
    height: 28,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: shell.border,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(12,14,22,0.68)',
  },
  smallChipText: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  selectFilter: {
    width: 160,
    height: 38,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: shell.border,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: shell.panel,
  },
  selectFilterText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  messageSearch: {
    width: 290,
    height: 38,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: shell.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: shell.panel,
  },
  datePillSmall: {
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: shell.border,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: shell.panel,
  },
  notificationPanel: {
    minHeight: 193,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    padding: 16,
    gap: 8,
    backgroundColor: shell.panel,
  },
  notificationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 30,
    gap: 10,
  },
  notificationPanelToggles: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationSkeletonList: {
    marginTop: 9,
    gap: 8,
  },
  groupedPill: {
    height: 28,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(34,211,238,0.16)',
  },
  groupedText: {
    color: '#a5f3fc',
    fontSize: 12,
    fontWeight: '800',
  },
  systemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 21,
    paddingTop: 5,
    marginRight: 75,
  },
  offlinePill: {
    height: 26,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: shell.border,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: 'rgba(12,14,22,0.68)',
  },
  offlinePillText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },
  systemRoot: {
    width: 768,
    alignSelf: 'center',
    paddingTop: 8,
    gap: 20,
  },
  systemHero: {
    height: 98,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    backgroundColor: shell.panel,
  },
  systemAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3c4656',
  },
  systemHeroCopy: {
    flex: 1,
    gap: 9,
  },
  systemHeroTitleSkeleton: {
    height: 24,
  },
  systemHeroActionSkeleton: {
    height: 36,
  },
  skeletonBlock: {
    height: 14,
    borderRadius: 3,
    backgroundColor: '#374151',
  },
  skeletonTall: {
    height: 44,
    borderRadius: 3,
  },
  systemTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  skeletonPill: {
    width: 92,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#374151',
  },
  systemPanel: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    backgroundColor: shell.panel,
  },
  systemPanelTitleSkeleton: {
    height: 18,
  },
  accountPanel: {
    minHeight: 74,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: shell.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 23,
    backgroundColor: shell.panel,
  },
  accountBolt: {
    color: '#ffffff',
    fontSize: 24,
    textShadowColor: '#22d3ee',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 13,
  },
  accountLoadingText: {
    color: '#a2acbd',
    fontSize: 13,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 1072,
    zIndex: 100,
    elevation: 100,
    height: 28,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  apiDot: {
    color: '#34d399',
    fontSize: 12,
  },
  apiText: {
    color: '#64f0c8',
    fontSize: 11,
    fontWeight: '800',
  },
  footerMuted: {
    color: '#747d8e',
    fontSize: 11,
  },
  footerDot: {
    color: shell.accent,
    fontSize: 10,
  },
});
