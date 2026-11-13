import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import transition from './__fixtures__/widget-implementation-transition.json';
import packCopyChanges from './__fixtures__/widget-design-pack-copy.json';
import appDesign from './__fixtures__/app-design-preservation.json';
import helpCold from './__fixtures__/help-cold-preservation.json';
import replayUrlRace from './__fixtures__/replay-url-race-preservation.json';
import replayTransitionQueue from './__fixtures__/replay-transition-queue-preservation.json';
import runtimeV9 from './__fixtures__/runtime-v9-preservation.json';
import previewMapFrame from './__fixtures__/preview-map-frame-preservation.json';
import previewOverlayInvoker from './__fixtures__/preview-overlay-invoker-preservation.json';
import previewMapPopup from './__fixtures__/preview-map-popup-preservation.json';
import previewOverlayTooltip from './__fixtures__/preview-overlay-tooltip-preservation.json';
import tableNoMatch from './__fixtures__/table-no-match-preservation.json';
import previewMapReset from './__fixtures__/preview-map-reset-preservation.json';
import previewOverlayHelpInset from './__fixtures__/preview-overlay-help-inset-preservation.json';
import commandDeckModal from './__fixtures__/command-deck-modal-preservation.json';
import tableEmptyViewport from './__fixtures__/table-empty-viewport-preservation.json';
import settingsPreviewInvoker from './__fixtures__/settings-preview-invoker-preservation.json';
import previewChartQuery from './__fixtures__/preview-chart-query-preservation.json';
import { nativeRepairPredecessor, restoreNativeSourceRepair } from './verified-native-source-repair-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const previewChartQueryFingerprint = 'c5fbd9e9bc80fc0703e1d59ff065b0f6b906b35309cb9dbc98913aaa7be79d63';
expect(hash(JSON.stringify(previewChartQuery)), 'pinned preview chart query successor').toBe(previewChartQueryFingerprint);

export function restorePreviewChartQuerySource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewChartQuery)), 'pinned preview chart query successor').toBe(previewChartQueryFingerprint);
  const patch = previewChartQuery.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed current-URL owned-key cleanup').toBe(patch.after);
  for (const dependency of previewChartQuery.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual chart data/palette/render dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact chart query region').toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled Candidate30 chart')
    .toBe(previewChartQuery.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged original complete chart producer')
    .toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
  expect(hash(previous), file + ': complete preserved chart producer').toBe(patch.before);
  return previous;
}

const settingsPreviewInvokerFingerprint = 'aa842948dc19b72a8492aa5a4726e82029557c492e9c3a0c7add96c1305bf2db';
expect(hash(JSON.stringify(settingsPreviewInvoker)), 'pinned Settings preview invoker successor')
  .toBe(settingsPreviewInvokerFingerprint);

export function restoreSettingsPreviewInvokerSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(settingsPreviewInvoker)), 'pinned Settings preview invoker successor')
    .toBe(settingsPreviewInvokerFingerprint);
  const patch = settingsPreviewInvoker.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed original preview invoker').toBe(patch.after);
  for (const dependency of settingsPreviewInvoker.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual Settings focus/preview dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact Settings invoker region')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled Candidate29 Settings')
    .toBe(settingsPreviewInvoker.independentPredecessorProof.sha256);
  expect(hash(previous), file + ': complete preserved Settings source').toBe(patch.before);
  return previous;
}

const tableEmptyViewportFingerprint = 'c207094fe32919497ec2769297d3716d41750a303c2f31f87c689f9720c75151';
expect(hash(JSON.stringify(tableEmptyViewport)), 'pinned table empty viewport successor').toBe(tableEmptyViewportFingerprint);

export function restoreTableEmptyViewportSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(tableEmptyViewport)), 'pinned table empty viewport successor').toBe(tableEmptyViewportFingerprint);
  const patch = tableEmptyViewport.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed bounded native empty-cell viewport').toBe(patch.after);
  for (const dependency of tableEmptyViewport.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual table presentation/filter dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact empty viewport region')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled Candidate28 table')
    .toBe(tableEmptyViewport.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged no-match API stage')
    .toBe(tableNoMatch.sources.find(entry => entry.file === file)?.after);
  expect(hash(previous), file + ': complete preserved table API source').toBe(patch.before);
  return previous;
}

