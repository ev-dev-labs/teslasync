import { expect, test } from '@playwright/test';
import {
  assertCatalogueReadingInventory, type ObservationInventoryFrame,
} from './dashboardCatalogueObservationAge';

// Controlled numeric frames, not application acceptance or a frozen browser clock.
function frame(): ObservationInventoryFrame {
  const observedAt = Date.parse('2026-10-04T12:00:00.000Z');
  const layout = [{
    tag: 'SECTION', className: 'controlled-layout',
    bounds: { top: 0, bottom: 400, left: 0, right: 700 },
    clipBounds: { top: 0, bottom: 400, left: 0, right: 700 },
    clipsX: true, clipsY: true, scrollTop: 0, scrollLeft: 0,
    scrollHeight: 400, scrollWidth: 700, clientHeight: 400, clientWidth: 700,
  }];
  return {
    wallTimeMs: observedAt + 6100,
    usable: { top: 72, bottom: 872 },
    fleetObservation: { scopeVehicleId: 7 },
    observationSource: {
      vehicleId: 7, observedAt, earliestRenderAt: observedAt + 800,
      snapshot: JSON.stringify({
        vehicle: { id: 7, display_name: 'Controlled Aurora' },
        entry: { vehicle_id: 7, observed_at: new Date(observedAt).toISOString(),
          outcome: 'resolved', live: true, data_source: 'signal_store' },
      }),
      responses: [],
    },
    readings: [
      { id: '10:0', text: 'Last real observation 1s ago', observationAgeRole: 'scope',
        relativeTop: 20, relativeBottom: 39, relativeLeft: 16, relativeRight: 210,
        top: 120, bottom: 139, hitInsidePanel: true, observationAgeLayout: layout },
      { id: '22:0', text: '1s ago', observationAgeRole: 'oldest',
        relativeTop: 60, relativeBottom: 79, relativeLeft: 16, relativeRight: 80,
        top: 160, bottom: 179, hitInsidePanel: true, observationAgeLayout: layout },
      { id: '30:0', text: 'Verified 1/1', observationAgeRole: null,
        relativeTop: 100, relativeBottom: 119, relativeLeft: 16, relativeRight: 110,
        top: 200, bottom: 219, hitInsidePanel: true },
    ],
  };
}

function advanced() {
  const after = frame();
  after.wallTimeMs += 422;
  after.readings[0].text = 'Last real observation 6s ago';
  after.readings[1].text = '6s ago';
  return after;
}

test('source-bound ages may advance from a cached render using observation-to-real-clock bounds, not frame duration', () => {
  const before = frame();
  const after = advanced();
  expect(after.wallTimeMs - before.wallTimeMs).toBe(422);
  assertCatalogueReadingInventory(before, after);
  expect(before.readings[0].text).toBe('Last real observation 1s ago');
  expect(after.readings[0].text).toBe('Last real observation 6s ago');
});

test('source-bound age contract rejects arbitrary metric text changes', () => {
  const after = advanced();
  after.readings[2].text = 'Verified 0/1';
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/non-age reading text must remain exact/);
});

test('source-bound age contract rejects missing reading regions', () => {
  const after = advanced();
  after.readings.pop();
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/exact identity\/relative geometry/);
});

test('source-bound age contract rejects changed observation instant', () => {
  const after = advanced();
  if (!after.observationSource) throw new Error('Controlled source missing');
  after.observationSource.observedAt += 1000;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/Underlying observation instant/);
});

test('source-bound age contract rejects changed vehicle/source snapshot', () => {
  const after = advanced();
  if (!after.observationSource) throw new Error('Controlled source missing');
  after.observationSource.snapshot = '{"vehicle":{"id":8},"data_source":"historical"}';
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/Observation\/vehicle\/source snapshot/);
});

test('source-bound age contract blocks missing served provenance', () => {
  const after = advanced();
  after.observationSource = null;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/missing recorded observation provenance/);
});

test('source-bound age contract rejects shifted reading geometry', () => {
  const after = advanced();
  after.readings[0].relativeTop++;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/exact identity\/relative geometry/);
});

test('source-bound age contract rejects lost native hit for a sampled visible age reading', () => {
  const after = advanced();
  after.readings[1].hitInsidePanel = false;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/reading occluded at native center hit/);
});

test('source-bound age contract rejects ages beyond the real observation-to-capture clock', () => {
  const after = advanced();
  after.readings[1].text = '8s ago';
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/age cannot exceed real observation-to-capture/);
});

test('source-bound age contract rejects cached ages predating the served source', () => {
  const before = frame();
  if (!before.observationSource) throw new Error('Controlled source missing');
  before.observationSource.earliestRenderAt += 3000;
  expect(() => assertCatalogueReadingInventory(before, before)).toThrow(/age cannot predate any possible source-backed render/);
});

test('source-bound age contract rejects a decrease between consecutive frames', () => {
  const before = advanced();
  const after = advanced();
  after.wallTimeMs++;
  after.readings[1].text = '5s ago';
  expect(() => assertCatalogueReadingInventory(before, after)).toThrow(/observation age must not decrease/);
});

test('source-bound age contract rejects generic ago text outside the exact age nodes', () => {
  const before = frame();
  const after = advanced();
  before.readings[2].text = 'Refresh 1s ago';
  after.readings[2].text = 'Refresh 6s ago';
  expect(() => assertCatalogueReadingInventory(before, after)).toThrow(/non-age reading text must remain exact/);
});

test('only a proven changed age may change intrinsic right extent within exact measured layout', () => {
  const after = advanced();
  after.readings[1].relativeRight -= 0.453125;
  assertCatalogueReadingInventory(frame(), after);
});

test('unchanged source-bound age text cannot disguise intrinsic geometry changes', () => {
  const after = frame();
  after.readings[1].relativeRight--;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/unchanged age text must retain exact intrinsic extent/);
});

test('source-bound age rejects moved containing layout even if glyph anchors are unchanged', () => {
  const after = advanced();
  const layout = after.readings[1].observationAgeLayout;
  if (!layout) throw new Error('Controlled layout missing');
  layout[0].bounds.right--;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/containing layout must remain exact/);
});

test('non-age right extent remains exact even during a justified age advance', () => {
  const after = advanced();
  after.readings[2].relativeRight--;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/exact identity\/relative geometry/);
});

test('proven changed age still rejects full glyph overflow beyond its measured container', () => {
  const after = advanced();
  after.readings[1].relativeRight = 701;
  expect(() => assertCatalogueReadingInventory(frame(), after)).toThrow(/Full source-bound age glyph must remain contained/);
});
