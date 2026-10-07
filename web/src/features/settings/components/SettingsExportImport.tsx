/**
 * Settings export/import UI.
 *
 * Renders a single GlassPanel under <section id="backup"> on the
 * Settings page with two flows:
 *
 *   1. Export — single button that fetches /settings/export, drops
 *      the JSON into the user's downloads folder, and surfaces a
 *      toast confirming the section counts.
 *
 *   2. Import — file picker / drag-drop intake. On parse the SPA
 *      validates schema_version locally (early reject), then runs a
 *      dry-run preview (POST /settings/import { dry_run: true }) and
 *      renders the per-section {added, updated, skipped} summary. The
 *      Apply button reissues the same payload with dry_run=false; the
 *      shared `request()` client transparently triggers the existing
 *      <ReauthDialog> step-up flow because the route is gated by
 *      RequireSudo on the backend.
 *
 * The whole panel never throws: parse errors render an inline ErrorText
 * and a "Choose another file" button. Apply errors keep the dry-run
 * preview visible so the user can retry without re-uploading.
 */

import { useCallback, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Download, Upload, FileJson, AlertTriangle } from 'lucide-react';
import { fmtInt } from '@/lib/numberFormat';

import {
  GlassPanel,
  IconBox,
  Button,
  Heading,
  Text,
  ErrorText,
  HelperText,
  Code,
  Input,
} from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { isApiError, SudoCanceledError } from '@/api/client';
import { useToast } from '@/components/feedback/Toast';
import {
  useExportSettings,
  useDryRunImport,
  useApplyImport,
  downloadSettingsBundle,
} from '@/api/hooks/useSettingsBackup';
import {
  validateSettingsBundle,
  summariseImportResult,
  SETTINGS_BUNDLE_SECTION_KEYS,
  type SettingsBundle,
  type SettingsImportResult,
  type SettingsBundleSectionKey,
} from '@/lib/settingsImportSchema';

const MAX_IMPORT_FILE_BYTES = 1 << 20; // 1 MiB — matches backend MaxSettingsImportBodyBytes

type ImportStage = 'idle' | 'parsing' | 'preview' | 'applied';

interface PendingImport {
  bundle: SettingsBundle;
  filename: string;
  sizeBytes: number;
}