const commandDeckModalFingerprint = '6a52fefa788a1571b3b2fb97f264f15d9a6d66f4273e65475873ad8712110c7e';
expect(hash(JSON.stringify(commandDeckModal)), 'pinned CommandDeck modal successor').toBe(commandDeckModalFingerprint);

export function restoreCommandDeckModalSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(commandDeckModal)), 'pinned CommandDeck modal successor').toBe(commandDeckModalFingerprint);
  const patch = commandDeckModal.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed local tablet-modal deferral').toBe(patch.after);
  for (const dependency of commandDeckModal.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual navigation/modal dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact modal-deferral hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled V27 navigation')
    .toBe(commandDeckModal.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged original app-design endpoint')
    .toBe(appDesign.sources.find(entry => entry.file === file)?.after);
  expect(hash(previous), file + ': complete preserved CommandDeck').toBe(patch.before);
  return previous;
}

const previewOverlayHelpInsetFingerprint = 'ae2f6dbfa82d17e9f77eb269352cf05f65593f86730aedcd88573dba30470628';
expect(hash(JSON.stringify(previewOverlayHelpInset)), 'pinned preview help inset successor')
  .toBe(previewOverlayHelpInsetFingerprint);

export function restorePreviewOverlayHelpInsetSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewOverlayHelpInset)), 'pinned preview help inset successor')
    .toBe(previewOverlayHelpInsetFingerprint);
  const patch = previewOverlayHelpInset.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed inner help inset').toBe(patch.after);
  for (const dependency of previewOverlayHelpInset.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual help UI/focus dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact inner help inset')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled V26 overlay')
    .toBe(previewOverlayHelpInset.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged tooltip current endpoint')
    .toBe(previewOverlayTooltip.sources.find(entry => entry.file === file)?.after);
  expect(hash(previous), file + ': complete preserved e0e overlay').toBe(patch.before);
  return previous;
}

const previewMapResetFingerprint = '9457ef0adcaf6dc203c423dc280275864855544d218d55e4a520611e2404eebb';
expect(hash(JSON.stringify(previewMapReset)), 'pinned native map reset successor').toBe(previewMapResetFingerprint);

export function restorePreviewMapControlsSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewMapReset)), 'pinned native map reset successor').toBe(previewMapResetFingerprint);
  const patch = previewMapReset.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed native map reset').toBe(patch.after);
  for (const dependency of previewMapReset.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual native map/Button API')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact native reset hunk').toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled native controls').toBe(patch.independentPredecessorProof.sha256);
  expect(patch.before, file + ': original raw producer endpoint')
    .toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
  expect(patch.before, file + ': unchanged map frame dependency')
    .toBe(previewMapFrame.dependencies.find(dependency => dependency.file === file)?.sha256);
  expect(patch.before, file + ': unchanged popup dependency')
    .toBe(previewMapPopup.dependencies.find(dependency => dependency.file === file)?.sha256);
  expect(hash(previous), file + ': complete recovered native controls').toBe(patch.before);
  return previous;
}

const tableNoMatchFingerprint = '44c29777ac0651aafd526e0a88d1d1ba9f1b17e50ec2e9c262065c29cebcab0d';
expect(hash(JSON.stringify(tableNoMatch)), 'pinned table no-match successor').toBe(tableNoMatchFingerprint);

export function restoreTableNoMatchSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(tableNoMatch)), 'pinned table no-match successor').toBe(tableNoMatchFingerprint);
  const patch = tableNoMatch.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed no-match source').toBe(patch.after);
  for (const endpoint of tableNoMatch.sources) {
    expect(hash(restoreTableEmptyViewportSource(endpoint.file, readDependency(endpoint.file), readDependency)),
      endpoint.file + ': actual caller/API pair').toBe(endpoint.after);
  }
  for (const dependency of tableNoMatch.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual table dependency').toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact no-match hunk').toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled table predecessor').toBe(patch.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged historical table endpoint').toBe(
    appDesign.sources.find(entry => entry.file === file)?.after
      ?? appDesign.catalogProducers.find(entry => entry.file === file)?.sha256,
  );
  expect(hash(previous), file + ': complete recovered table source').toBe(patch.before);
  return previous;
}

