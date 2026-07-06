import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, FileJson, Zap } from 'lucide-react';

import { Modal, Button, Select, Textarea, Text, HelperText, ErrorText } from '@/components/ui';
import { Tabs } from '@/components/ui';
import { useUpdateTOUSettings, useRefreshTeslaEnergySiteInfo } from '@/api/hooks/useEnergy';
import type { TOUSettingsPayload, TOUPreset } from '@/types/energy';

/* ───────── Preset Tariffs ───────── */

const PRESETS: TOUPreset[] = [
  {
    id: 'pge-ev2a',
    name: 'PG&E EV2-A',
    utility: 'Pacific Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'PG&E EV2-A',
          utility: 'Pacific Gas & Electric',
          daily_charges: [{ amount: 0.32854, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.49, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.35, start: 0, end: 16 },
                { rate: 0.35, start: 21, end: 24 },
              ],
            },
            Winter: {
              ON_PEAK: [{ rate: 0.42, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.36, start: 0, end: 16 },
                { rate: 0.36, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
  {
    id: 'sce-tou-d',
    name: 'SCE TOU-D',
    utility: 'Southern California Edison',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SCE TOU-D',
          utility: 'Southern California Edison',
          daily_charges: [{ amount: 0.031, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.54, start: 16, end: 21 }],
              MID_PEAK: [
                { rate: 0.41, start: 8, end: 16 },
                { rate: 0.41, start: 21, end: 23 },
              ],
              OFF_PEAK: [
                { rate: 0.28, start: 0, end: 8 },
                { rate: 0.28, start: 23, end: 24 },
              ],
            },
            Winter: {
              MID_PEAK: [{ rate: 0.43, start: 8, end: 21 }],
              SUPER_OFF_PEAK: [
                { rate: 0.28, start: 0, end: 8 },
                { rate: 0.28, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
  {
    id: 'sdge-tou-dr1',
    name: 'SDG&E TOU-DR1',
    utility: 'San Diego Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SDG&E TOU-DR1',
          utility: 'San Diego Gas & Electric',
          daily_charges: [{ amount: 0.546, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.71, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.45, start: 0, end: 16 },
                { rate: 0.45, start: 21, end: 24 },
              ],
            },
            Winter: {
              ON_PEAK: [{ rate: 0.57, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.45, start: 0, end: 16 },
                { rate: 0.45, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
];

/* ───────── Component ───────── */

interface TOUSettingsModalProps {
  open: boolean;
  onClose: () => void;
  siteId: number;
}

export function TOUSettingsModal({ open, onClose, siteId }: TOUSettingsModalProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateTOUSettings();
  const refreshSiteInfo = useRefreshTeslaEnergySiteInfo();

  const [activeTab, setActiveTab] = useState<string>('preset');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customJSON, setCustomJSON] = useState('');
  const [error, setError] = useState('');

  const presetOptions = useMemo(
    () => PRESETS.map((p) => ({ value: p.id, label: `${p.name} — ${p.utility}` })),
    [],
  );

  const tabs = useMemo(
    () => [
      { key: 'preset', label: t('energy.tou.tabPreset', 'Preset Tariff') },
      { key: 'custom', label: t('energy.tou.tabCustom', 'Custom JSON') },
    ],
    [t],
  );

  function getPayload(): TOUSettingsPayload | null {
    setError('');

    if (activeTab === 'preset') {
      const preset = PRESETS.find((p) => p.id === selectedPreset);
      if (!preset) {
        setError(t('energy.tou.errorNoPreset', 'Please select a rate plan'));
        return null;
      }
      return preset.settings;
    }

    // Custom JSON mode
    const trimmed = customJSON.trim();
    if (!trimmed) {
      setError(t('energy.tou.errorEmptyJSON', 'Please enter the TOU settings JSON'));
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError(t('energy.tou.errorNotObject', 'JSON must be an object'));
        return null;
      }
      const obj = parsed as Record<string, unknown>;
      // Allow either the full envelope or just the inner tou_settings object
      if ('tou_settings' in obj) {
        return obj as unknown as TOUSettingsPayload;
      }
      return { tou_settings: obj };
    } catch {
      setError(t('energy.tou.errorInvalidJSON', 'Invalid JSON — please check syntax'));
      return null;
    }
  }

  function handleSubmit() {
    const payload = getPayload();
    if (!payload) return;

    updateMutation.mutate(
      { siteId, settings: payload },
      {
        onSuccess: () => {
          // Refresh site info from Tesla so the UI shows updated tariff data
          refreshSiteInfo.mutate(siteId);
          onClose();
        },
        onError: (err) => {
          setError(String(err instanceof Error ? err.message : err));
        },
      },
    );
  }

  function handleClose() {
    if (!updateMutation.isPending) {
      setError('');
      onClose();
    }
  }

  // Clear any stale validation error when the user moves between the
  // preset/custom tabs — otherwise a preset error keeps shouting at the
  // user after they've switched to the custom-JSON editor (and vice versa).
  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key);
    setError('');
  }, []);

  return (
    <Modal open={open} onClose={handleClose} title={t('energy.tou.title', 'Update Rate Plan')} size="lg">
      <div className="space-y-4">
        <Text as="p" size="sm" color="secondary">
          {t(
            'energy.tou.description',
            'Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.',
          )}
        </Text>

        <Tabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

        {activeTab === 'preset' ? (
          <div className="space-y-3">
            <Select
              label={t('energy.tou.selectPlan', 'Rate Plan')}
              placeholder={t('energy.tou.selectPlaceholder', 'Choose a rate plan…')}
              options={presetOptions}
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
            />
            {selectedPreset && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                <Text as="p" variant="bodySm" className="mb-1">
                  {t('energy.tou.previewLabel', 'Preview')}
                </Text>
                <Text as="pre" size="xs" color="secondary" mono className="overflow-auto max-h-48">
                  {JSON.stringify(PRESETS.find((p) => p.id === selectedPreset)?.settings, null, 2)}
                </Text>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              label={t('energy.tou.customLabel', 'TOU Settings JSON')}
              placeholder={`{\n  "tou_settings": {\n    "optimization_strategy": "economics",\n    "tariff_content_v2": { ... }\n  }\n}`}
              value={customJSON}
              onChange={(e) => setCustomJSON(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
            <HelperText className="flex items-center gap-1">
              <FileJson className="h-3 w-3" />
              {t(
                'energy.tou.customHint',
                'Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.',
              )}
            </HelperText>
          </div>
        )}

        {error && (
          <ErrorText className="flex items-center gap-1">
            <Zap className="h-3 w-3" /> {error}
          </ErrorText>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={updateMutation.isPending}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={updateMutation.isPending}
            disabled={updateMutation.isPending}
          >
            <Clock className="h-4 w-4 mr-1.5" />
            {t('energy.tou.submit', 'Update Rate Plan')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
