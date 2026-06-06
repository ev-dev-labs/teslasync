// Material 3 (Android / Jetpack Compose) emitter.
// Produces Theme.kt with lightColorScheme / darkColorScheme / highContrast
// ColorScheme builders, an M3 Typography, plus brand chart palette, spacing,
// radius, and motion objects.

import {
  loadTokens, BANNER_LINES, toComposeColor, STATUS_KEYS, TYPE_ROLES, cap,
} from './lib/tokens.mjs';

// Map our semantic roles onto the closest M3 ColorScheme slots.
function schemeBlock(name, c) {
  const L = [];
  L.push(`val ${name}: ColorScheme = ${name === 'HighContrastColorScheme' ? 'darkColorScheme' : (name === 'LightColors' ? 'lightColorScheme' : 'darkColorScheme')}(`);
  L.push(`    primary = Color(${toComposeColor(c.accent)}),`);
  L.push(`    onPrimary = Color(${toComposeColor(c.bg)}),`);
  L.push(`    background = Color(${toComposeColor(c.bg)}),`);
  L.push(`    onBackground = Color(${toComposeColor(c.textPrimary)}),`);
  L.push(`    surface = Color(${toComposeColor(c.surface)}),`);
  L.push(`    onSurface = Color(${toComposeColor(c.textPrimary)}),`);
  L.push(`    onSurfaceVariant = Color(${toComposeColor(c.textSecondary)}),`);
  L.push(`    surfaceVariant = Color(${toComposeColor(c.surfaceGlass)}),`);
  L.push(`    outline = Color(${toComposeColor(c.border)}),`);
  L.push(`    error = Color(${toComposeColor(c.status.danger)}),`);
  L.push(`    tertiary = Color(${toComposeColor(c.status.info)}),`);
  L.push(')');
  return L.join('\n');
}

const KT_WEIGHT = { regular: 'Normal', medium: 'Medium', semibold: 'SemiBold', bold: 'Bold' };

export function generateMaterial(tokens = loadTokens()) {
  const out = [];
  for (const l of BANNER_LINES) out.push(`// ${l}`);
  out.push('');
  out.push('package com.teslasync.design');
  out.push('');
  out.push('import androidx.compose.material3.ColorScheme');
  out.push('import androidx.compose.material3.Typography');
  out.push('import androidx.compose.material3.darkColorScheme');
  out.push('import androidx.compose.material3.lightColorScheme');
  out.push('import androidx.compose.ui.graphics.Color');
  out.push('import androidx.compose.ui.text.TextStyle');
  out.push('import androidx.compose.ui.text.font.FontWeight');
  out.push('import androidx.compose.ui.unit.dp');
  out.push('import androidx.compose.ui.unit.sp');
  out.push('');

  // Color schemes.
  out.push('// ── Color schemes (semantic roles → M3 ColorScheme slots) ──');
  out.push(schemeBlock('LightColors', tokens.color.light));
  out.push('');
  out.push(schemeBlock('DarkColors', tokens.color.dark));
  out.push('');
  out.push(schemeBlock('HighContrastColorScheme', tokens.color.highContrast));
  out.push('');

  // Brand status + chart palette (theme-independent).
  out.push('// ── Brand status colors (constant across themes) ──');
  out.push('object StatusColors {');
  for (const s of STATUS_KEYS) {
    out.push(`    val ${cap(s)}: Color = Color(${toComposeColor(tokens.color.dark.status[s])})`);
  }
  out.push('}');
  out.push('');
  out.push('// ── Brand chart palette (index-stable across platforms) ──');
  out.push('object ChartPalette {');
  const cat = tokens.chart.categorical.map((h) => `Color(${toComposeColor(h)})`).join(', ');
  out.push(`    val categorical: List<Color> = listOf(${cat})`);
  for (const [name, hex] of Object.entries(tokens.chart.series)) {
    out.push(`    val ${name}: Color = Color(${toComposeColor(hex)})`);
  }
  out.push('}');
  out.push('');

  // Typography.
  out.push('// ── Typography (M3 type ramp) ──');
  out.push('val AppTypography: Typography = Typography().copy(');
  const m3slot = {
    display: 'displaySmall',
    title: 'headlineMedium',
    section: 'titleLarge',
    panel: 'titleMedium',
    body: 'bodyMedium',
    bodySm: 'bodySmall',
    caption: 'labelMedium',
    label: 'labelSmall',
  };
  for (const role of TYPE_ROLES) {
    const r = tokens.typography[role];
    out.push(`    ${m3slot[role]} = TextStyle(`);
    out.push(`        fontSize = ${r.size}.sp,`);
    out.push(`        lineHeight = ${r.lineHeight}.sp,`);
    out.push(`        letterSpacing = ${r.letterSpacing.toFixed(2)}.sp,`);
    out.push(`        fontWeight = FontWeight.${KT_WEIGHT[r.weight]},`);
    out.push('    ),');
  }
  out.push(')');
  out.push('');

  // Spacing + radius (dp).
  out.push('// ── Spacing scale (dp) ──');
  out.push('object Spacing {');
  for (const [name, v] of Object.entries(tokens.spacing.scale)) {
    out.push(`    val \`${name}\` = ${v}.dp`);
  }
  out.push('}');
  out.push('');
  out.push('// ── Corner radii (dp) ──');
  out.push('object Radius {');
  for (const [name, v] of Object.entries(tokens.radius)) {
    out.push(`    val ${name} = ${v}.dp`);
  }
  out.push('}');
  out.push('');

  // Motion.
  out.push('// ── Motion durations (ms) + easing (cubic-bezier control points) ──');
  out.push('object Motion {');
  for (const [name, v] of Object.entries(tokens.motion.durations)) {
    out.push(`    const val ${name}Millis: Int = ${v}`);
  }
  for (const [name, v] of Object.entries(tokens.motion.easing)) {
    out.push(`    const val ${name}Easing: String = "${v}"`);
  }
  out.push('}');
  out.push('');

  return { rel: 'android/Theme.kt', content: out.join('\n') };
}
