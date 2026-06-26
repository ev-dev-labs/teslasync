import React from 'react';
import {ActivityIndicator, Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  useApplyImport,
  useDryRunImport,
  useExportSettings,
  type SettingsBundle,
  type SettingsImportResult,
} from '../src/web-parity/api/hooks/useSettingsBackup';
import {SudoCanceledError} from '../src/web-parity/api/client';
import {
  SettingsExportImport,
  type ImportFileLike,
} from '../src/web-parity/features/settings/components/SettingsExportImport';

jest.mock('../src/web-parity/api/hooks/useSettingsBackup', () => {
  const actual = jest.requireActual(
    '../src/web-parity/api/hooks/useSettingsBackup',
  );
  return {
    ...actual,
    useExportSettings: jest.fn(),
    useDryRunImport: jest.fn(),
    useApplyImport: jest.fn(),
  };
});

const mockUseExportSettings = useExportSettings as unknown as jest.Mock;
const mockUseDryRunImport = useDryRunImport as unknown as jest.Mock;
const mockUseApplyImport = useApplyImport as unknown as jest.Mock;

const validBundle: SettingsBundle = {
  schema_version: 1,
  exported_at: '2026-01-02T03:04:05Z',
  sections: {
    settings: {theme: 'dark'},
    alert_rules: [{id: 1}],
    geofences: [],
    quiet_hours: [],
  },
};

const dryRunResult: SettingsImportResult = {
  dry_run: true,
  sections: {
    settings: {added: 1, updated: 2, skipped: 3},
    alert_rules: {added: 0, updated: 1, skipped: 0},
  },
};

const applyResult: SettingsImportResult = {
  dry_run: false,
  sections: {
    settings: {added: 1, updated: 2, skipped: 3},
  },
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

function makeFileSource(json: string, name = 'backup.json'): jest.Mock {
  const file: ImportFileLike = {
    name,
    size: json.length,
    text: jest.fn().mockResolvedValue(json),
  };
  return jest.fn().mockResolvedValue(file);
}

async function renderComponent(props?: {
  importFileSource?: () => Promise<ImportFileLike | null>;
}) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<SettingsExportImport {...props} />);
  });
  return tree;
}

async function pressAsync(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  await ReactTestRenderer.act(async () => {
    const node = tree?.root
      .findAllByProps({testID})
      .find(candidate => typeof candidate.props.onPress === 'function');
    expect(node).toBeDefined();
    await node?.props.onPress();
  });
  // Flush the un-awaited ingest chain (file.text + dry-run/apply mutateAsync).
  for (let i = 0; i < 3; i += 1) {
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockUseExportSettings.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(validBundle),
    isPending: false,
  });
  mockUseDryRunImport.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(dryRunResult),
    isPending: false,
  });
  mockUseApplyImport.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(applyResult),
    isPending: false,
  });
});