const previewOverlayTooltipFingerprint = '5bdd3753808304ee2087c882c71045941e116d905904c8b0f4c30ea6d19c8c02';
expect(hash(JSON.stringify(previewOverlayTooltip)), 'pinned preview overlay tooltip successor')
  .toBe(previewOverlayTooltipFingerprint);

export function restorePreviewOverlayTooltipSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewOverlayTooltip)), 'pinned preview overlay tooltip successor')
    .toBe(previewOverlayTooltipFingerprint);
  const patch = previewOverlayTooltip.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed overlay tooltip opt-in').toBe(patch.after);
  for (const dependency of previewOverlayTooltip.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual overlay tooltip dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact tooltip opt-in hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled d70 predecessor')
    .toBe(previewOverlayTooltip.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged invoker current endpoint')
    .toBe(previewOverlayInvoker.sources.find(entry => entry.file === file)?.after);
  expect(hash(previous), file + ': complete preserved d70 overlay').toBe(patch.before);
  return previous;
}

const previewMapPopupFingerprint = 'f3c73ac20c03f3bbb96bc6a2d5672b724ee7375bf553c8a5fc465c402efea0da';
expect(hash(JSON.stringify(previewMapPopup)), 'pinned PreviewMap popup successor')
  .toBe(previewMapPopupFingerprint);

export function restorePreviewMapPopupSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewMapPopup)), 'pinned PreviewMap popup successor')
    .toBe(previewMapPopupFingerprint);
  const patch = previewMapPopup.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed popup layout/title').toBe(patch.after);
  for (const dependency of previewMapPopup.dependencies) {
    expect(hash(restorePreviewMapControlsSource(dependency.file, nativeRepairPredecessor(dependency.file, readDependency), readDependency)),
      dependency.file + ': actual popup dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact popup hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled cc2 predecessor')
    .toBe(previewMapPopup.independentPredecessorProof.sha256);
  expect(patch.before, file + ': unchanged map-frame current endpoint')
    .toBe(previewMapFrame.sources.find(entry => entry.file === file)?.after);
  expect(hash(previous), file + ': complete preserved cc2 PreviewMap').toBe(patch.before);
  return previous;
}

const previewOverlayInvokerFingerprint = '571895973378718e346ff1ac11e8e5b5cf92d52765dc2a326fd6f0f62821d817';
expect(hash(JSON.stringify(previewOverlayInvoker)), 'pinned preview overlay invoker successor')
  .toBe(previewOverlayInvokerFingerprint);

export function restorePreviewOverlayInvokerSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewOverlayInvoker)), 'pinned preview overlay invoker successor')
    .toBe(previewOverlayInvokerFingerprint);
  const patch = previewOverlayInvoker.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed overlay invoker').toBe(patch.after);
  expect(patch.after, file + ': independently compiled current overlay')
    .toBe(previewOverlayInvoker.compiledCurrentProof.sha256);
  for (const dependency of previewOverlayInvoker.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual overlay dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact overlay invoker hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled original overlay')
    .toBe(previewOverlayInvoker.independentPredecessorProof.sha256);
  expect(patch.before, file + ': immutable preview producer endpoint')
    .toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
  expect(hash(previous), file + ': complete preserved overlay producer').toBe(patch.before);
  return previous;
}

const previewMapFrameFingerprint = '9da57db20bff20217a41523ac0b0a57e2da3900f70432c7d11bb5994b7ffbb75';
expect(hash(JSON.stringify(previewMapFrame)), 'pinned PreviewMap frame successor').toBe(previewMapFrameFingerprint);

