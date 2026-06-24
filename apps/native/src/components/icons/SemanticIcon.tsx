import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '../../theme/tokens';
import { AppText } from '../ui/AppText';

export type SemanticIconTone =
  | 'accent'
  | 'danger'
  | 'neutral'
  | 'success'
  | 'violet'
  | 'warning';

interface SemanticIconVisual {
  glyph: string;
  tone: SemanticIconTone;
}

export const semanticIconIntentNames = [
  'severityCritical',
  'severityWarn',
  'severityInfo',
  'warning',
  'info',
  'alertCircle',
  'success',
  'successFilled',
  'error',
  'helpCircle',
  'battery',
  'batteryCharging',
  'batteryFull',
  'batteryMedium',
  'batteryWarning',
  'charging',
  'charger',
  'bolt',
  'powerShare',
  'vehicle',
  'navigation',
  'navigationAlt',
  'map',
  'mapPinned',
  'location',
  'locate',
  'drive',
  'drives',
  'trip',
  'signpost',
  'fence',
  'flag',
  'fuel',
  'satellite',
  'radar',
  'analytics',
  'trends',
  'pieChart',
  'layoutDashboard',
  'layoutGrid',
  'layoutTemplate',
  'trendUp',
  'trendDown',
  'speed',
  'speedCircle',
  'efficiency',
  'activity',
  'range',
  'target',
  'workflow',
  'award',
  'trophy',
  'star',
  'notifications',
  'notificationsMuted',
  'notificationsActive',
  'notificationsAdd',
  'climate',
  'climateHot',
  'cooling',
  'heating',
  'weather',
  'cabin',
  'cloud',
  'wind',
  'flame',
  'droplets',
  'moon',
  'moonStar',
  'sun',
  'sunMoon',
  'security',
  'securityAlert',
  'securityCheck',
  'securityOff',
  'locked',
  'unlocked',
  'key',
  'keyRound',
  'fingerprint',
  'guard',
  'media',
  'headphones',
  'speaker',
  'volume',
  'volumeLow',
  'volumeOff',
  'maintenance',
  'settings',
  'settingsAlt',
  'preferences',
  'cpu',
  'database',
  'databaseBackup',
  'hardDrive',
  'hardDriveDownload',
  'monitor',
  'terminal',
  'server',
  'network',
  'globe',
  'link',
  'package',
  'shoppingCart',
  'archive',
  'history',
  'stethoscope',
  'bug',
  'scanSearch',
  'recycle',
  'bot',
  'gamepad',
  'palette',
  'keyboard',
  'tv',
  'power',
  'radio',
  'radioTower',
  'wifi',
  'wifiOff',
  'heart',
  'heartPulse',
  'user',
  'users',
  'userCheck',
  'userPlus',
  'userX',
  'home',
  'dollarSign',
  'wallet',
  'receipt',
  'calendar',
  'calendarCheck',
  'calendarClock',
  'calendarPlus',
  'calendarMinus',
  'clock',
  'timer',
  'bedDouble',
  'sparkles',
  'lightbulb',
  'add',
  'remove',
  'close',
  'confirm',
  'next',
  'previous',
  'expand',
  'collapse',
  'expandAll',
  'collapseAll',
  'forward',
  'back',
  'arrowUp',
  'arrowDown',
  'arrowLeftRight',
  'arrowRightLeft',
  'arrowUpDown',
  'arrowUpFromDot',
  'arrowDownToDot',
  'externalLink',
  'drillThrough',
  'drillDown',
  'search',
  'filter',
  'more',
  'moreInline',
  'menu',
  'edit',
  'pencil',
  'delete',
  'copy',
  'save',
  'download',
  'upload',
  'share',
  'send',
  'fileDown',
  'fileText',
  'fileJson',
  'fileSpreadsheet',
  'folderOpen',
  'refresh',
  'undo',
  'undoAlt',
  'redo',
  'loading',
  'play',
  'pause',
  'stop',
  'circleStop',
  'skipBack',
  'skipForward',
  'eraser',
  'show',
  'hide',
  'doorOpen',
  'tirePressure',
  'split',
  'hammer',
  'leaf',
  'dog',
  'tent',
  'gitCompare',
] as const;

