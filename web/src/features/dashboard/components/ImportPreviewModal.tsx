import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload, FileJson, Link2, CheckCircle2, XCircle,
  AlertTriangle, FileUp,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Modal,
  Button as UiButton,
  Tabs,
  Textarea as UiTextarea,
  Input as UiInput,
  Badge,
} from '@/components/ui';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { MiniGridPreview } from './MiniGridPreview';
import { validateImportData, fromUrlSafeBase64 } from '../hooks/validateImport';
import type { ImportValidation } from '../hooks/validateImport';
import { getWidgetDef } from '../widgets/registry';
import type { SavedDashboard } from '../widgets/types';

interface ImportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (dashboard: SavedDashboard) => void;
  /** Pre-filled JSON (e.g. from URL import) */
  initialJson?: string | null;
}

export function ImportPreviewModal({
  open,
  onClose,
  onConfirm,
  initialJson,
}: ImportPreviewModalProps) {
  const { t } = useTranslation('dashboard');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState('file');
  const [pastedJson, setPastedJson] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // If initialJson is provided, auto-validate it. Keyed on the JSON *value*
  // (not a one-shot boolean) so a parent that swaps `initialJson` while the
  // modal stays mounted re-validates the new payload instead of showing the
  // stale preview. Clicking "Back" leaves this untouched, so returning to the
  // input tabs does not immediately re-trigger the preview.
  const [autoValidatedJson, setAutoValidatedJson] = useState<string | null>(null);
  if (open && initialJson && initialJson !== autoValidatedJson) {
    setValidation(validateImportData(initialJson));
    setAutoValidatedJson(initialJson);
  }

  const resetState = useCallback(() => {
    setValidation(null);
    setParseError(null);
    setPastedJson('');
    setImportUrl('');
    setAutoValidatedJson(null);
    setActiveTab('file');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleValidate = useCallback((raw: string) => {
    setParseError(null);
    if (!raw.trim()) {
      setParseError(t('import.emptyInput', 'No data to validate'));
      return;
    }
    const result = validateImportData(raw);
    setValidation(result);
  }, [t]);

  const handleFileImport = useCallback((file: File) => {
    setParseError(null);
    file.text().then((text) => {
      handleValidate(text);
    }).catch(() => {
      setParseError(t('import.readError', 'Failed to read file'));
    });
  }, [handleValidate, t]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileImport(file);
    e.target.value = '';
  }, [handleFileImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/json' || file?.name.endsWith('.json')) {
      handleFileImport(file);
    } else {
      setParseError(t('import.invalidFileType', 'Please drop a .json file'));
    }
  }, [handleFileImport, t]);

  const handleUrlImport = useCallback((url: string) => {
    setParseError(null);
    try {
      const parsed = new URL(url);
      const hash = parsed.hash;
      const importParam = hash.startsWith('#import=') ? hash.slice('#import='.length) : null;
      const searchParam = parsed.searchParams.get('import');
      const encoded = importParam ?? searchParam;
      if (!encoded) {
        setParseError(t('import.noImportParam', 'URL does not contain an import parameter'));
        return;
      }
      const json = fromUrlSafeBase64(encoded);
      handleValidate(json);
    } catch {
      setParseError(t('import.invalidUrl', 'Invalid URL format'));
    }
  }, [handleValidate, t]);

  const handleConfirm = useCallback(() => {
    if (validation?.dashboard) {
      onConfirm(validation.dashboard);
      handleClose();
    }
  }, [validation, onConfirm, handleClose]);

  const handleBackToInput = useCallback(() => {
    setValidation(null);
    setParseError(null);
  }, []);

  const tabs = useMemo(
    () => [
      { key: 'file', label: t('import.fromFile', 'From File') },
      { key: 'paste', label: t('import.fromClipboard', 'Paste JSON') },
      { key: 'url', label: t('import.fromUrl', 'From URL') },
    ],
    [t],
  );

  // Show preview if we have validation results
  if (validation) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title={t('import.preview', 'Import Preview')}
        size="lg"
        className="bg-[#0f1218] border border-white/[0.08] text-[var(--text-on-accent)] max-h-[80vh] overflow-y-auto"
      >
        <ImportPreview
          validation={validation}
          onConfirm={handleConfirm}
          onBack={handleBackToInput}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('import.title', 'Import Dashboard')}
      size="lg"
      className="bg-[#0f1218] border border-white/[0.08] text-[var(--text-on-accent)]"
    >
      <div className="space-y-4">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
          className="border-white/[0.06]"
        />

        {activeTab === 'file' && (
          <FadeIn>
            <div
              role="tabpanel"
              aria-label={t('import.fromFile', 'From File')}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
                isDragOver
                  ? 'border-[var(--theme-primary)]/40 bg-[var(--theme-primary)]/5'
                  : 'border-[var(--border-subtle)]',
              )}
            >
              <Upload className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                {t('import.dropFile', 'Drop a .json file here or click to browse')}
              </p>
              <UiButton variant="ghost" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" />
                {t('import.browse', 'Browse Files')}
              </UiButton>
              <UiInput
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
                aria-label={t('import.fileInput', 'Dashboard JSON file')}
              />
            </div>
          </FadeIn>
        )}

        {activeTab === 'paste' && (
          <FadeIn>
            <div className="space-y-3" role="tabpanel" aria-label={t('import.fromClipboard', 'Paste JSON')}>
              <UiTextarea
                value={pastedJson}
                onChange={(e) => setPastedJson(e.target.value)}
                placeholder='{"name": "My Dashboard", "widgets": [...], "layouts": {...}}'
                rows={10}
                className="font-mono text-xs"
              />
              <UiButton
                variant="primary"
                onClick={() => handleValidate(pastedJson)}
                disabled={!pastedJson.trim()}
              >
                <FileJson className="h-4 w-4 mr-2" />
                {t('import.validate', 'Validate & Preview')}
              </UiButton>
            </div>
          </FadeIn>
        )}

        {activeTab === 'url' && (
          <FadeIn>
            <div className="space-y-3" role="tabpanel" aria-label={t('import.fromUrl', 'From URL')}>
              <UiInput
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://teslasync.example.com/dashboard#import=..."
                icon={<Link2 className="h-4 w-4" />}
              />
              <UiButton
                variant="primary"
                onClick={() => handleUrlImport(importUrl)}
                disabled={!importUrl.trim()}
              >
                {t('import.loadUrl', 'Load from URL')}
              </UiButton>
            </div>
          </FadeIn>
        )}

        {parseError && (
          <AlertBanner variant="danger" icon={<AlertTriangle className="h-4 w-4" />}>
            {parseError}
          </AlertBanner>
        )}
      </div>
    </Modal>
  );
}

