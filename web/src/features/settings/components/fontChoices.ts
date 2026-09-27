import {
  SANS_FAMILY_IDS, MONO_FAMILY_IDS,
  type FontFamilyId, type MonoFamilyId,
} from '@/components/ui/FontProvider'

export const SANS_LABELS: Record<FontFamilyId, string> = {
  inter: 'Inter',
  system: 'System UI',
  roboto: 'Roboto',
  source: 'Source Sans 3',
  plex: 'IBM Plex Sans',
  atkinson: 'Atkinson Hyperlegible',
  nunito: 'Nunito',
  'dm-sans': 'DM Sans',
  manrope: 'Manrope',
  outfit: 'Outfit',
  poppins: 'Poppins',
  'work-sans': 'Work Sans',
  'public-sans': 'Public Sans',
  lato: 'Lato',
  'open-sans': 'Open Sans',
  'noto-sans': 'Noto Sans',
  custom: 'Custom',
}

export const MONO_LABELS: Record<MonoFamilyId, string> = {
  jetbrains: 'JetBrains Mono',
  fira: 'Fira Code',
  'plex-mono': 'IBM Plex Mono',
  'source-code-pro': 'Source Code Pro',
  'roboto-mono': 'Roboto Mono',
  inconsolata: 'Inconsolata',
  'space-mono': 'Space Mono',
  'ubuntu-mono': 'Ubuntu Mono',
  system: 'System Mono',
  custom: 'Custom',
}

export const SANS_GROUPS: Record<FontFamilyId, string> = {
  inter: 'Everyday',
  system: 'System & custom',
  roboto: 'Everyday',
  source: 'Readable',
  plex: 'Readable',
  atkinson: 'Readable',
  nunito: 'Rounded',
  'dm-sans': 'Modern',
  manrope: 'Modern',
  outfit: 'Modern',
  poppins: 'Rounded',
  'work-sans': 'Readable',
  'public-sans': 'Readable',
  lato: 'Everyday',
  'open-sans': 'Everyday',
  'noto-sans': 'Readable',
  custom: 'System & custom',
}

export const SANS_CHOICES = SANS_FAMILY_IDS.map(id => ({
  id, name: SANS_LABELS[id], group: SANS_GROUPS[id],
}))

export const MONO_CHOICES = MONO_FAMILY_IDS.map(id => ({
  id, name: MONO_LABELS[id],
}))