export function restorePreviewMapFrameSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(previewMapFrame)), 'pinned PreviewMap frame successor').toBe(previewMapFrameFingerprint);
  const patch = previewMapFrame.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed PreviewMap frame').toBe(patch.after);
  for (const dependency of previewMapFrame.dependencies) {
    expect(hash(restorePreviewMapControlsSource(dependency.file, nativeRepairPredecessor(dependency.file, readDependency), readDependency)),
      dependency.file + ': actual PreviewMap dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact PreviewMap frame hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently compiled PreviewMap predecessor')
    .toBe(previewMapFrame.independentPredecessorProof.sha256);
  expect(patch.before, file + ': immutable preview producer endpoint')
    .toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
  expect(hash(previous), file + ': complete preserved PreviewMap producer').toBe(patch.before);
  return previous;
}

const runtimeV9Fingerprint = 'a8f309cdfd4f3f9afcece102a27d16b4de7af29578dff7c57951d5b3c401194d';
expect(hash(JSON.stringify(runtimeV9)), 'pinned V9 runtime successors').toBe(runtimeV9Fingerprint);

export function restoreRuntimeV9Source(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  expect(hash(JSON.stringify(runtimeV9)), 'pinned V9 runtime successors').toBe(runtimeV9Fingerprint);
  const patch = runtimeV9.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed V9 runtime source').toBe(patch.after);
  for (const dependency of runtimeV9.dependencies) {
    expect(hash(nativeRepairPredecessor(dependency.file, readDependency)), dependency.file + ': actual V9 support dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact V9 runtime hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': independently compiled runtime predecessor').toBe(patch.before);
  return previous;
}

// This additive transition preserves the older checkpoints, not visual approval.
expect(hash(JSON.stringify(transition)), 'pinned widget implementation transition')
  .toBe('ff96f3516b4f0b4ebdf4dc0f0ec3fab711a35e0394bb703b493b5ee18ecc97be');

// A separate additive approval, NOT a replacement for any historical fixture.
// Both endpoints and each exact hunk are checked; unrelated bytes cannot pass.
expect(hash(JSON.stringify(appDesign)), 'pinned application-design transition')
  .toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');

// Fourth cold pair is a separate layer: never refresh the earlier approvals.
expect(hash(JSON.stringify(helpCold)), 'pinned Help cold-body transition')
  .toBe('95d2c4e9c823a234c8afde60cc8eac55daa75ccf819bd09052fc09392d792e20');

expect(hash(JSON.stringify(replayUrlRace)), 'pinned Replay URL race transition')
  .toBe('e36da2acfdbe61ebd3ffd95953779b9d3c87a5b7a8f869bb9fb2ef13014eb372');

const replayTransitionQueueFingerprint = '96bdba6d588686db7a19a2d0aa0a77a52f1d1cfa719afe46b02257e69c775fee';
expect(hash(JSON.stringify(replayTransitionQueue)), 'pinned Replay transition-queue transition')
  .toBe(replayTransitionQueueFingerprint);

export function restoreReplayTransitionQueueSource(file: string, source: string): string {
  // Fail closed on stale approval data as well as current-source drift.
  expect(hash(JSON.stringify(replayTransitionQueue)), 'pinned Replay transition-queue transition')
    .toBe(replayTransitionQueueFingerprint);
  const patch = replayTransitionQueue.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed Replay transition queue').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact Replay queue hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently frozen CF predecessor')
    .toBe(replayTransitionQueue.independentPredecessorProof.sha256);
  expect(patch.before, file + ': immutable original Replay repair endpoint')
    .toBe(replayUrlRace.sources[0].after);
  expect(hash(previous), file + ': preserved CF Replay source').toBe(patch.before);
  return previous;
}

export function restoreReplayUrlRaceSource(file: string, source: string): string {
  const patch = replayUrlRace.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed Replay URL repair').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact Replay URL hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(patch.before, file + ': independently frozen predecessor')
    .toBe(replayUrlRace.independentPredecessorProof.sha256);
  expect(hash(previous), file + ': preserved pre-repair Replay source').toBe(patch.before);
  return previous;
}

export function restoreHelpColdSource(
  file: string,
  source: string,
  readDependency: (path: string) => string = path =>
    readFileSync(resolve(process.cwd(), '..', path), 'utf8'),
): string {
  const patch = helpCold.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed Help host').toBe(patch.after);
  for (const dependency of helpCold.dependencies) {
    const currentDependency = nativeRepairPredecessor(dependency.file, readDependency);
    expect(hash(restoreRuntimeV9Source(dependency.file, currentDependency)), dependency.file + ': actual Help dependency')
      .toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': exact Help hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': preserved pre-Help source').toBe(patch.before);
  return previous;
}

export function restoreAppDesignSource(file: string, source: string): string {
  source = restoreNativeSourceRepair(file, source);
  source = restorePreviewChartQuerySource(file, source);
  source = restoreSettingsPreviewInvokerSource(file, source);
  source = restoreRuntimeV9Source(file, source);
  source = restoreReplayTransitionQueueSource(file, source);
  source = restoreReplayUrlRaceSource(file, source);
  source = restoreHelpColdSource(file, source);
  source = restoreTableEmptyViewportSource(file, source);
  source = restoreTableNoMatchSource(file, source);
  source = restoreCommandDeckModalSource(file, source);
  const patch = appDesign.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': reviewed application-design source').toBe(patch.after);
  for (const [owner, target] of appDesign.relocations) {
    if (owner !== file) continue;
    const dependency = appDesign.dependencies.find(entry => entry.file === target);
    if (!dependency) throw new Error('Missing reviewed cold body: ' + target);
    const body = nativeRepairPredecessor(target);
    expect(hash(body), target + ': complete relocated body').toBe(dependency.sha256);
  }
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': application-design hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': frozen pre-design source').toBe(patch.before);
  return previous;
}

export function catalogBeforeAppDesign<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog);
  const theme = previous.theme as Record<string, unknown>;
  const expected: Record<string, string> = {};
  expect(appDesign.catalogAdditions).toHaveLength(110);
  for (const addition of appDesign.catalogAdditions) {
    expect(addition.path.slice(0, -1)).toEqual(['theme', 'appDesignPreview']);
    const leaf = addition.path[addition.path.length - 1];
    expect(Object.prototype.hasOwnProperty.call(expected, leaf), leaf + ': unique approved key').toBe(false);
    expected[leaf] = addition.value;
  }
  // Exact subtree equality rejects unknown additions as well as altered defaults.
  expect(theme.appDesignPreview, 'exact additive application-preview copy').toEqual(expected);
  delete theme.appDesignPreview;
  return previous;
}