/* ─── Import Preview Sub-component ─── */

function ImportPreview({
  validation,
  onConfirm,
  onBack,
}: {
  validation: ImportValidation;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const {
    isValid,
    errors = [],
    warnings = [],
    dashboard,
    missingWidgets = [],
    availableWidgets = [],
  } = validation;

  return (
    <div className="space-y-4">
      {/* Errors */}
      {errors.length > 0 && (
        <AlertBanner variant="danger" icon={<XCircle className="h-4 w-4" />}>
          <ul className="list-disc pl-4 space-y-1">
            {errors.map((err, i) => (
              <li key={i} className="text-sm">{err}</li>
            ))}
          </ul>
        </AlertBanner>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <AlertBanner variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
          <ul className="list-disc pl-4 space-y-1">
            {warnings.map((warn, i) => (
              <li key={i} className="text-sm">{warn}</li>
            ))}
          </ul>
        </AlertBanner>
      )}

      {dashboard ? (
        <FadeIn>
          <div className="space-y-4">
            {/* Dashboard summary + preview */}
            <div className="flex gap-4">
              <div className="w-40 shrink-0">
                <MiniGridPreview dashboard={dashboard} />
              </div>
              <div className="min-w-0 space-y-1.5">
                <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
                  {dashboard.name}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="neutral">
                    {t('import.availableCount', '{{count}} widgets', {
                      count: availableWidgets.length,
                    })}
                  </Badge>
                  {missingWidgets.length > 0 && (
                    <Badge variant="neutral">
                      {t('import.missingCount', '{{count}} skipped', {
                        count: missingWidgets.length,
                      })}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Widget availability list */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                {t('import.widgets', 'Widgets')}
              </p>
              {availableWidgets.map((widgetId) => {
                const def = getWidgetDef(widgetId);
                const Icon = def?.icon;
                return (
                  <div
                    key={widgetId}
                    className="flex items-center gap-2 text-sm rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    {Icon && <Icon className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />}
                    <span className="text-[var(--text-secondary)] truncate">{def?.name ?? widgetId}</span>
                  </div>
                );
              })}
              {missingWidgets.map((widgetId) => (
                <div
                  key={widgetId}
                  className="flex items-center gap-2 text-sm rounded-lg bg-white/[0.02] border border-red-500/10 px-3 py-2"
                >
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <span className="text-[var(--text-muted)] truncate line-through">{widgetId}</span>
                  <span className="text-xs text-red-400/60 ml-auto shrink-0">
                    {t('import.notAvailable', 'Not available')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('import.cannotPreview', 'Cannot preview this layout')} />
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <UiButton variant="ghost" size="sm" onClick={onBack}>
          {t('import.back', 'Back')}
        </UiButton>
        {isValid && dashboard && (
          <UiButton variant="primary" size="sm" onClick={onConfirm}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {t('import.confirm', 'Import Dashboard')}
          </UiButton>
        )}
      </div>
    </div>
  );
}
