// Native parity port of web/src/lib/icons.ts.
//
// The web source is the canonical concept-to-icon registry: it imports ~190
// glyphs from `lucide-react` and maps each app concept (battery, charging,
// vehicle, add, edit, ...) to one of them, so the rest of the app imports
// `Icons.<concept>` instead of bare lucide names.
//
// Web -> native adaptation (conversion contract rules 4-7):
//   * `lucide-react` is a DOM/SVG-only package and is NOT a dependency of the
//     native app, so the ~190-line per-icon import block (web L17-215) cannot be
//     ported verbatim. The native app's canonical glyph source of truth is
//     `components/icons/SemanticIcon.tsx`, whose `semanticIconIntentNames` set is
//     an EXACT key-for-key match (same names, same order, same sections) of this
//     registry's concepts. So every concept routes to its SemanticIcon glyph.
//   * A `LucideIcon` is "any icon component". Its React Native analog is the
//     `IconComponentType` contract already defined for the native `Icon`
//     renderer (`components/ui/Icon.tsx`): a component driven by a numeric
//     `size`, a `color`, a `style`, and the RN accessibility fields. So each
//     `Icons.<concept>` is a native icon component honouring that contract — a
//     drop-in for the shared `<Icon icon={Icons.x} />` renderer, exactly as the
//     web `Icons.<concept>` is a drop-in lucide component for the web `<Icon>`.
//   * Each concept's component renders the SemanticIcon glyph string at the
//     requested numeric size/colour (the same `LinkGlyph`/`HashGlyph` stand-in
//     pattern the sibling devtools ports use), forwarding the accessibility
//     props the shared `Icon` wrapper supplies. This is a `.ts` file like the
//     web source, so `React.createElement` is used (no JSX, no DOM `<svg>`).
//
// No lucide-react, no DOM elements, no Recharts/Leaflet, and no web UI imports.
//
// RULES (preserved from the web source):
//  - Always import icons from this file, NOT directly from an icon package.
//  - Adding a new icon here implicitly enforces it as the canonical choice for
//    that concept across the app.
//  - Some related concepts intentionally collapse to the same visual (e.g.
//    `severityWarn` and `warning` both render the same warning glyph) — that is
//    the registry's job.
//  - For app primitives (Tesla logo, app branding) keep them as dedicated
//    assets/components, NOT here.

import { createElement } from 'react';
import { Text, type TextStyle } from 'react-native';

import type { IconComponentType, IconRenderProps } from '../components/ui/Icon';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../components/icons/SemanticIcon';
import { colors } from '../../theme/tokens';

/**
 * React Native analog of the web `LucideIcon` type: any component honouring the
 * shared native icon contract (numeric `size` + `color` + `style` + RN a11y).
 * Re-exported under the `LucideIcon` name so ported call sites that did
 * `import { type LucideIcon } from '@/lib/icons'` keep type-checking.
 */
export type LucideIcon = IconComponentType;

/**
 * Builds a native icon component for a single concept. It resolves the
 * concept's canonical glyph once (from the SemanticIcon registry) and renders
 * it as text sized to ~0.6x the requested box, mirroring the web `LucideIcon`
 * render contract (an `<svg>` sized by `size` and coloured via `currentColor`).
 * The RN accessibility props supplied by the shared `Icon` wrapper are
 * forwarded so the glyph can be decorative or meaningful without an extra view.
 */
function glyphIcon(name: SemanticIconName): LucideIcon {
  const glyph = getSemanticIconDefinition(name).glyph;

  function GlyphIcon({
    size = 16,
    color = colors.textPrimary,
    style,
    accessible,
    accessibilityRole,
    accessibilityLabel,
    accessibilityElementsHidden,
    importantForAccessibility,
  }: IconRenderProps) {
    const glyphStyle: TextStyle = {
      color,
      fontSize: Math.round(size * 0.6),
      fontWeight: '700',
      letterSpacing: 0.4,
      lineHeight: size,
      minWidth: size,
      textAlign: 'center',
    };

    return createElement(
      Text,
      {
        accessible,
        accessibilityElementsHidden,
        accessibilityLabel,
        accessibilityRole,
        allowFontScaling: false,
        importantForAccessibility,
        style: [glyphStyle, style],
      },
      glyph,
    );
  }

  GlyphIcon.displayName = `Icon(${name})`;
  return GlyphIcon;
}