test('renders the backup header, export + import sections (idle)', async () => {
  const tree = await renderComponent();
  const text = serialize(tree);

  expect(text).toContain('Backup & Restore');
  expect(text).toContain('Export settings');
  expect(text).toContain('Export JSON');
  expect(text).toContain('Import settings');
  expect(text).toContain('Drag a JSON bundle here, or');
  expect(text).toContain('Choose a file');

  // The dropzone + export button render; no preview yet.
  expect(countByTestId(tree, 'settings-import-dropzone')).toBe(1);
  expect(countByTestId(tree, 'settings-export-button')).toBe(1);
  expect(countByTestId(tree, 'settings-import-preview')).toBe(0);

  // With no native file source wired, the explicit unavailable note shows.
  expect(countByTestId(tree, 'settings-import-unavailable')).toBe(1);
  expect(text).toContain('platform document picker');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('export fetches the bundle and surfaces the save-as-unavailable notice', async () => {
  const mutateAsync = jest.fn().mockResolvedValue(validBundle);
  mockUseExportSettings.mockReturnValue({mutateAsync, isPending: false});

  const tree = await renderComponent();

  await pressAsync(tree, 'settings-export-button');

  expect(mutateAsync).toHaveBeenCalledTimes(1);
  // The export "bundle ready" notice renders with the default filename.
  expect(countByTestId(tree, 'settings-export-ready')).toBe(1);
  expect(serialize(tree)).toContain('teslasync-settings-');
  // An Alert (native toast) explained the unavailable save-as.
  expect(Alert.alert).toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a pending export shows the busy spinner + label on the button', async () => {
  mockUseExportSettings.mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: true,
  });

  const tree = await renderComponent();

  expect(tree?.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  expect(serialize(tree)).toContain('Exporting…');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('an injected file source drives validate → dry-run → preview → apply', async () => {
  const dryRun = jest.fn().mockResolvedValue(dryRunResult);
  const apply = jest.fn().mockResolvedValue(applyResult);
  mockUseDryRunImport.mockReturnValue({mutateAsync: dryRun, isPending: false});
  mockUseApplyImport.mockReturnValue({mutateAsync: apply, isPending: false});

  const importFileSource = makeFileSource(JSON.stringify(validBundle));
  const tree = await renderComponent({importFileSource});

  await pressAsync(tree, 'settings-import-dropzone');

  // The dry-run preview now renders the per-section diff.
  expect(importFileSource).toHaveBeenCalledTimes(1);
  expect(dryRun).toHaveBeenCalledTimes(1);
  expect(dryRun.mock.calls[0][0]).toMatchObject({
    bundle: {schema_version: 1},
  });
  expect(countByTestId(tree, 'settings-import-preview')).toBe(1);

  const previewText = serialize(tree);
  expect(previewText).toContain('Previewing backup.json');
  expect(previewText).toContain('General settings');
  expect(previewText).toContain('Alert rules');
  expect(previewText).toContain('+1 ~2 =3');
  // total = added(1+0) + updated(2+1) = 4.
  expect(previewText).toContain('Apply 4 change(s)');

  await pressAsync(tree, 'settings-import-apply');

  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toMatchObject({bundle: {schema_version: 1}});
  expect(countByTestId(tree, 'settings-import-applied')).toBe(1);
  expect(serialize(tree)).toContain('Import complete');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('an invalid JSON file renders an inline parse error, never throws', async () => {
  const importFileSource = makeFileSource('{ not json');
  const tree = await renderComponent({importFileSource});

  await pressAsync(tree, 'settings-import-dropzone');

  expect(countByTestId(tree, 'settings-import-error')).toBe(1);
  expect(serialize(tree)).toContain('File is not valid JSON');
  // The pipeline never reached the dry-run preview.
  expect(countByTestId(tree, 'settings-import-preview')).toBe(0);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a schema-version mismatch is rejected locally before any dry-run', async () => {
  const dryRun = jest.fn().mockResolvedValue(dryRunResult);
  mockUseDryRunImport.mockReturnValue({mutateAsync: dryRun, isPending: false});

  const importFileSource = makeFileSource(
    JSON.stringify({
      schema_version: 99,
      exported_at: '2026-01-02T03:04:05Z',
      sections: {},
    }),
  );
  const tree = await renderComponent({importFileSource});

  await pressAsync(tree, 'settings-import-dropzone');

  expect(dryRun).not.toHaveBeenCalled();
  expect(countByTestId(tree, 'settings-import-error')).toBe(1);
  expect(serialize(tree)).toContain('newer than this build supports');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a cancelled step-up keeps the dry-run preview visible', async () => {
  const dryRun = jest.fn().mockResolvedValue(dryRunResult);
  const apply = jest.fn().mockRejectedValue(new SudoCanceledError());
  mockUseDryRunImport.mockReturnValue({mutateAsync: dryRun, isPending: false});
  mockUseApplyImport.mockReturnValue({mutateAsync: apply, isPending: false});

  const importFileSource = makeFileSource(JSON.stringify(validBundle));
  const tree = await renderComponent({importFileSource});

  await pressAsync(tree, 'settings-import-dropzone');
  expect(countByTestId(tree, 'settings-import-preview')).toBe(1);

  await pressAsync(tree, 'settings-import-apply');

  // Apply was attempted but the cancel is swallowed; preview stays.
  expect(apply).toHaveBeenCalledTimes(1);
  expect(countByTestId(tree, 'settings-import-applied')).toBe(0);
  expect(countByTestId(tree, 'settings-import-preview')).toBe(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('with no native file source, choosing a file explains it is unavailable', async () => {
  const tree = await renderComponent();

  await pressAsync(tree, 'settings-import-dropzone');

  // No dry-run; an Alert explained the unavailable picker.
  expect(mockUseDryRunImport.mock.results[0].value.mutateAsync).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith(
    'File import unavailable',
    expect.stringContaining('document picker'),
  );

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
