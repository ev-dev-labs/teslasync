import { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  type AppStateStatus,
  type PlatformOSType,
} from 'react-native';

import {
  parseDeepLink,
  TESLASYNC_URL_SCHEME,
  type ParsedDeepLink,
} from './deepLinks';
import type { RouteId } from '../navigation/routes';

export type PlatformCapabilityState =
  | 'available'
  | 'configured'
  | 'unavailable'
  | 'unknown';

export interface PlatformCapabilityStatus {
  id: string;
  label: string;
  state: PlatformCapabilityState;
  detail: string;
  evidence: string;
}

export interface PlatformLaunchActionStatus {
  id: string;
  label: string;
  routeId: RouteId;
  sourcePath: string;
  deepLinkURL: string;
  state: PlatformCapabilityState;
  detail: string;
  evidence: string;
}

export interface PlatformIntegrationStatus {
  os: PlatformOSType | string;
  appState: AppStateStatus;
  lifecycleObservedAt: string;
  initialDeepLink: ParsedDeepLink | null;
  lastDeepLink: ParsedDeepLink | null;
  deepLinkError?: string;
  capabilities: PlatformCapabilityStatus[];
  launchActions: PlatformLaunchActionStatus[];
}

const launchActionDefinitions = [
  {
    id: 'dashboard',
    label: 'Fleet dashboard action',
    routeId: 'dashboard',
    sourcePath: '/',
  },
  {
    id: 'notifications-inbox',
    label: 'Notification inbox action',
    routeId: 'alerts',
    sourcePath: 'notifications/inbox',
  },
  {
    id: 'vehicles',
    label: 'Vehicle garage action',
    routeId: 'vehicles',
    sourcePath: 'vehicles',
  },
  {
    id: 'system-status',
    label: 'System status action',
    routeId: 'system',
    sourcePath: 'system/status',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  routeId: RouteId;
  sourcePath: string;
}[];

function platformLabel(os: PlatformOSType | string): string {
  if (os === 'ios') {
    return 'iOS';
  }
  if (os === 'android') {
    return 'Android';
  }
  if (os === 'windows') {
    return 'Windows';
  }
  if (os === 'macos') {
    return 'macOS';
  }
  return String(os);
}

export function getPlatformCapabilities(
  os: PlatformOSType | string = Platform.OS,
): PlatformCapabilityStatus[] {
  const label = platformLabel(os);
  const protocolEvidence =
    os === 'android'
      ? 'AndroidManifest.xml registers a teslasync:// VIEW intent filter.'
      : os === 'ios'
      ? 'Info.plist registers CFBundleURLSchemes=teslasync.'
      : os === 'windows'
      ? 'Package.appxmanifest registers a windows.protocol extension for teslasync.'
      : 'The JavaScript parser supports teslasync:// paths; no native project is generated for this OS yet.';

  return [
    {
      id: 'deep-links',
      label: 'Deep links',
      state: os === 'macos' ? 'unavailable' : 'configured',
      detail: `${label} routes ${TESLASYNC_URL_SCHEME}:// URLs through the typed native route manifest parser.`,
      evidence: protocolEvidence,
    },
    {
      id: 'lifecycle',
      label: 'Lifecycle',
      state: 'available',
      detail:
        'React Native AppState is observed in the shell and rendered in platform parity status.',
      evidence:
        'usePlatformIntegrationStatus subscribes to AppState change events.',
    },
    {
      id: 'push-registration',
      label: 'Push registration',
      state: 'unavailable',
      detail:
        'APNs, FCM, and WNS token registration are not wired in this slice, so no push delivery success is claimed.',
      evidence:
        os === 'android'
          ? 'Android declares POST_NOTIFICATIONS permission, but no FCM registration module or token persistence is added.'
          : 'No native push notification registration module or secure token enrollment endpoint is wired.',
    },
    {
      id: 'badges',
      label: 'Badge count',
      state: 'unavailable',
      detail:
        'Unread notification counts are visible in-app only; OS app icon badges are not wired.',
      evidence:
        'No badge native module is registered for this React Native parity slice.',
    },
    {
      id: 'taskbar-jump-list',
      label: os === 'windows' ? 'Taskbar jump list' : 'Launcher shortcuts',
      state: 'unavailable',
      detail:
        os === 'windows'
          ? 'Windows protocol activation is declared, but jump-list/taskbar commands require a native WinAppSDK bridge.'
          : 'Launcher shortcut equivalents require platform-native shortcut modules and are intentionally not claimed as done.',
      evidence:
        'The native UI shows typed launch action placeholders as unavailable instead of reporting a fake shortcut integration.',
    },
  ];
}

export function getPlatformLaunchActions(
  os: PlatformOSType | string = Platform.OS,
): PlatformLaunchActionStatus[] {
  const label = platformLabel(os);
  const shortcutName =
    os === 'windows' ? 'taskbar jump list' : 'launcher shortcut';

  return launchActionDefinitions.map(action => {
    const deepLinkPath =
      action.sourcePath === '/' ? '' : action.sourcePath.replace(/^\/+/, '');
    return {
      ...action,
      deepLinkURL:
        deepLinkPath.length === 0
          ? `${TESLASYNC_URL_SCHEME}:///`
          : `${TESLASYNC_URL_SCHEME}://${deepLinkPath}`,
      state: 'unavailable',
      detail: `${action.label} is mapped to the ${action.routeId} native route, but it is not installed as a ${label} ${shortcutName}.`,
      evidence:
        'Protocol URLs are parseable by the native shell; no OS shortcut installer, jump-list bridge, or token-backed push action is wired in this slice.',
    };
  });
}

export function buildPlatformIntegrationStatus(
  appState: AppStateStatus = AppState.currentState,
  initialDeepLink: ParsedDeepLink | null = null,
  lastDeepLink: ParsedDeepLink | null = null,
  deepLinkError?: string,
): PlatformIntegrationStatus {
  return {
    os: Platform.OS,
    appState,
    lifecycleObservedAt: new Date().toISOString(),
    initialDeepLink,
    lastDeepLink,
    deepLinkError,
    capabilities: getPlatformCapabilities(),
    launchActions: getPlatformLaunchActions(),
  };
}

export function usePlatformIntegrationStatus(): PlatformIntegrationStatus {
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [lifecycleObservedAt, setLifecycleObservedAt] = useState(() =>
    new Date().toISOString(),
  );
  const [initialDeepLink, setInitialDeepLink] = useState<ParsedDeepLink | null>(
    null,
  );
  const [lastDeepLink, setLastDeepLink] = useState<ParsedDeepLink | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;

    Linking.getInitialURL()
      .then(url => {
        if (mounted && url) {
          setInitialDeepLink(parseDeepLink(url));
        }
      })
      .catch(error => {
        if (mounted) {
          setDeepLinkError(
            error instanceof Error
              ? error.message
              : 'Failed to read initial URL',
          );
        }
      });

    const linkSubscription = Linking.addEventListener('url', event => {
      setLastDeepLink(parseDeepLink(event.url));
    });

    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        setAppState(nextState);
        setLifecycleObservedAt(new Date().toISOString());
      },
    );

    return () => {
      mounted = false;
      linkSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  const capabilities = useMemo(() => getPlatformCapabilities(), []);
  const launchActions = useMemo(() => getPlatformLaunchActions(), []);

  return {
    os: Platform.OS,
    appState,
    lifecycleObservedAt,
    initialDeepLink,
    lastDeepLink,
    deepLinkError,
    capabilities,
    launchActions,
  };
}
