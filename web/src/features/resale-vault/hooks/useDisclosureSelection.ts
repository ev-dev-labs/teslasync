/**
 * Local React state for the user's current disclosure selection (profile,
 * effective section list, and the two sensitive-field toggles). Kept as its
 * own hook because several components need to read AND mutate the same
 * selection (profile builder, privacy preview, export panel) — lifting it
 * here avoids prop-drilling a bespoke reducer through the page.
 *
 * Purely local component state (`useState`), not persisted — a fresh visit
 * starts from the safest default (`resale` profile is a reasonable
 * default disclosure surface for the feature's primary use case, VIN
 * EXCLUDED, day-precision timestamps) rather than remembering a
 * previous, possibly more permissive, choice across sessions.
 */
import { useCallback, useMemo, useState } from 'react';
import { ALL_EVIDENCE_SECTIONS, DISCLOSURE_PROFILE_SECTIONS, type DisclosureProfileId, type EvidenceSectionId } from '../lib/constants';
import type { DisclosureSelection, VinDisclosure } from '../lib/types';

const DEFAULT_PROFILE: Exclude<DisclosureProfileId, 'custom'> = 'resale';

function defaultSelection(): DisclosureSelection {
  return {
    profileId: DEFAULT_PROFILE,
    sections: DISCLOSURE_PROFILE_SECTIONS[DEFAULT_PROFILE],
    sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
  };
}

export interface UseDisclosureSelectionResult {
  selection: DisclosureSelection;
  allSections: readonly EvidenceSectionId[];
  /** Switches profile. Built-in profiles reset the section list to their fixed default; 'custom' keeps whatever sections are currently selected. */
  setProfile: (profileId: DisclosureProfileId) => void;
  /** Toggles one section on/off. Only meaningful for the 'custom' profile — calling it while a built-in profile is active first switches to 'custom'. */
  toggleSection: (section: EvidenceSectionId) => void;
  setVinDisclosure: (value: VinDisclosure) => void;
  setExactTimestamps: (value: boolean) => void;
  reset: () => void;
}

export function useDisclosureSelection(): UseDisclosureSelectionResult {
  const [selection, setSelection] = useState<DisclosureSelection>(defaultSelection);

  const setProfile = useCallback((profileId: DisclosureProfileId) => {
    setSelection((prev) => ({
      ...prev,
      profileId,
      sections: profileId === 'custom' ? prev.sections : DISCLOSURE_PROFILE_SECTIONS[profileId],
    }));
  }, []);

  const toggleSection = useCallback((section: EvidenceSectionId) => {
    setSelection((prev) => {
      const has = prev.sections.includes(section);
      const nextSections = has ? prev.sections.filter((s) => s !== section) : [...prev.sections, section];
      return { ...prev, profileId: 'custom', sections: nextSections };
    });
  }, []);

  const setVinDisclosure = useCallback((value: VinDisclosure) => {
    setSelection((prev) => ({ ...prev, sensitive: { ...prev.sensitive, vinDisclosure: value } }));
  }, []);

  const setExactTimestamps = useCallback((value: boolean) => {
    setSelection((prev) => ({ ...prev, sensitive: { ...prev.sensitive, exactTimestamps: value } }));
  }, []);

  const reset = useCallback(() => setSelection(defaultSelection()), []);

  const allSections = useMemo(() => ALL_EVIDENCE_SECTIONS, []);

  return { selection, allSections, setProfile, toggleSection, setVinDisclosure, setExactTimestamps, reset };
}
