/**
 * Shared, human-readable labels/descriptions for each evidence section and
 * disclosure profile. Centralized so the profile builder, evidence
 * inventory, and privacy preview panels all describe the same section the
 * same way.
 *
 * Every label is passed through `t()` with an English fallback at the call
 * site — this module only supplies the i18n key + fallback pairs.
 */
import type { DisclosureProfileId, EvidenceSectionId } from '../lib/constants';

export const SECTION_LABEL_KEYS: Record<EvidenceSectionId, { key: string; fallback: string }> = {
  vehicle_identity: { key: 'resaleVault.section.vehicleIdentity', fallback: 'Vehicle Identity' },
  battery: { key: 'resaleVault.section.battery', fallback: 'Battery Health' },
  maintenance: { key: 'resaleVault.section.maintenance', fallback: 'Maintenance & Service' },
  software_updates: { key: 'resaleVault.section.softwareUpdates', fallback: 'Software Updates' },
  warranty: { key: 'resaleVault.section.warranty', fallback: 'Warranty' },
  driving_history: { key: 'resaleVault.section.drivingHistory', fallback: 'Driving History' },
  charging_history: { key: 'resaleVault.section.chargingHistory', fallback: 'Charging History' },
  security_incidents: { key: 'resaleVault.section.securityIncidents', fallback: 'Security Incidents' },
};

export const PROFILE_LABEL_KEYS: Record<DisclosureProfileId, { key: string; fallback: string; descriptionKey: string; descriptionFallback: string }> = {
  warranty: {
    key: 'resaleVault.profile.warranty',
    fallback: 'Warranty Claim',
    descriptionKey: 'resaleVault.profile.warrantyDesc',
    descriptionFallback: 'Identity, battery, maintenance, software, and warranty data — no driving/charging behavior.',
  },
  service: {
    key: 'resaleVault.profile.service',
    fallback: 'Service Visit',
    descriptionKey: 'resaleVault.profile.serviceDesc',
    descriptionFallback: 'What a service center needs: identity, maintenance, software, battery, and security events.',
  },
  resale: {
    key: 'resaleVault.profile.resale',
    fallback: 'Resale / Vehicle History',
    descriptionKey: 'resaleVault.profile.resaleDesc',
    descriptionFallback: 'The full scrubbed vehicle history a buyer would want to review, across every evidence category.',
  },
  custom: {
    key: 'resaleVault.profile.custom',
    fallback: 'Custom',
    descriptionKey: 'resaleVault.profile.customDesc',
    descriptionFallback: 'Pick exactly which evidence sections to include.',
  },
};
