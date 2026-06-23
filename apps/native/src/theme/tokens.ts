export const colors = {
  background: '#05070d',
  surface: 'rgba(12, 18, 31, 0.82)',
  surfaceGlass: 'rgba(14, 23, 39, 0.72)',
  surfaceRaised: 'rgba(255, 255, 255, 0.07)',
  surfaceSelected: 'rgba(53, 213, 255, 0.12)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderAccent: 'rgba(53, 213, 255, 0.42)',
  accent: '#35d5ff',
  danger: '#fb7185',
  dangerBorder: 'rgba(251, 113, 133, 0.32)',
  dangerSurface: 'rgba(251, 113, 133, 0.12)',
  success: '#34d399',
  successBorder: 'rgba(52, 211, 153, 0.32)',
  successSurface: 'rgba(52, 211, 153, 0.12)',
  warning: '#fbbf24',
  warningBorder: 'rgba(251, 191, 36, 0.32)',
  warningSurface: 'rgba(251, 191, 36, 0.12)',
  textPrimary: '#f8fafc',
  textSecondary: 'rgba(226, 232, 240, 0.78)',
  textMuted: 'rgba(148, 163, 184, 0.82)',
  glowCyan: '#0ea5e9',
  glowViolet: '#8b5cf6',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  xxl: 40,
} as const;

export const typography = {
  caption: 12,
  body: 15,
  title: 22,
  display: 34,
} as const;

export const layout = {
  sidebarWidth: 292,
} as const;

export const shadows = {
  panel: {
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 18},
    elevation: 12,
  },
} as const;
