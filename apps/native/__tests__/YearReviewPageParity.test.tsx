import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useYearReview} from '../src/web-parity/api/hooks/useAnalytics';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import YearReviewPage from '../src/web-parity/features/analytics/pages/YearReviewPage';

jest.mock('../src/web-parity/api/hooks/useAnalytics', () => ({
  useYearReview: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));
// AIYearReviewNarration pulls in the AI streaming stack + useSettings; the page
// test isolates the story shell, so the overlay is stubbed to render nothing.
jest.mock('../src/web-parity/components/ai/AIYearReviewNarration', () => ({
  AIYearReviewNarration: () => null,
}));

const mockUseYearReview = useYearReview as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

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

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

const VEHICLE_A = {id: 1, display_name: 'Model 3 Performance', model: 'Model 3'};
const VEHICLE_B = {id: 2, display_name: 'Model Y Long Range', model: 'Model Y'};

function yearReviewStub(overrides: Record<string, unknown> = {}) {
  return {
    year: 2025,
    vehicle: {id: 1, display_name: 'Model 3 Performance', model: 'Model 3'},
    total_drives: 412,
    total_distance_km: 15000,
    total_energy_kwh: 3200,
    total_charge_sessions: 88,
    total_driving_minutes: 0,
    total_charging_cost: 540,
    gas_savings: 1200,
    co2_offset_kg: 2100,
    most_active_day_of_week: 'Saturday',
    most_active_hour: 17,
    avg_drives_per_week: 8,
    avg_distance_per_drive_km: 36,
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<YearReviewPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('shows the full-screen loading state while the review is building', async () => {
  mockUseVehicles.mockReturnValue({data: []});
  mockUseYearReview.mockReturnValue({data: undefined, isLoading: true});

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('year-review-loading');
  expect(textOf(tree)).toContain('Building your year in review...');
  expect(raw).not.toContain('year-review-page');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the no-data state when the year has no drives or charges', async () => {
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A]});
  mockUseYearReview.mockReturnValue({
    data: yearReviewStub({total_drives: 0, total_charge_sessions: 0}),
    isLoading: false,
  });

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('year-review-empty');
  expect(text).toContain('No driving data for');
  expect(text).toContain('Go Back');
  expect(raw).not.toContain('year-review-page');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the story shell, progress, counter, and title slide', async () => {
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A]});
  mockUseYearReview.mockReturnValue({data: yearReviewStub(), isLoading: false});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('year-review-page');
  expect(raw).toContain('year-review-progress');
  expect(raw).toContain('year-review-close');
  expect(raw).toContain('year-review-tap-prev');
  expect(raw).toContain('year-review-tap-next');

  // 12 slides -> "1 / 12" counter on the opening slide.
  expect(raw).toContain('year-review-counter');
  expect(text).toContain('1 / 12');

  // Title slide hero: year + "Year in Review" + selected vehicle.
  expect(text).toContain('Year in Review');
  expect(text).toContain('Model 3 Performance');

  // A single vehicle hides the picker.
  expect(raw).not.toContain('year-review-vehicle-select');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the vehicle selector when more than one vehicle exists', async () => {
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A, VEHICLE_B]});
  mockUseYearReview.mockReturnValue({data: yearReviewStub(), isLoading: false});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('year-review-vehicle-select');
  // Both vehicles surface as selectable options.
  expect(text).toContain('Model 3 Performance');
  expect(text).toContain('Model Y Long Range');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
