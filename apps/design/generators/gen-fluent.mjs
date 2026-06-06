// Fluent (Windows / WinUI 3 / WPF) emitter.
// Produces a ResourceDictionary with ThemeDictionaries for Light / Dark /
// HighContrast color brushes, plus shared typography, spacing, radius, motion,
// and brand chart-palette resources. Colors are emitted as #AARRGGBB so glass
// surface alpha survives (Mica/Acrylic tint).

import {
  loadTokens, BANNER_LINES, toHexARGB, MODES, STATUS_KEYS, TYPE_ROLES, cap,
} from './lib/tokens.mjs';

const COLOR_ROLES = ['bg', 'surface', 'surfaceGlass', 'textPrimary', 'textSecondary', 'textMuted', 'accent', 'border'];

// Fluent uses "HighContrast" as the theme-dictionary key.
const THEME_KEY = { light: 'Light', dark: 'Dark', highContrast: 'HighContrast' };

function colorEntries(mode, c) {
  const lines = [];
  for (const role of COLOR_ROLES) {
    lines.push(`      <Color x:Key="${cap(role)}Color">${toHexARGB(c[role])}</Color>`);
  }
  for (const s of STATUS_KEYS) {
    lines.push(`      <Color x:Key="Status${cap(s)}Color">${toHexARGB(c.status[s])}</Color>`);
  }
  return lines.join('\n');
}

export function generateFluent(tokens = loadTokens()) {
  const banner = BANNER_LINES.map((l) => `     ${l}`).join('\n');
  const out = [];
  out.push('<!--');
  out.push(banner);
  out.push('-->');
  out.push('<ResourceDictionary');
  out.push('    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"');
  out.push('    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">');
  out.push('');
  out.push('  <ResourceDictionary.ThemeDictionaries>');
  for (const mode of MODES) {
    out.push(`    <ResourceDictionary x:Key="${THEME_KEY[mode]}">`);
    out.push(colorEntries(mode, tokens.color[mode]));
    out.push('    </ResourceDictionary>');
  }
  out.push('  </ResourceDictionary.ThemeDictionaries>');
  out.push('');

  // Brand chart palette (theme-independent, index-stable).
  out.push('  <!-- Brand chart palette (index-stable across platforms) -->');
  tokens.chart.categorical.forEach((hex, i) => {
    out.push(`  <Color x:Key="ChartCategorical${i}Color">${toHexARGB(hex)}</Color>`);
  });
  for (const [name, hex] of Object.entries(tokens.chart.series)) {
    out.push(`  <Color x:Key="ChartSeries${cap(name)}Color">${toHexARGB(hex)}</Color>`);
  }
  out.push('');

  // Typography (Fluent type ramp).
  out.push('  <!-- Typography type ramp -->');
  out.push(`  <FontFamily x:Key="FontFamilySans">${tokens.typography.fontFamily.sans}</FontFamily>`);
  out.push(`  <FontFamily x:Key="FontFamilyMono">${tokens.typography.fontFamily.mono}</FontFamily>`);
  for (const role of TYPE_ROLES) {
    const r = tokens.typography[role];
    out.push(`  <system:Double x:Key="FontSize${cap(role)}" xmlns:system="clr-namespace:System;assembly=mscorlib">${r.size}</system:Double>`);
  }
  for (const [name, w] of Object.entries(tokens.typography.weights)) {
    out.push(`  <FontWeight x:Key="FontWeight${cap(name)}">${w}</FontWeight>`);
  }
  out.push('');

  // Spacing (DIP) + radius.
  out.push('  <!-- Spacing scale (DIP) -->');
  out.push('  <ResourceDictionary.MergedDictionaries />');
  for (const [name, v] of Object.entries(tokens.spacing.scale)) {
    out.push(`  <Thickness x:Key="Spacing${cap(name)}">${v}</Thickness>`);
  }
  for (const [name, v] of Object.entries(tokens.radius)) {
    out.push(`  <CornerRadius x:Key="Radius${cap(name)}">${v}</CornerRadius>`);
  }
  out.push('');

  // Motion (durations as KeyTime-friendly ms, easing as cubic-bezier strings).
  out.push('  <!-- Motion durations (ms) + easing curves -->');
  for (const [name, v] of Object.entries(tokens.motion.durations)) {
    out.push(`  <Duration x:Key="MotionDuration${cap(name)}">0:0:${(v / 1000).toFixed(3)}</Duration>`);
  }
  for (const [name, v] of Object.entries(tokens.motion.easing)) {
    out.push(`  <x:String x:Key="MotionEasing${cap(name)}">${v}</x:String>`);
  }
  out.push('');
  out.push('</ResourceDictionary>');
  out.push('');

  return { rel: 'windows/Tokens.xaml', content: out.join('\n') };
}