export function SettingsExportImport() {
  const { t } = useTranslation('settings');
  const toast = useToast();

  const exportMut = useExportSettings();
  const dryRunMut = useDryRunImport();
  const applyMut = useApplyImport();

  const [pending, setPending] = useState<PendingImport | null>(null);
  const [stage, setStage] = useState<ImportStage>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<SettingsImportResult | null>(null);
  const [appliedResult, setAppliedResult] = useState<SettingsImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputId = useId();

  const summary = useMemo(
    () => (previewResult ? summariseImportResult(previewResult) : null),
    [previewResult],
  );

  const resetImport = useCallback(() => {
    setPending(null);
    setStage('idle');
    setParseError(null);
    setPreviewResult(null);
    setAppliedResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const bundle = await exportMut.mutateAsync();
      downloadSettingsBundle(bundle);
      toast.success(
        t('backup.export.successTitle', 'Settings exported'),
        t('backup.export.successDetail', 'Saved to your downloads folder.'),
      );
    } catch {
      // useExportSettings already surfaces a toast via useMutationToast.
    }
  }, [exportMut, t, toast]);

  const ingestFile = useCallback(
    async (file: File) => {
      resetImport();
      setStage('parsing');

      if (file.size > MAX_IMPORT_FILE_BYTES) {
        setStage('idle');
        setParseError(
          t('backup.import.errorTooLarge', 'File is too large (max 1 MB).'),
        );
        return;
      }

      let text: string;
      try {
        text = await file.text();
      } catch {
        setStage('idle');
        setParseError(t('backup.import.errorRead', 'Failed to read the file.'));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setStage('idle');
        setParseError(
          t('backup.import.errorJson', 'File is not valid JSON: {{detail}}', {
            detail: err instanceof Error ? err.message : 'parse error',
          }),
        );
        return;
      }

      const validation = validateSettingsBundle(parsed);
      if (typeof validation === 'string') {
        setStage('idle');
        setParseError(validation);
        return;
      }

      const next: PendingImport = {
        bundle: validation,
        filename: file.name,
        sizeBytes: file.size,
      };
      setPending(next);

      try {
        const result = await dryRunMut.mutateAsync({ bundle: validation });
        setPreviewResult(result);
        setStage('preview');
      } catch (err) {
        setStage('idle');
        setPending(null);
        setParseError(
          isApiError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : t('backup.import.errorPreview', 'Failed to preview import.'),
        );
      }
    },
    [dryRunMut, resetImport, t],
  );

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void ingestFile(file);
    },
    [ingestFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void ingestFile(file);
    },
    [ingestFile],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleApply = useCallback(async () => {
    if (!pending) return;
    try {
      const result = await applyMut.mutateAsync({ bundle: pending.bundle });
      setAppliedResult(result);
      setStage('applied');
      const applied = summariseImportResult(result);
      toast.success(
        t('backup.import.appliedTitle', 'Settings imported'),
        t('backup.import.appliedDetail', '{{added}} added, {{updated}} updated, {{skipped}} skipped.', {
          added: applied.added,
          updated: applied.updated,
          skipped: applied.skipped,
        }),
      );
    } catch (err) {
      if (err instanceof SudoCanceledError) {
        // User cancelled the step-up — treat as a non-error and keep
        // the dry-run preview visible so they can retry.
        return;
      }
      // useApplyImport already surfaces a toast via useMutationToast.
    }
  }, [applyMut, pending, t, toast]);

  return (
    <FadeIn>
      <GlassPanel className="p-5 space-y-5" data-testid="settings-export-import">
        <div className="flex items-start gap-4">
          <IconBox color="cyan">
            <Database className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <Heading level="section">
              {t('backup.title', 'Backup & Restore')}
            </Heading>
            <Text variant="bodySm">
              {t(
                'backup.subtitle',
                'Export your TeslaSync configuration as a JSON file you can stash in a backup folder or git repo, and import it on a fresh install.',
              )}
            </Text>
          </div>
        </div>

        {/* Export row */}
        <div className="border-t border-[var(--border-subtle)] pt-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <Heading level="panel">{t('backup.export.title', 'Export settings')}</Heading>
            <HelperText>
              {t(
                'backup.export.help',
                'Includes general settings, alert rules, geofences, and your quiet-hours windows. Tesla credentials and notification-channel secrets are NEVER exported.',
              )}
            </HelperText>
          </div>
          <Button
            onClick={handleExport}
            disabled={exportMut.isPending}
            loading={exportMut.isPending}
            icon={<Download className="h-4 w-4" />}
            data-testid="settings-export-button"
          >
            {exportMut.isPending
              ? t('backup.export.busy', 'Exporting…')
              : t('backup.export.cta', 'Export JSON')}
          </Button>
        </div>

        {/* Import row */}
        <div className="border-t border-[var(--border-subtle)] pt-4 space-y-3">
          <div>
            <Heading level="panel">{t('backup.import.title', 'Import settings')}</Heading>
            <HelperText>
              {t(
                'backup.import.help',
                'Drop or pick a previously exported bundle. Existing items with the same name are updated; nothing is deleted.',
              )}
            </HelperText>
          </div>

          {stage !== 'preview' && stage !== 'applied' && (
            <div
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? 'border-neon-cyan bg-neon-cyan/5'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-2)]'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="settings-import-dropzone"
            >
              <FileJson className="h-8 w-8 mx-auto text-[var(--text-muted)] mb-2" aria-hidden />
              <Text variant="bodySm">
                {t('backup.import.dropPrompt', 'Drag a JSON bundle here, or')}
              </Text>
              <Input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleFileChange}
                data-testid="settings-import-file-input"
              />
              <Button
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={stage === 'parsing'}
                loading={stage === 'parsing'}
                icon={<Upload className="h-4 w-4" />}
                className="mt-2"
              >
                {stage === 'parsing'
                  ? t('backup.import.parsing', 'Reading…')
                  : t('backup.import.choose', 'Choose a file')}
              </Button>
            </div>
          )}

          {parseError && (
            <div
              className="rounded-md border border-tesla-red/30 bg-tesla-red/5 p-3 flex items-start gap-2"
              data-testid="settings-import-error"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 text-rose-300 shrink-0" aria-hidden />
              <ErrorText>{parseError}</ErrorText>
            </div>
          )}

          {stage === 'preview' && pending && previewResult && (
            <div className="space-y-3" data-testid="settings-import-preview">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Text variant="bodySm">
                    {t('backup.import.previewHeader', 'Previewing {{name}} ({{size}} bytes)', {
                      name: pending.filename,
                      size: fmtInt(pending.sizeBytes),
                    })}
                  </Text>
                  {summary && (
                    <HelperText>
                      {t(
                        'backup.import.summary',
                        '{{added}} added, {{updated}} updated, {{skipped}} unchanged',
                        {
                          added: summary.added,
                          updated: summary.updated,
                          skipped: summary.skipped,
                        },
                      )}
                    </HelperText>
                  )}
                </div>
                <Button variant="ghost" onClick={resetImport}>
                  {t('backup.import.changeFile', 'Change file')}
                </Button>
              </div>

              <SectionDiffList result={previewResult} />

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={resetImport} disabled={applyMut.isPending}>
                  {t('backup.import.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={applyMut.isPending || (summary != null && summary.total === 0)}
                  loading={applyMut.isPending}
                  data-testid="settings-import-apply"
                >
                  {applyMut.isPending ? (
                    t('backup.import.applying', 'Applying…')
                  ) : summary && summary.total > 0 ? (
                    t('backup.import.applyCount', 'Apply {{count}} change(s)', {
                      count: summary.total,
                    })
                  ) : (
                    t('backup.import.applyNoChanges', 'Nothing to apply')
                  )}
                </Button>
              </div>
            </div>
          )}

          {stage === 'applied' && appliedResult && (
            <div className="space-y-3" data-testid="settings-import-applied">
              <Text variant="bodySm">
                {t('backup.import.appliedHeader', 'Import complete')}
              </Text>
              <SectionDiffList result={appliedResult} />
              <div className="flex justify-end">
                <Button variant="ghost" onClick={resetImport}>
                  {t('backup.import.done', 'Done')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}

interface SectionDiffListProps {
  result: SettingsImportResult;
}

function SectionDiffList({ result }: SectionDiffListProps) {
  const { t } = useTranslation('settings');
  const sectionLabels: Record<SettingsBundleSectionKey, string> = {
    settings: t('backup.section.settings', 'General settings'),
    alert_rules: t('backup.section.alertRules', 'Alert rules'),
    geofences: t('backup.section.geofences', 'Geofences'),
    quiet_hours: t('backup.section.quietHours', 'Quiet hours'),
  };
  const rows = SETTINGS_BUNDLE_SECTION_KEYS.map((key) => ({
    key,
    label: sectionLabels[key],
    counts: result.sections[key],
  }));
  return (
    <ul className="space-y-1.5" data-testid="settings-import-section-list">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-[var(--text-primary)]">{row.label}</span>
          {row.counts ? (
            <Code>
              +{row.counts.added} ~{row.counts.updated} ={row.counts.skipped}
            </Code>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          )}
        </li>
      ))}
    </ul>
  );
}
