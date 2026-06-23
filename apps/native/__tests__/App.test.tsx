import React from 'react';
import type {ReactNode} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import App from '../App';

jest.mock('../src/api/hooks', () => ({
  useVehicles: () => ({
    data: [
      {
        id: 1,
        vehicle_id: 42,
        vin: '5YJTESLASYNC0001',
        display_name: 'Roadrunner',
        model: 'Model Y',
        trim_badging: 'Performance',
        exterior_color: 'Pearl White',
        wheel_type: 'Uberturbine',
        state: 'online',
        healthy: true,
        timezone: 'America/Los_Angeles',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAlerts: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useSystemStatus: () => ({
    data: {status: 'healthy', healthy: true},
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactActual = require('react') as typeof import('react');
  const {View} = require('react-native') as typeof import('react-native');
  const SafeAreaHost = ({children}: {children: ReactNode}) =>
    ReactActual.createElement(View, null, children);

  return {
    SafeAreaProvider: SafeAreaHost,
    SafeAreaView: SafeAreaHost,
    useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}),
  };
});

test('renders the TeslaSync native shell', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('TeslaSync');
  expect(serialized).toContain('Dashboard');
});