export function restoreWidgetImplementationSource(file: string, source: string): string {
  return restorePreAppDesignWidgetSource(file, restoreAppDesignSource(file, source));
}

// Fleet restoration has already consumed the newer design layer before its
// external-auth inverse. Keep that phase explicit, not an idempotent hash bypass.
export function restorePreAppDesignWidgetSource(file: string, source: string): string {
  const patch = transition.sources.find(entry => entry.file === file);
  if (!patch) return source;
  expect(hash(source), file + ': widget implementation source').toBe(patch.after);
  const lines = source.split('\n');
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.new.length), file + ': widget implementation hunk')
      .toEqual(hunk.new);
    lines.splice(hunk.start, hunk.new.length, ...hunk.old);
  }
  const previous = lines.join('\n');
  expect(hash(previous), file + ': preserved pre-widget source').toBe(patch.before);
  return previous;
}

export function catalogBeforeWidgetImplementation<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog);
  for (const change of packCopyChanges) {
    const parts = change.path.split('.');
    let parent: Record<string, unknown> = previous;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    const leaf = parts[parts.length - 1];
    expect(parent[leaf], change.path).toEqual(change.current);
    if ('previous' in change) parent[leaf] = structuredClone(change.previous);
    else delete parent[leaf];
  }
  for (const addition of transition.catalogAdditions) {
    let parent: Record<string, unknown> = previous;
    for (const part of addition.path.slice(0, -1)) {
      const child = parent[part];
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new Error('Missing widget implementation copy: ' + addition.path.join('.'));
      }
      parent = child as Record<string, unknown>;
    }
    const leaf = addition.path[addition.path.length - 1];
    expect(parent[leaf], addition.path.join('.')).toBe(addition.value);
    delete parent[leaf];
  }
  return previous;
}
