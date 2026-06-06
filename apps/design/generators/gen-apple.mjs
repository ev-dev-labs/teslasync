// Apple (HIG / SwiftUI) emitter.
// Produces Tokens.swift with semantic Color tokens that resolve light / dark /
// high-contrast via UITraitCollection, an SF/Dynamic-Type-friendly Font ramp,
// plus brand chart palette, spacing, radius, and motion.

import {
  loadTokens, BANNER_LINES, toSwiftComponents, STATUS_KEYS, TYPE_ROLES, cap,
} from './lib/tokens.mjs';

const COLOR_ROLES = ['bg', 'surface', 'surfaceGlass', 'textPrimary', 'textSecondary', 'textMuted', 'accent', 'border'];

function srgb(value) {
  const c = toSwiftComponents(value);
  return `red: ${c.red}, green: ${c.green}, blue: ${c.blue}, opacity: ${c.opacity}`;
}

// Semantic color: resolves light / dark / high-contrast at runtime via the
// cross-platform `tsDynamicColor` shim emitted below (UIKit on iOS, AppKit on
// macOS). Indented for `extension Color { enum TS { … } }` (8 spaces).
function dynamicColor(name, light, dark, hc) {
  return [
    `        static let ${name} = tsDynamicColor(`,
    `            light: ${comps(light)},`,
    `            dark: ${comps(dark)},`,
    `            highContrast: ${comps(hc)}`,
    '        )',
  ].join('\n');
}

// Named-tuple sRGB components consumed by `tsDynamicColor`.
function comps(value) {
  const c = toSwiftComponents(value);
  return `(red: ${c.red}, green: ${c.green}, blue: ${c.blue}, alpha: ${c.opacity})`;
}

// Cross-platform appearance-aware color shim. macOS + iOS share one SwiftUI
// layer (ADR-002), so the generated tokens must compile on AppKit and UIKit.
const DYNAMIC_COLOR_HELPER = [
  'private typealias TSColorComponents = (red: Double, green: Double, blue: Double, alpha: Double)',
  '',
  'private func tsDynamicColor(',
  '    light: TSColorComponents,',
  '    dark: TSColorComponents,',
  '    highContrast: TSColorComponents',
  ') -> Color {',
  '    #if canImport(UIKit)',
  '    return Color(UIColor { traits in',
  '        let resolved: TSColorComponents',
  '        if traits.accessibilityContrast == .high {',
  '            resolved = highContrast',
  '        } else {',
  '            resolved = traits.userInterfaceStyle == .dark ? dark : light',
  '        }',
  '        return UIColor(red: resolved.red, green: resolved.green, blue: resolved.blue, alpha: resolved.alpha)',
  '    })',
  '    #elseif canImport(AppKit)',
  '    return Color(nsColor: NSColor(name: nil) { appearance in',
  '        let highContrastNames: Set<NSAppearance.Name> = [',
  '            .accessibilityHighContrastAqua, .accessibilityHighContrastDarkAqua,',
  '            .accessibilityHighContrastVibrantLight, .accessibilityHighContrastVibrantDark,',
  '        ]',
  '        let darkNames: Set<NSAppearance.Name> = [',
  '            .darkAqua, .vibrantDark,',
  '            .accessibilityHighContrastDarkAqua, .accessibilityHighContrastVibrantDark,',
  '        ]',
  '        let resolved: TSColorComponents',
  '        if highContrastNames.contains(appearance.name) {',
  '            resolved = highContrast',
  '        } else if darkNames.contains(appearance.name) {',
  '            resolved = dark',
  '        } else {',
  '            resolved = light',
  '        }',
  '        return NSColor(srgbRed: resolved.red, green: resolved.green, blue: resolved.blue, alpha: resolved.alpha)',
  '    })',
  '    #else',
  '    return Color(.sRGB, red: light.red, green: light.green, blue: light.blue, opacity: light.alpha)',
  '    #endif',
  '}',
];