export type SemanticIconName = (typeof semanticIconIntentNames)[number];

const semanticIconVisuals = {
  severityCritical: { glyph: '!!', tone: 'danger' },
  severityWarn: { glyph: 'W!', tone: 'warning' },
  severityInfo: { glyph: 'i', tone: 'accent' },
  warning: { glyph: 'W!', tone: 'warning' },
  info: { glyph: 'i', tone: 'accent' },
  alertCircle: { glyph: '!', tone: 'warning' },
  success: { glyph: 'OK', tone: 'success' },
  successFilled: { glyph: 'OK', tone: 'success' },
  error: { glyph: 'X', tone: 'danger' },
  helpCircle: { glyph: '?', tone: 'neutral' },

  battery: { glyph: 'BT', tone: 'success' },
  batteryCharging: { glyph: 'BC', tone: 'success' },
  batteryFull: { glyph: 'BF', tone: 'success' },
  batteryMedium: { glyph: 'BM', tone: 'warning' },
  batteryWarning: { glyph: 'BW', tone: 'danger' },
  charging: { glyph: 'CH', tone: 'success' },
  charger: { glyph: 'PL', tone: 'success' },
  bolt: { glyph: 'ZP', tone: 'warning' },
  powerShare: { glyph: 'PS', tone: 'success' },

  vehicle: { glyph: 'EV', tone: 'accent' },
  navigation: { glyph: 'NV', tone: 'accent' },
  navigationAlt: { glyph: 'N2', tone: 'accent' },
  map: { glyph: 'MP', tone: 'accent' },
  mapPinned: { glyph: 'PN', tone: 'accent' },
  location: { glyph: 'LO', tone: 'accent' },
  locate: { glyph: 'LC', tone: 'accent' },
  drive: { glyph: 'DR', tone: 'accent' },
  drives: { glyph: 'DR', tone: 'accent' },
  trip: { glyph: 'TR', tone: 'accent' },
  signpost: { glyph: 'SG', tone: 'accent' },
  fence: { glyph: 'FN', tone: 'accent' },
  flag: { glyph: 'FL', tone: 'accent' },
  fuel: { glyph: 'FU', tone: 'warning' },
  satellite: { glyph: 'SA', tone: 'violet' },
  radar: { glyph: 'RD', tone: 'violet' },

  analytics: { glyph: 'AN', tone: 'violet' },
  trends: { glyph: 'LN', tone: 'violet' },
  pieChart: { glyph: 'PI', tone: 'violet' },
  layoutDashboard: { glyph: 'DB', tone: 'violet' },
  layoutGrid: { glyph: 'GD', tone: 'violet' },
  layoutTemplate: { glyph: 'TP', tone: 'violet' },
  trendUp: { glyph: 'UP', tone: 'success' },
  trendDown: { glyph: 'DN', tone: 'danger' },
  speed: { glyph: 'SP', tone: 'accent' },
  speedCircle: { glyph: 'SC', tone: 'accent' },
  efficiency: { glyph: 'EF', tone: 'success' },
  activity: { glyph: 'AC', tone: 'accent' },
  range: { glyph: 'RG', tone: 'success' },
  target: { glyph: 'TG', tone: 'accent' },
  workflow: { glyph: 'WF', tone: 'violet' },
  award: { glyph: 'AW', tone: 'warning' },
  trophy: { glyph: 'TY', tone: 'warning' },
  star: { glyph: 'ST', tone: 'warning' },

  notifications: { glyph: 'NO', tone: 'warning' },
  notificationsMuted: { glyph: 'NM', tone: 'neutral' },
  notificationsActive: { glyph: 'NA', tone: 'warning' },
  notificationsAdd: { glyph: 'N+', tone: 'warning' },

  climate: { glyph: 'CL', tone: 'accent' },
  climateHot: { glyph: 'HT', tone: 'danger' },
  cooling: { glyph: 'CO', tone: 'accent' },
  heating: { glyph: 'HE', tone: 'warning' },
  weather: { glyph: 'WX', tone: 'accent' },
  cabin: { glyph: 'CB', tone: 'neutral' },
  cloud: { glyph: 'CD', tone: 'neutral' },
  wind: { glyph: 'WI', tone: 'accent' },
  flame: { glyph: 'FM', tone: 'danger' },
  droplets: { glyph: 'DP', tone: 'accent' },
  moon: { glyph: 'MO', tone: 'violet' },
  moonStar: { glyph: 'MS', tone: 'violet' },
  sun: { glyph: 'SU', tone: 'warning' },
  sunMoon: { glyph: 'SM', tone: 'warning' },

  security: { glyph: 'SH', tone: 'success' },
  securityAlert: { glyph: 'SA', tone: 'danger' },
  securityCheck: { glyph: 'SC', tone: 'success' },
  securityOff: { glyph: 'SO', tone: 'danger' },
  locked: { glyph: 'LK', tone: 'success' },
  unlocked: { glyph: 'UL', tone: 'warning' },
  key: { glyph: 'KY', tone: 'warning' },
  keyRound: { glyph: 'KR', tone: 'warning' },
  fingerprint: { glyph: 'FP', tone: 'violet' },
  guard: { glyph: 'GD', tone: 'danger' },

  media: { glyph: 'MU', tone: 'violet' },
  headphones: { glyph: 'HP', tone: 'violet' },
  speaker: { glyph: 'SK', tone: 'violet' },
  volume: { glyph: 'VO', tone: 'violet' },
  volumeLow: { glyph: 'VL', tone: 'neutral' },
  volumeOff: { glyph: 'VX', tone: 'neutral' },

  maintenance: { glyph: 'WN', tone: 'warning' },
  settings: { glyph: 'SE', tone: 'neutral' },
  settingsAlt: { glyph: 'S2', tone: 'neutral' },
  preferences: { glyph: 'PR', tone: 'neutral' },
  cpu: { glyph: 'CP', tone: 'violet' },
  database: { glyph: 'DB', tone: 'accent' },
  databaseBackup: { glyph: 'BK', tone: 'accent' },
  hardDrive: { glyph: 'HD', tone: 'neutral' },
  hardDriveDownload: { glyph: 'DL', tone: 'accent' },
  monitor: { glyph: 'MN', tone: 'neutral' },
  terminal: { glyph: 'TM', tone: 'neutral' },
  server: { glyph: 'SV', tone: 'neutral' },
  network: { glyph: 'NW', tone: 'accent' },
  globe: { glyph: 'GL', tone: 'accent' },
  link: { glyph: 'LN', tone: 'accent' },
  package: { glyph: 'PK', tone: 'neutral' },
  shoppingCart: { glyph: 'CT', tone: 'warning' },
  archive: { glyph: 'AR', tone: 'neutral' },
  history: { glyph: 'HS', tone: 'neutral' },
  stethoscope: { glyph: 'ST', tone: 'success' },
  bug: { glyph: 'BG', tone: 'danger' },
  scanSearch: { glyph: 'SS', tone: 'accent' },
  recycle: { glyph: 'RC', tone: 'success' },
  bot: { glyph: 'AI', tone: 'violet' },
  gamepad: { glyph: 'GP', tone: 'violet' },
  palette: { glyph: 'PA', tone: 'violet' },
  keyboard: { glyph: 'KB', tone: 'neutral' },
  tv: { glyph: 'TV', tone: 'neutral' },
  power: { glyph: 'PW', tone: 'warning' },
  radio: { glyph: 'RA', tone: 'accent' },
  radioTower: { glyph: 'RT', tone: 'accent' },
  wifi: { glyph: 'WF', tone: 'success' },
  wifiOff: { glyph: 'WX', tone: 'danger' },
  heart: { glyph: 'HR', tone: 'danger' },
  heartPulse: { glyph: 'HP', tone: 'danger' },

  user: { glyph: 'US', tone: 'neutral' },
  users: { glyph: 'UG', tone: 'neutral' },
  userCheck: { glyph: 'UC', tone: 'success' },
  userPlus: { glyph: 'U+', tone: 'success' },
  userX: { glyph: 'UX', tone: 'danger' },
  home: { glyph: 'HM', tone: 'neutral' },

  dollarSign: { glyph: '$', tone: 'success' },
  wallet: { glyph: 'WA', tone: 'success' },
  receipt: { glyph: 'RC', tone: 'success' },

  calendar: { glyph: 'CA', tone: 'neutral' },
  calendarCheck: { glyph: 'CC', tone: 'success' },
  calendarClock: { glyph: 'CT', tone: 'neutral' },
  calendarPlus: { glyph: 'C+', tone: 'success' },
  calendarMinus: { glyph: 'C-', tone: 'warning' },
  clock: { glyph: 'CK', tone: 'neutral' },
  timer: { glyph: 'TI', tone: 'neutral' },
  bedDouble: { glyph: 'BD', tone: 'violet' },
  sparkles: { glyph: 'SP', tone: 'violet' },
  lightbulb: { glyph: 'LB', tone: 'warning' },

  add: { glyph: '+', tone: 'accent' },
  remove: { glyph: '-', tone: 'neutral' },
  close: { glyph: 'X', tone: 'neutral' },
  confirm: { glyph: 'OK', tone: 'success' },
  next: { glyph: '>', tone: 'neutral' },
  previous: { glyph: '<', tone: 'neutral' },
  expand: { glyph: 'v', tone: 'neutral' },
  collapse: { glyph: '^', tone: 'neutral' },
  expandAll: { glyph: 'vv', tone: 'neutral' },
  collapseAll: { glyph: '^^', tone: 'neutral' },
  forward: { glyph: '>', tone: 'neutral' },
  back: { glyph: '<', tone: 'neutral' },
  arrowUp: { glyph: '^', tone: 'neutral' },
  arrowDown: { glyph: 'v', tone: 'neutral' },
  arrowLeftRight: { glyph: '<>', tone: 'neutral' },
  arrowRightLeft: { glyph: '><', tone: 'neutral' },
  arrowUpDown: { glyph: '^v', tone: 'neutral' },
  arrowUpFromDot: { glyph: '.^', tone: 'neutral' },
  arrowDownToDot: { glyph: 'v.', tone: 'neutral' },
  externalLink: { glyph: 'EX', tone: 'accent' },
  drillThrough: { glyph: '/>', tone: 'accent' },
  drillDown: { glyph: '\\v', tone: 'accent' },
  search: { glyph: 'SR', tone: 'neutral' },
  filter: { glyph: 'FT', tone: 'neutral' },
  more: { glyph: '..', tone: 'neutral' },
  moreInline: { glyph: '...', tone: 'neutral' },
  menu: { glyph: 'ME', tone: 'neutral' },

  edit: { glyph: 'ED', tone: 'accent' },
  pencil: { glyph: 'PN', tone: 'accent' },
  delete: { glyph: 'DL', tone: 'danger' },
  copy: { glyph: 'CP', tone: 'neutral' },
  save: { glyph: 'SV', tone: 'success' },
  download: { glyph: 'DW', tone: 'accent' },
  upload: { glyph: 'UP', tone: 'accent' },
  share: { glyph: 'SH', tone: 'accent' },
  send: { glyph: 'SN', tone: 'accent' },
  fileDown: { glyph: 'FD', tone: 'accent' },
  fileText: { glyph: 'TX', tone: 'neutral' },
  fileJson: { glyph: 'JS', tone: 'neutral' },
  fileSpreadsheet: { glyph: 'XL', tone: 'success' },
  folderOpen: { glyph: 'FO', tone: 'neutral' },

  refresh: { glyph: 'RE', tone: 'accent' },
  undo: { glyph: 'UN', tone: 'neutral' },
  undoAlt: { glyph: 'U2', tone: 'neutral' },
  redo: { glyph: 'RD', tone: 'neutral' },
  loading: { glyph: '..', tone: 'accent' },
  play: { glyph: 'PL', tone: 'success' },
  pause: { glyph: 'PA', tone: 'warning' },
  stop: { glyph: 'ST', tone: 'danger' },
  circleStop: { glyph: 'CS', tone: 'danger' },
  skipBack: { glyph: 'SB', tone: 'neutral' },
  skipForward: { glyph: 'SF', tone: 'neutral' },
  eraser: { glyph: 'ER', tone: 'neutral' },

  show: { glyph: 'EY', tone: 'neutral' },
  hide: { glyph: 'HX', tone: 'neutral' },

  doorOpen: { glyph: 'DO', tone: 'warning' },
  tirePressure: { glyph: 'TP', tone: 'warning' },
  split: { glyph: 'SP', tone: 'neutral' },
  hammer: { glyph: 'HM', tone: 'warning' },
  leaf: { glyph: 'LF', tone: 'success' },

  dog: { glyph: 'DG', tone: 'neutral' },
  tent: { glyph: 'TN', tone: 'neutral' },
  gitCompare: { glyph: 'GC', tone: 'violet' },
} as const satisfies Record<SemanticIconName, SemanticIconVisual>;