/**
 * Canonical icon-per-concept mapping.
 * Always import via `Icons.<concept>`, never the bare glyph name.
 *
 * Naming mirrors the web source:
 *  - semantic concept names (battery, charging, vehicle, ...) for domain things
 *  - short UI/action verbs (add, edit, delete, refresh, ...) for primitives
 *  - lower-camel-case fallbacks for specialty one-offs (dog, hammer, tent, ...)
 *    still routed through this registry so the audit can stay accurate.
 */
export const Icons = {
  // ── Severity & status (also see severityTokens in tokens.ts) ────────────
  severityCritical: glyphIcon('severityCritical'),
  severityWarn: glyphIcon('severityWarn'),
  severityInfo: glyphIcon('severityInfo'),
  warning: glyphIcon('warning'),
  info: glyphIcon('info'),
  alertCircle: glyphIcon('alertCircle'),
  success: glyphIcon('success'),
  successFilled: glyphIcon('successFilled'),
  error: glyphIcon('error'),
  helpCircle: glyphIcon('helpCircle'),

  // ── Battery / charging ──────────────────────────────────────────────────
  battery: glyphIcon('battery'),
  batteryCharging: glyphIcon('batteryCharging'),
  batteryFull: glyphIcon('batteryFull'),
  batteryMedium: glyphIcon('batteryMedium'),
  batteryWarning: glyphIcon('batteryWarning'),
  charging: glyphIcon('charging'),
  charger: glyphIcon('charger'),
  bolt: glyphIcon('bolt'),
  powerShare: glyphIcon('powerShare'),

  // ── Vehicle / mobility ──────────────────────────────────────────────────
  vehicle: glyphIcon('vehicle'),
  navigation: glyphIcon('navigation'),
  navigationAlt: glyphIcon('navigationAlt'),
  map: glyphIcon('map'),
  mapPinned: glyphIcon('mapPinned'),
  location: glyphIcon('location'),
  locate: glyphIcon('locate'),
  drive: glyphIcon('drive'),
  drives: glyphIcon('drives'),
  trip: glyphIcon('trip'),
  signpost: glyphIcon('signpost'),
  fence: glyphIcon('fence'),
  flag: glyphIcon('flag'),
  fuel: glyphIcon('fuel'),
  satellite: glyphIcon('satellite'),
  radar: glyphIcon('radar'),

  // ── Analytics / charts ──────────────────────────────────────────────────
  analytics: glyphIcon('analytics'),
  trends: glyphIcon('trends'),
  pieChart: glyphIcon('pieChart'),
  layoutDashboard: glyphIcon('layoutDashboard'),
  layoutGrid: glyphIcon('layoutGrid'),
  layoutTemplate: glyphIcon('layoutTemplate'),
  trendUp: glyphIcon('trendUp'),
  trendDown: glyphIcon('trendDown'),
  speed: glyphIcon('speed'),
  speedCircle: glyphIcon('speedCircle'),
  efficiency: glyphIcon('efficiency'),
  activity: glyphIcon('activity'),
  range: glyphIcon('range'),
  target: glyphIcon('target'),
  workflow: glyphIcon('workflow'),
  award: glyphIcon('award'),
  trophy: glyphIcon('trophy'),
  star: glyphIcon('star'),

  // ── Notifications / alerts ──────────────────────────────────────────────
  notifications: glyphIcon('notifications'),
  notificationsMuted: glyphIcon('notificationsMuted'),
  notificationsActive: glyphIcon('notificationsActive'),
  notificationsAdd: glyphIcon('notificationsAdd'),

  // ── Climate / weather ───────────────────────────────────────────────────
  climate: glyphIcon('climate'),
  climateHot: glyphIcon('climateHot'),
  cooling: glyphIcon('cooling'),
  heating: glyphIcon('heating'),
  weather: glyphIcon('weather'),
  cabin: glyphIcon('cabin'),
  cloud: glyphIcon('cloud'),
  wind: glyphIcon('wind'),
  flame: glyphIcon('flame'),
  droplets: glyphIcon('droplets'),
  moon: glyphIcon('moon'),
  moonStar: glyphIcon('moonStar'),
  sun: glyphIcon('sun'),
  sunMoon: glyphIcon('sunMoon'),

  // ── Security / access ───────────────────────────────────────────────────
  security: glyphIcon('security'),
  securityAlert: glyphIcon('securityAlert'),
  securityCheck: glyphIcon('securityCheck'),
  securityOff: glyphIcon('securityOff'),
  locked: glyphIcon('locked'),
  unlocked: glyphIcon('unlocked'),
  key: glyphIcon('key'),
  keyRound: glyphIcon('keyRound'),
  fingerprint: glyphIcon('fingerprint'),
  guard: glyphIcon('guard'),

  // ── Media ───────────────────────────────────────────────────────────────
  media: glyphIcon('media'),
  headphones: glyphIcon('headphones'),
  speaker: glyphIcon('speaker'),
  volume: glyphIcon('volume'),
  volumeLow: glyphIcon('volumeLow'),
  volumeOff: glyphIcon('volumeOff'),

  // ── Maintenance / system ────────────────────────────────────────────────
  maintenance: glyphIcon('maintenance'),
  settings: glyphIcon('settings'),
  settingsAlt: glyphIcon('settingsAlt'),
  preferences: glyphIcon('preferences'),
  cpu: glyphIcon('cpu'),
  database: glyphIcon('database'),
  databaseBackup: glyphIcon('databaseBackup'),
  hardDrive: glyphIcon('hardDrive'),
  hardDriveDownload: glyphIcon('hardDriveDownload'),
  monitor: glyphIcon('monitor'),
  terminal: glyphIcon('terminal'),
  server: glyphIcon('server'),
  network: glyphIcon('network'),
  globe: glyphIcon('globe'),
  link: glyphIcon('link'),
  package: glyphIcon('package'),
  shoppingCart: glyphIcon('shoppingCart'),
  archive: glyphIcon('archive'),
  history: glyphIcon('history'),
  stethoscope: glyphIcon('stethoscope'),
  bug: glyphIcon('bug'),
  scanSearch: glyphIcon('scanSearch'),
  recycle: glyphIcon('recycle'),
  bot: glyphIcon('bot'),
  gamepad: glyphIcon('gamepad'),
  palette: glyphIcon('palette'),
  keyboard: glyphIcon('keyboard'),
  tv: glyphIcon('tv'),
  power: glyphIcon('power'),
  radio: glyphIcon('radio'),
  radioTower: glyphIcon('radioTower'),
  wifi: glyphIcon('wifi'),
  wifiOff: glyphIcon('wifiOff'),
  heart: glyphIcon('heart'),
  heartPulse: glyphIcon('heartPulse'),

  // ── People ──────────────────────────────────────────────────────────────
  user: glyphIcon('user'),
  users: glyphIcon('users'),
  userCheck: glyphIcon('userCheck'),
  userPlus: glyphIcon('userPlus'),
  userX: glyphIcon('userX'),
  home: glyphIcon('home'),

  // ── Cost ────────────────────────────────────────────────────────────────
  dollarSign: glyphIcon('dollarSign'),
  wallet: glyphIcon('wallet'),
  receipt: glyphIcon('receipt'),

  // ── Time / scheduling ───────────────────────────────────────────────────
  calendar: glyphIcon('calendar'),
  calendarCheck: glyphIcon('calendarCheck'),
  calendarClock: glyphIcon('calendarClock'),
  calendarPlus: glyphIcon('calendarPlus'),
  calendarMinus: glyphIcon('calendarMinus'),
  clock: glyphIcon('clock'),
  timer: glyphIcon('timer'),
  bedDouble: glyphIcon('bedDouble'),
  sparkles: glyphIcon('sparkles'),
  lightbulb: glyphIcon('lightbulb'),

  // ── UI / actions ────────────────────────────────────────────────────────
  add: glyphIcon('add'),
  remove: glyphIcon('remove'),
  close: glyphIcon('close'),
  confirm: glyphIcon('confirm'),
  next: glyphIcon('next'),
  previous: glyphIcon('previous'),
  expand: glyphIcon('expand'),
  collapse: glyphIcon('collapse'),
  expandAll: glyphIcon('expandAll'),
  collapseAll: glyphIcon('collapseAll'),
  forward: glyphIcon('forward'),
  back: glyphIcon('back'),
  arrowUp: glyphIcon('arrowUp'),
  arrowDown: glyphIcon('arrowDown'),
  arrowLeftRight: glyphIcon('arrowLeftRight'),
  arrowRightLeft: glyphIcon('arrowRightLeft'),
  arrowUpDown: glyphIcon('arrowUpDown'),
  arrowUpFromDot: glyphIcon('arrowUpFromDot'),
  arrowDownToDot: glyphIcon('arrowDownToDot'),
  externalLink: glyphIcon('externalLink'),
  drillThrough: glyphIcon('drillThrough'),
  drillDown: glyphIcon('drillDown'),

  search: glyphIcon('search'),
  filter: glyphIcon('filter'),
  more: glyphIcon('more'),
  moreInline: glyphIcon('moreInline'),
  menu: glyphIcon('menu'),

  edit: glyphIcon('edit'),
  pencil: glyphIcon('pencil'),
  delete: glyphIcon('delete'),
  copy: glyphIcon('copy'),
  save: glyphIcon('save'),
  download: glyphIcon('download'),
  upload: glyphIcon('upload'),
  share: glyphIcon('share'),
  send: glyphIcon('send'),
  fileDown: glyphIcon('fileDown'),
  fileText: glyphIcon('fileText'),
  fileJson: glyphIcon('fileJson'),
  fileSpreadsheet: glyphIcon('fileSpreadsheet'),
  folderOpen: glyphIcon('folderOpen'),

  refresh: glyphIcon('refresh'),
  undo: glyphIcon('undo'),
  undoAlt: glyphIcon('undoAlt'),
  redo: glyphIcon('redo'),
  loading: glyphIcon('loading'),
  play: glyphIcon('play'),
  pause: glyphIcon('pause'),
  stop: glyphIcon('stop'),
  circleStop: glyphIcon('circleStop'),
  skipBack: glyphIcon('skipBack'),
  skipForward: glyphIcon('skipForward'),
  eraser: glyphIcon('eraser'),

  show: glyphIcon('show'),
  hide: glyphIcon('hide'),

  // ── Vehicle systems / state ─────────────────────────────────────────────
  doorOpen: glyphIcon('doorOpen'),
  tirePressure: glyphIcon('tirePressure'),
  split: glyphIcon('split'),
  hammer: glyphIcon('hammer'),
  leaf: glyphIcon('leaf'),

  // ── Specialty / one-offs (registry-routed for audit hygiene) ────────────
  dog: glyphIcon('dog'),
  tent: glyphIcon('tent'),
  gitCompare: glyphIcon('gitCompare'),
} satisfies Record<string, LucideIcon>;

/** Concept key in the registry. */
export type IconKey = keyof typeof Icons;
