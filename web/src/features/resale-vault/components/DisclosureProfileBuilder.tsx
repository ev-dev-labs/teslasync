/**
 * Disclosure profile builder — the primary "what am I sharing" control.
 *
 * Lets the user pick one of the built-in profiles (warranty/service/resale)
 * or switch to a fully custom section selection, plus the two user-facing
 * sensitive-field toggles (VIN disclosure, exact timestamps). Everything
 * else (locations, tokens, raw trip paths, driver identity) is a hard,
 * non-toggleable exclusion — this component never offers a control for
 * those, and says so explicitly.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { RadioCard, Checkbox, Toggle, Select } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { ShieldAlert } from 'lucide-react';
import type { DisclosureProfileId, EvidenceSectionId } from '../lib/constants';
import type { DisclosureSelection, VinDisclosure } from '../lib/types';
import { HARD_EXCLUDED_CATEGORIES } from '../lib/constants';
import { PROFILE_LABEL_KEYS, SECTION_LABEL_KEYS } from './sectionLabels';

const PROFILE_IDS: DisclosureProfileId[] = ['warranty', 'service', 'resale', 'custom'];

export interface DisclosureProfileBuilderProps {
  selection: DisclosureSelection;
  allSections: readonly EvidenceSectionId[];
  onProfileChange: (profileId: DisclosureProfileId) => void;
  onToggleSection: (section: EvidenceSectionId) => void;
  onVinDisclosureChange: (value: VinDisclosure) => void;
  onExactTimestampsChange: (value: boolean) => void;
}

export function DisclosureProfileBuilder({
  selection,
  allSections,
  onProfileChange,
  onToggleSection,
  onVinDisclosureChange,
  onExactTimestampsChange,
}: DisclosureProfileBuilderProps) {
  const { t } = useTranslation();
  const isCustom = selection.profileId === 'custom';

  const vinOptions = [
    { value: 'excluded', label: t('resaleVault.vin.excluded', 'Excluded (recommended)') },
    { value: 'masked', label: t('resaleVault.vin.masked', 'Masked (prefix + last 4)') },
    { value: 'full', label: t('resaleVault.vin.full', 'Full VIN') },
  ];

  return (
    <GlassPanel padding="lg" className="space-y-6">
      <div>
        <PanelTitle>{t('resaleVault.disclosure.title', 'Disclosure Profile')}</PanelTitle>
        <HelperText className="mt-1">
          {t(
            'resaleVault.disclosure.subtitle',
            'Choose what this report includes. Nothing is shared until you export or copy it — this only changes what would be assembled.',
          )}
        </HelperText>
      </div>

      <div role="radiogroup" aria-label={t('resaleVault.disclosure.profileGroup', 'Disclosure profile')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROFILE_IDS.map((profileId) => {
          const labels = PROFILE_LABEL_KEYS[profileId];
          return (
            <RadioCard
              key={profileId}
              name="resale-vault-profile"
              value={profileId}
              checked={selection.profileId === profileId}
              onChange={() => onProfileChange(profileId)}
              label={t(labels.key, labels.fallback)}
              description={t(labels.descriptionKey, labels.descriptionFallback)}
            />
          );
        })}
      </div>

      <div>
        <PanelTitle className="text-sm">
          {t('resaleVault.disclosure.sections', 'Evidence sections')}
        </PanelTitle>
        <HelperText className="mt-1 mb-2">
          {isCustom
            ? t('resaleVault.disclosure.sectionsCustomHint', 'Check every section this report should include.')
            : t('resaleVault.disclosure.sectionsFixedHint', 'Fixed by the selected profile. Switch to Custom to edit individually.')}
        </HelperText>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {allSections.map((section) => {
            const labels = SECTION_LABEL_KEYS[section];
            return (
              <Checkbox
                key={section}
                label={t(labels.key, labels.fallback)}
                checked={selection.sections.includes(section)}
                disabled={!isCustom}
                onChange={() => onToggleSection(section)}
              />
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label={t('resaleVault.disclosure.vinLabel', 'VIN disclosure')}
          hint={t('resaleVault.disclosure.vinHint', 'Excluded by default. Even a masked VIN narrows down the vehicle.')}
          options={vinOptions}
          value={selection.sensitive.vinDisclosure}
          onChange={(e) => onVinDisclosureChange(e.target.value as VinDisclosure)}
        />
        <div className="space-y-1">
          <Toggle
            label={t('resaleVault.disclosure.exactTimestamps', 'Use exact timestamps')}
            checked={selection.sensitive.exactTimestamps}
            onChange={onExactTimestampsChange}
          />
          <HelperText>
            {t('resaleVault.disclosure.exactTimestampsHint', 'Off by default — dates are truncated to the day.')}
          </HelperText>
        </div>
      </div>

      {selection.sensitive.exactTimestamps && (
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'resaleVault.disclosure.exactTimestampsWarning',
            'Exact timestamps can make this report easier to correlate with other data sources. Consider day precision instead.',
          )}
        </InlineCallout>
      )}
      {selection.sensitive.vinDisclosure !== 'excluded' && (
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'resaleVault.disclosure.vinWarning',
            'Disclosing the VIN (even masked) is identifying information. Only include it if the recipient specifically needs it.',
          )}
        </InlineCallout>
      )}

      <InlineCallout variant="info" icon={<ShieldAlert />}>
        {t(
          'resaleVault.disclosure.hardExclusions',
          'Always excluded, regardless of profile: {{list}}. These are never offered as a choice.',
          { list: HARD_EXCLUDED_CATEGORIES.join(', ') },
        )}
      </InlineCallout>
    </GlassPanel>
  );
}
