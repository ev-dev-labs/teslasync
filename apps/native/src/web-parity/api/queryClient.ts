import {
  QueryClient,
  focusManager,
  type QueryClientConfig,
} from '@tanstack/react-query';
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';

let focusManagerSubscription: NativeEventSubscription | null = null;

function appStateIsFocused(state: AppStateStatus): boolean {
  return state === 'active';
}

export function installNativeQueryFocusManager(): () => void {
  focusManager.setFocused(appStateIsFocused(AppState.currentState));

  if (focusManagerSubscription !== null) {
    return () => undefined;
  }

  focusManagerSubscription = AppState.addEventListener('change', state => {
    focusManager.setFocused(appStateIsFocused(state));
  });

  return () => {
    focusManagerSubscription?.remove();
    focusManagerSubscription = null;
    focusManager.setFocused(undefined);
  };
}

export const DEFAULT_QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      retryDelay: attempt => Math.min(2000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 1,
      networkMode: 'offlineFirst',
    },
  },
};

export function createQueryClient(): QueryClient {
  installNativeQueryFocusManager();
  return new QueryClient(DEFAULT_QUERY_CLIENT_CONFIG);
}
