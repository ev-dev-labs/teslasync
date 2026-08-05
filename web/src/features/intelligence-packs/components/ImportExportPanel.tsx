/**
 * Import a standalone signed-envelope `.json` file (or pasted text) and
 * export any installed pack back out. Import ALWAYS re-runs the exact same
 * parse/validate/verify pipeline used for the bundled catalog — there is
 * no "trust because it came from disk" shortcut. A successfully-parsed
 * import is handed to the same `PackDetailModal` install/trust flow as any
 * catalog entry; nothing is installed directly from this panel.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileJson, Upload } from 'lucide-react';
import { Button, Input, Textarea } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { useInstalledPacks } from '../hooks/useInstalledPacks';
import { downloadEnvelope, parseImportedEnvelopeText, readFileAsText } from '../lib/manifestImportExport';
import { PackDetailModal } from './PackDetailModal';
import type { CatalogEntryWithStatus } from '../hooks/useCatalog';
import type { SignedPackEnvelope } from '../lib/manifestTypes';

export function ImportExportPanel() {
  const { t } = useTranslation();
  const installedQuery = useInstalledPacks();
  const [pastedText, setPastedText] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [imported, setImported] = useState<SignedPackEnvelope | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const installedRecords = installedQuery.data ?? [];

  function handleParsed(rawText: string) {
    const outcome = parseImportedEnvelopeText(rawText);
    if (!outcome.ok || !outcome.envelope) {
      setParseErrors(outcome.errors.length > 0 ? outcome.errors : [t('intelPacks.import.unknownError', 'Could not parse this file.')]);
      setImported(null);
      return;
    }
    setParseErrors([]);
    setImported(outcome.envelope);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      handleParsed(text);
    } catch {
      setParseErrors([t('intelPacks.import.readError', 'Could not read the selected file.')]);
    }
  }

  const installedMatch = imported ? installedRecords.find((r) => r.packId === imported.manifest.id) : undefined;
  const importedEntry: CatalogEntryWithStatus | null = imported
    ? {
        envelope: imported,
        sourceNote: t('intelPacks.import.sourceNote', 'Imported manually — re-parsed and re-verified through the exact same pipeline as the bundled catalog.'),
        installedVersion: installedMatch?.envelope.manifest.version ?? null,
        isUpToDate: installedMatch?.envelope.manifest.version === imported.manifest.version,
      }
    : null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('intelPacks.import.title', 'Import a manifest')}</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {t(
            'intelPacks.import.description',
            'Import re-runs the full parser, structural limits, expression-safety checks, and signature verification — nothing is trusted just because it came from a file.',
          )}
        </p>

        <Input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
          aria-label={t('intelPacks.import.chooseFile', 'Choose file…')}
          data-testid="intel-packs-import-file-input"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileInputRef.current?.click()}>
            {t('intelPacks.import.chooseFile', 'Choose file…')}
          </Button>
        </div>

        <Textarea
          label={t('intelPacks.import.pasteLabel', 'Or paste envelope JSON')}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder='{"envelopeVersion": 1, "manifest": {...}, "signature": null}'
        />
        <Button variant="secondary" size="sm" onClick={() => handleParsed(pastedText)} disabled={!pastedText.trim()}>
          {t('intelPacks.import.parse', 'Parse pasted JSON')}
        </Button>

        {parseErrors.length > 0 && (
          <AlertBanner variant="danger" title={t('intelPacks.import.errorTitle', 'Import rejected')}>
            <ul className="list-disc pl-4 space-y-0.5">
              {parseErrors.slice(0, 10).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </AlertBanner>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('intelPacks.export.title', 'Export an installed pack')}</h3>
        {installedRecords.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">{t('intelPacks.export.empty', 'No installed packs to export yet.')}</p>
        ) : (
          <ul className="space-y-2">
            {installedRecords.map((r) => (
              <li key={r.packId} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-[var(--text-primary)] min-w-0">
                  <FileJson className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <span className="truncate">{r.envelope.manifest.name} · v{r.envelope.manifest.version}</span>
                </span>
                <Button variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadEnvelope(r.envelope)}>
                  {t('intelPacks.export.download', 'Export')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PackDetailModal entry={importedEntry} open={importedEntry != null} onClose={() => setImported(null)} />
    </div>
  );
}