const SWIFT_WEIGHT = { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' };

export function generateApple(tokens = loadTokens()) {
  const out = [];
  for (const l of BANNER_LINES) out.push(`// ${l}`);
  out.push('');
  // Generated file: exempt from formatter/linter (hand-formatted, deterministic).
  out.push('// swiftformat:disable all');
  out.push('// swiftlint:disable all');
  out.push('');
  out.push('import SwiftUI');
  out.push('#if canImport(UIKit)');
  out.push('import UIKit');
  out.push('#elseif canImport(AppKit)');
  out.push('import AppKit');
  out.push('#endif');
  out.push('');
  for (const l of DYNAMIC_COLOR_HELPER) out.push(l);
  out.push('');

  // Semantic colors (light/dark/high-contrast resolved at runtime).
  out.push('public extension Color {');
  out.push('    enum TS {');
  for (const role of COLOR_ROLES) {
    out.push(dynamicColor(role, tokens.color.light[role], tokens.color.dark[role], tokens.color.highContrast[role]));
  }
  for (const s of STATUS_KEYS) {
    out.push(dynamicColor(`status${cap(s)}`, tokens.color.light.status[s], tokens.color.dark.status[s], tokens.color.highContrast.status[s]));
  }
  out.push('');
  // Brand chart palette (constant across appearances).
  out.push('        // Brand chart palette (index-stable across platforms).');
  out.push('        static let chartCategorical: [Color] = [');
  tokens.chart.categorical.forEach((hex) => {
    out.push(`            Color(.sRGB, ${srgb(hex)}),`);
  });
  out.push('        ]');
  for (const [name, hex] of Object.entries(tokens.chart.series)) {
    out.push(`        static let chartSeries${cap(name)} = Color(.sRGB, ${srgb(hex)})`);
  }
  out.push('    }');
  out.push('}');
  out.push('');

  // Typography.
  out.push('public extension Font {');
  out.push('    enum TS {');
  for (const role of TYPE_ROLES) {
    const r = tokens.typography[role];
    out.push(`        static let ${role} = Font.system(size: ${r.size}, weight: .${SWIFT_WEIGHT[r.weight]})`);
  }
  out.push('');
  out.push(`        static let fontFamilySans = "${tokens.typography.fontFamily.sans}"`);
  out.push(`        static let fontFamilyMono = "${tokens.typography.fontFamily.mono}"`);
  out.push('    }');
  out.push('}');
  out.push('');

  // Line heights as a parallel lookup (SwiftUI applies via lineSpacing).
  out.push('public enum TSTypeMetrics {');
  for (const role of TYPE_ROLES) {
    const r = tokens.typography[role];
    out.push(`    public static let ${role}LineHeight: CGFloat = ${r.lineHeight}`);
    out.push(`    public static let ${role}Tracking: CGFloat = ${r.letterSpacing.toFixed(2)}`);
  }
  out.push('}');
  out.push('');

  // Spacing + radius (pt).
  out.push('public enum TSSpacing {');
  for (const [name, v] of Object.entries(tokens.spacing.scale)) {
    out.push(`    public static let ${spacingSwiftName(name)}: CGFloat = ${v}`);
  }
  out.push('}');
  out.push('');
  out.push('public enum TSRadius {');
  for (const [name, v] of Object.entries(tokens.radius)) {
    out.push(`    public static let ${name}: CGFloat = ${v}`);
  }
  out.push('}');
  out.push('');

  // Motion.
  out.push('public enum TSMotion {');
  for (const [name, v] of Object.entries(tokens.motion.durations)) {
    out.push(`    public static let ${name}Duration: TimeInterval = ${(v / 1000).toFixed(3)}`);
  }
  for (const [name, v] of Object.entries(tokens.motion.easing)) {
    out.push(`    public static let ${name}Easing = "${v}"`);
  }
  out.push('}');
  out.push('');

  return { rel: 'apple/Tokens.swift', content: out.join('\n') };
}

// Swift identifiers can't start with a digit (e.g. "2xl") — prefix with "x".
function spacingSwiftName(name) {
  return /^[0-9]/.test(name) ? `x${name}` : name;
}
