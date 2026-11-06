import { expect } from 'vitest'

export const acceptedThemeColors = [
  ['theme-accent', 'rgba(var(--theme-primary-rgb), <alpha-value>)'],
  ['status-info', 'rgb(var(--semantic-info-rgb) / <alpha-value>)'],
  ['status-activity', 'rgb(var(--semantic-activity-rgb) / <alpha-value>)'],
  ['status-update', 'rgb(var(--semantic-update-rgb) / <alpha-value>)'],
] as const

const resolvedColorGroups = [
  'accentColor', 'backgroundColor', 'borderColor', 'boxShadowColor',
  'caretColor', 'colors', 'divideColor', 'fill', 'gradientColorStops',
  'outlineColor', 'placeholderColor', 'ringColor', 'ringOffsetColor',
  'stroke', 'textColor', 'textDecorationColor',
] as const

export function projectAcceptedThemeColors<T extends { theme: object }>(config: T) {
  const theme = { ...config.theme }
  const entries: [string, unknown][] = Object.entries(config.theme)
  for (const group of resolvedColorGroups) {
    const colors = entries.find(([name]) => name === group)?.[1]
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
      throw new Error(`Missing resolved color group: ${group}`)
    }
    const previousColors = { ...colors }
    for (const [name, value] of acceptedThemeColors) {
      expect(previousColors, group).toHaveProperty(name, value)
      Reflect.deleteProperty(previousColors, name)
    }
    Object.assign(theme, { [group]: previousColors })
  }
  return { ...config, theme }
}