export interface SemanticIconDefinition extends SemanticIconVisual {
  name: SemanticIconName;
  label: string;
}

export const semanticIconNames = [...semanticIconIntentNames];

export function formatSemanticIconLabel(name: SemanticIconName): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function getSemanticIconDefinition(name: SemanticIconName): SemanticIconDefinition {
  return {
    name,
    label: formatSemanticIconLabel(name),
    ...semanticIconVisuals[name],
  };
}

interface SemanticIconProps {
  name: SemanticIconName;
  size?: 'sm' | 'md' | 'lg';
  decorative?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle | ViewStyle[];
}

export function SemanticIcon({
  name,
  size = 'md',
  decorative = false,
  accessibilityLabel,
  style,
}: SemanticIconProps) {
  const definition = getSemanticIconDefinition(name);

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : accessibilityLabel ?? definition.label}
      style={[styles.root, sizeStyles[size], toneStyles[definition.tone], style]}>
      <AppText
        variant="caption"
        weight="bold"
        style={[styles.glyph, glyphSizeStyles[size], glyphToneStyles[definition.tone]]}>
        {definition.glyph}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  glyph: {
    letterSpacing: 0.4,
  },
});

const sizeStyles = StyleSheet.create({
  sm: {
    width: 30,
    height: 30,
    borderRadius: 10,
  },
  md: {
    width: 38,
    height: 38,
    borderRadius: 14,
  },
  lg: {
    width: 52,
    height: 52,
    borderRadius: 18,
  },
});

const glyphSizeStyles = StyleSheet.create({
  sm: {
    fontSize: 10,
    lineHeight: 14,
  },
  md: {
    fontSize: 12,
    lineHeight: 16,
  },
  lg: {
    fontSize: 15,
    lineHeight: 20,
  },
});

const toneStyles = StyleSheet.create<Record<SemanticIconTone, ViewStyle>>({
  accent: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  violet: {
    borderColor: 'rgba(139, 92, 246, 0.34)',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
});

const glyphToneStyles = StyleSheet.create({
  accent: {
    color: colors.accent,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  violet: {
    color: colors.glowViolet,
  },
  warning: {
    color: colors.warning,
  },
});
