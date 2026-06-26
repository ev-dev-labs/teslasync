import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings, type AppSettings} from '../src/web-parity/api/hooks/useSettings';
import SafetyPage from '../src/web-parity/features/settings/pages/SafetyPage';

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseSettings = useSettings as unknown as jest.Mock;

const AI_PANEL_TEST_ID = 'ai-feature-safety-setting-explainer-root';
const LISTING_TEST_ID = 'safety-settings-listing';
const ROWS_TEST_ID = 'safety-settings-rows';

const baseSettings: AppSettings = {
  unit_of_length: 'mi',
  unit_of_temp: 'F',
  unit_of_pressure: 'psi',
  preferred_range: 'ideal',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 3.5,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 30,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  critical_flash_enabled: true,
  tab_badge_enabled: true,
  ai_mode: 'off',
  ai_features: {},
};

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function instanceText(node: ReactTestRenderer.ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === 'string' ? child : instanceText(child)))
    .join('');
}

function hostTextByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): string {
  const node = tree?.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  )[0];
  return node ? instanceText(node) : '';
}

function countByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): number {
  return (
    tree?.root.findAll(
      node => node.props?.testID === testID && typeof node.type === 'string',
    ).length ?? 0
  );
}

async function renderPage() {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<SafetyPage />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSettings.mockReturnValue({data: baseSettings});
});

test('off mode: renders the static listing with every value and NO AI panel', async () => {
  // ai_mode='off' is the baseSettings default — the AISafetySettingExplainer
  // self-gates and renders null.
  const tree = await renderPage();
  const text = serialize(tree);

  // Page header + listing scaffold always render.
  expect(text).toContain('Safety settings');
  expect(text).toContain('Your safety-related settings');
  expect(countByTestId(tree, LISTING_TEST_ID)).toBe(1);
  expect(countByTestId(tree, ROWS_TEST_ID)).toBe(1);

  // The AI panel is absent from the tree (ADR-015 §I5 hidden UI).
  expect(countByTestId(tree, AI_PANEL_TEST_ID)).toBe(0);

  // Every safety setting's current value is visible via its value badge.
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.quietHoursEnabled.title'),
  ).toBe('Off');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.quietHoursStart.title'),
  ).toBe('22:00');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.quietHoursEnd.title'),
  ).toBe('07:00');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.alertDigestMode.title'),
  ).toBe('instant');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.criticalFlashEnabled.title'),
  ).toBe('On');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.tabBadgeEnabled.title'),
  ).toBe('On');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.apiSuspended.title'),
  ).toBe('Active');

  // All seven rows are present.
  expect(countByTestId(tree, 'safety-settings-row-safetySettings.rows.quietHoursEnabled.title')).toBe(1);
  expect(countByTestId(tree, 'safety-settings-row-safetySettings.rows.apiSuspended.title')).toBe(1);
  expect(text).toContain('Quiet hours');
  expect(text).toContain('API kill-switch');
  expect(text).toContain('Docs');
  expect(text).toContain('To change a value, open the main Settings page.');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('on mode (cloud + feature flag): the AI panel IS present above the listing', async () => {
  mockUseSettings.mockReturnValue({
    data: {
      ...baseSettings,
      ai_mode: 'cloud',
      ai_features: {'safety-setting-explainer': true},
    },
  });

  const tree = await renderPage();

  // Positive control: the AI panel renders, and the deterministic listing is
  // still present alongside it.
  expect(countByTestId(tree, AI_PANEL_TEST_ID)).toBe(1);
  expect(countByTestId(tree, LISTING_TEST_ID)).toBe(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('loading window: renderValue is null-safe and no section is hidden', async () => {
  mockUseSettings.mockReturnValue({data: undefined});

  const tree = await renderPage();
  const text = serialize(tree);

  // Sections never hidden while settings load.
  expect(countByTestId(tree, LISTING_TEST_ID)).toBe(1);
  expect(countByTestId(tree, ROWS_TEST_ID)).toBe(1);
  expect(countByTestId(tree, AI_PANEL_TEST_ID)).toBe(0);

  // Null-safe fallbacks: booleans -> Off/Active, optional strings -> em-dash,
  // alert_digest_mode -> 'instant'.
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.quietHoursEnabled.title'),
  ).toBe('Off');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.quietHoursStart.title'),
  ).toBe('—');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.alertDigestMode.title'),
  ).toBe('instant');
  expect(
    hostTextByTestId(tree, 'safety-settings-value-safetySettings.rows.apiSuspended.title'),
  ).toBe('Active');
  expect(text).toContain('Your safety-related settings');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
