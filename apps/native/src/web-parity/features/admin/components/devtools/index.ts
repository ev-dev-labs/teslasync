// Native parity port of web/src/features/admin/components/devtools/index.ts.
//
// The web module (10 lines) is a barrel that re-exports the admin "Developer
// Tools" building blocks — FleetApiSection (L1), FleetTelemetryHealth (L2),
// InfrastructureSection (L3), ClientUtilitiesSection (L4), ReferenceLinksSection
// (L5), ToolCard (L6), BackendTool (L7), ResultPanel (L8), TelemetryErrorsPanel
// (L9) — plus the TelemetryError type (L10).
//
// Like the established native charts/format barrels, this port is SELF-CONTAINED:
// the web siblings reach into a browser-only graph that is absent from the React
// Native parity tree — lucide-react icons, the web @/components/ui +
// @/components/feedback design system (GlassPanel/Button/Input/Select/Textarea/
// DataTable/CopyButton/Skeleton/AlertBanner/Badge), the @tanstack/react-query
// admin dev-tool mutations behind ./helpers `apiFetch`, the ./constants catalogs,
// the 15 ./tools/* client utilities, the @/api/hooks/useTelemetry fleet-error
// hooks, and Blob/URL/document file downloads. We therefore inline native-safe
// implementations that keep the public export surface, prop contracts, i18n
// intent and visual structure, and surface an explicit unavailable state for the
// backend/browser-only behavior. The .ts extension keeps JSX out (trees are built
// with React.createElement), matching charts/index.ts and format/index.ts.

import React from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

const el = React.createElement;

/* ─── native-safe i18n shim ───────────────────────────────────────────────
   The web siblings use react-i18next `t(key, fallback)`. The parity tree has no
   i18n provider, so we preserve the keys + English fallbacks (and {{var}}
   interpolation) and render the fallback string. */

type TVars = Record<string, string | number>;

function t(_key: string, fallback: string, vars?: TVars): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/* ─── accent tokens (web ICON_COLOR_MAP -> native theme tokens) ───────────── */

interface AccentTokens {
  fg: string;
  surface: string;
  border: string;
}

const ACCENTS: Record<string, AccentTokens> = {
  cyan: {fg: colors.accent, surface: colors.accentSoft, border: colors.borderAccent},
  green: {
    fg: colors.success,
    surface: colors.successSurface,
    border: colors.successBorder,
  },
  purple: {
    fg: colors.violet,
    surface: colors.violetSurface,
    border: colors.violetBorder,
  },
  amber: {
    fg: colors.warning,
    surface: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {fg: colors.danger, surface: colors.dangerSurface, border: colors.dangerBorder},
};

function accentFor(color: string): AccentTokens {
  return ACCENTS[color] ?? ACCENTS.cyan;
}

/* ─── TelemetryError (faithful port of ./types.ts) ─────────────────────────
   UI-normalised shape after extractTelemetryErrors unwraps Tesla's response
   envelope. `rowKey` is the stable composite key for the DataTable since Tesla
   errors carry no `id`. */

export interface TelemetryError {
  rowKey: string;
  timestamp: string;
  code: string;
  message: string;
}

/* ─── small shared native primitives ──────────────────────────────────────── */

function IconChip(accent: AccentTokens): React.ReactElement {
  return el(View, {
    style: [styles.iconChip, {backgroundColor: accent.surface, borderColor: accent.border}],
  });
}

function UnavailableNote(message: string): React.ReactElement {
  return el(
    View,
    {style: styles.unavailableNote},
    el(AppText, {variant: 'caption', tone: 'muted'}, message),
  );
}

/* ─── ToolCard (faithful presentational wrapper) ───────────────────────────
   web: GlassPanel + icon chip + title/description header + children. The
   lucide `icon` prop is preserved in the contract but not invoked (DOM icon
   component); the accent chip stands in for it. */

export interface ToolCardProps {
  icon?: React.ComponentType<unknown>;
  color: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function ToolCard({color, title, description, children}: ToolCardProps) {
  const accent = accentFor(color);
  return el(
    View,
    {style: styles.toolCard},
    el(
      View,
      {style: styles.toolCardHeader},
      IconChip(accent),
      el(
        View,
        {style: styles.toolCardHeaderText},
        el(AppText, {variant: 'body', weight: 'semibold'}, title),
        el(AppText, {variant: 'caption', tone: 'secondary'}, description),
      ),
    ),
    children ?? null,
  );
}

/* ─── ResultPanel (faithful) ───────────────────────────────────────────────
   web: error -> rose text; data -> pretty JSON in a scroll block with a copy
   button; idle -> idleMessage. Native drops the clipboard CopyButton (web-only)
   but keeps the same three render states. */

export interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idle?: boolean;
  idleMessage?: string;
}

export function ResultPanel({title, data, error, idleMessage}: ResultPanelProps) {
  const hasData = data != null;
  const stringified = hasData ? JSON.stringify(data, null, 2) : '';

  let body: React.ReactNode;
  if (error) {
    body = el(AppText, {variant: 'body', tone: 'danger', style: styles.resultText}, error);
  } else if (hasData) {
    body = el(
      ScrollView,
      {style: styles.resultScroll, nestedScrollEnabled: true},
      el(AppText, {variant: 'caption', tone: 'primary', style: styles.mono}, stringified),
    );
  } else {
    body = el(
      AppText,
      {variant: 'body', tone: 'muted', style: styles.italic},
      idleMessage ?? t('devtools.result.idle', 'No result yet'),
    );
  }

  return el(
    View,
    {
      style: [
        styles.resultPanel,
        error ? styles.resultError : hasData ? styles.resultOk : styles.resultIdle,
      ],
    },
    el(AppText, {variant: 'caption', tone: 'secondary', weight: 'semibold'}, title),
    body,
  );
}

/* ─── BackendTool ──────────────────────────────────────────────────────────
   web: ToolCard + a "Run" Button that fires apiFetch(endpoint, method) via a
   react-query mutation, then renders a Badge + ResultPanel. The admin dev-tool
   endpoints run against the API server and are not reachable from the native
   parity build, so the action is surfaced as an explicit unavailable note that
   still names the endpoint + method it would call. */

export interface BackendToolProps {
  icon?: React.ComponentType<unknown>;
  color: string;
  title: string;
  description: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  bodyBuilder?: () => unknown;
  children?: React.ReactNode;
}

export function BackendTool({
  color,
  title,
  description,
  endpoint,
  method = 'GET',
  children,
}: BackendToolProps) {
  return el(
    ToolCard,
    {color, title, description},
    children ?? null,
    UnavailableNote(
      t(
        'devtools.backendUnavailable',
        'Backend dev tool ({{method}} {{endpoint}}) runs against the API server and is not available in the native parity build.',
        {method, endpoint},
      ),
    ),
  );
}

/* ─── TelemetryErrorsPanel (faithful 5-state UI) ───────────────────────────
   idle | loading | error | data | empty, mirroring the web component. The
   browser-only JSON file download (Blob + document.createElement('a')) becomes
   an explicit unavailable note; the <details> raw-response disclosure becomes a
   native Pressable toggle. */

export interface TelemetryErrorColumn {
  key: string;
  header: React.ReactNode;
  render?: (row: TelemetryError) => React.ReactNode;
}

export interface TelemetryErrorsPanelProps {
  title: string;
  loading: boolean;
  error: string | undefined;
  requested: boolean;
  ok: boolean;
  errors: TelemetryError[];
  columns: TelemetryErrorColumn[];
  vin: string;
  idleMessage: string;
  emptyMessage: string;
  rawData: unknown;
  rawDisclosureLabel: string;
  downloadLabel: string;
}

const DEFAULT_TELEMETRY_COLUMNS: TelemetryErrorColumn[] = [
  {
    key: 'timestamp',
    header: 'Reported At',
    render: row =>
      el(AppText, {variant: 'caption', tone: 'secondary'}, row.timestamp || '—'),
  },
  {
    key: 'code',
    header: 'Error Code',
    render: row => el(AppText, {variant: 'caption', tone: 'danger'}, row.code || '—'),
  },
  {
    key: 'message',
    header: 'Message',
    render: row => el(AppText, {variant: 'caption', tone: 'primary'}, row.message || '—'),
  },
];

function headerCell(column: TelemetryErrorColumn): React.ReactNode {
  if (typeof column.header === 'string') {
    return el(
      AppText,
      {variant: 'caption', tone: 'secondary', weight: 'semibold'},
      column.header,
    );
  }
  return column.header;
}

export function TelemetryErrorsPanel({
  title,
  loading,
  error,
  requested,
  ok,
  errors,
  columns,
  idleMessage,
  emptyMessage,
  rawData,
  rawDisclosureLabel,
  downloadLabel,
}: TelemetryErrorsPanelProps) {
  const [showRaw, setShowRaw] = React.useState(false);

  if (!requested) {
    return el(
      View,
      {style: styles.statePanel},
      el(AppText, {variant: 'caption', tone: 'secondary', weight: 'semibold'}, title),
      el(AppText, {variant: 'body', tone: 'muted', style: styles.italic}, idleMessage),
    );
  }

  if (loading) {
    return el(
      View,
      {style: styles.statePanel},
      el(AppText, {variant: 'caption', tone: 'secondary', weight: 'semibold'}, title),
      el(
        View,
        {style: styles.skeletonWrap},
        el(View, {style: styles.skeletonBar}),
        el(View, {style: styles.skeletonBar}),
        el(View, {style: styles.skeletonBar}),
      ),
    );
  }

  if (error) {
    return el(
      View,
      {style: [styles.statePanel, styles.resultError]},
      el(AppText, {variant: 'caption', tone: 'secondary', weight: 'semibold'}, title),
      el(AppText, {variant: 'body', tone: 'danger', style: styles.resultText}, error),
    );
  }

  if (errors.length > 0) {
    const cols = columns.length > 0 ? columns : DEFAULT_TELEMETRY_COLUMNS;
    return el(
      View,
      {style: styles.tableStack},
      el(
        View,
        {style: styles.table},
        el(
          View,
          {style: styles.tableHeaderRow},
          ...cols.map(column =>
            el(View, {key: column.key, style: styles.tableCell}, headerCell(column)),
          ),
        ),
        ...errors.map(row =>
          el(
            View,
            {key: row.rowKey, style: styles.tableRow},
            ...cols.map(column =>
              el(
                View,
                {key: column.key, style: styles.tableCell},
                column.render
                  ? column.render(row)
                  : el(
                      AppText,
                      {variant: 'caption', tone: 'primary'},
                      String((row as unknown as Record<string, unknown>)[column.key] ?? '—'),
                    ),
              ),
            ),
          ),
        ),
      ),
      UnavailableNote(
        t(
          'devtools.exportUnavailable',
          '{{label}} (JSON file export) is not available in the native parity build.',
          {label: downloadLabel},
        ),
      ),
    );
  }

  // Empty: request succeeded but produced zero rows.
  return el(
    View,
    {style: styles.statePanel},
    el(
      View,
      {style: styles.spaceBetween},
      el(AppText, {variant: 'caption', tone: 'secondary', weight: 'semibold'}, title),
      el(
        View,
        {
          style: [
            styles.badge,
            {
              backgroundColor: ok ? colors.successSurface : colors.warningSurface,
              borderColor: ok ? colors.successBorder : colors.warningBorder,
            },
          ],
        },
        el(
          AppText,
          {variant: 'caption', tone: ok ? 'accent' : 'secondary', weight: 'semibold'},
          ok ? '0' : '?',
        ),
      ),
    ),
    el(AppText, {variant: 'body', tone: 'secondary'}, emptyMessage),
    !ok && rawData != null
      ? el(
          View,
          null,
          el(
            Pressable,
            {
              accessibilityRole: 'button',
              onPress: () => setShowRaw(prev => !prev),
              style: styles.disclosureToggle,
            },
            el(AppText, {variant: 'caption', tone: 'muted'}, rawDisclosureLabel),
          ),
          showRaw
            ? el(
                ScrollView,
                {style: styles.resultScroll, nestedScrollEnabled: true},
                el(
                  AppText,
                  {variant: 'caption', tone: 'primary', style: styles.mono},
                  JSON.stringify(rawData, null, 2),
                ),
              )
            : null,
        )
      : null,
  );
}

/* ─── ReferenceLinksSection (faithful) ─────────────────────────────────────
   web: a grid of external Tesla docs links opened in a new tab. Native opens
   each URL with Linking.openURL, preserving the i18n keys + URLs. */

interface ReferenceLink {
  title: string;
  titleFallback: string;
  url: string;
}

const REFERENCE_LINKS: ReferenceLink[] = [
  {
    title: 'devtools.ref.fleetOverview',
    titleFallback: 'Fleet API Overview',
    url: 'https://developer.tesla.com/docs/fleet-api',
  },
  {
    title: 'devtools.ref.partnerEndpoints',
    titleFallback: 'Partner Endpoints',
    url: 'https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register',
  },
  {
    title: 'devtools.ref.devPortal',
    titleFallback: 'Developer Portal',
    url: 'https://developer.tesla.com',
  },
  {
    title: 'devtools.ref.telemetryGuide',
    titleFallback: 'Fleet Telemetry Guide',
    url: 'https://developer.tesla.com/docs/fleet-api/fleet-telemetry',
  },
];

export function ReferenceLinksSection() {
  const accent = accentFor('cyan');
  return el(
    View,
    {style: styles.refGrid},
    ...REFERENCE_LINKS.map(link => {
      const label = t(link.title, link.titleFallback);
      return el(
        Pressable,
        {
          key: link.url,
          accessibilityRole: 'link',
          accessibilityLabel: label,
          onPress: () => {
            Linking.openURL(link.url).catch(() => undefined);
          },
          style: styles.refCard,
        },
        IconChip(accent),
        el(
          View,
          {style: styles.refCardText},
          el(AppText, {variant: 'body', weight: 'semibold'}, label),
          el(AppText, {variant: 'caption', tone: 'muted', numberOfLines: 1}, link.url),
        ),
      );
    }),
  );
}

/* ─── InfrastructureSection ────────────────────────────────────────────────
   web: db-stats, migration-status, an MQTT publish test, env-check and
   runtime-info. The four BackendTools keep their endpoints + copy; the MQTT
   form is rendered as a ToolCard with an explicit unavailable note. */

export function InfrastructureSection() {
  return el(
    View,
    {style: styles.sectionStack},
    el(BackendTool, {
      color: 'cyan',
      title: t('Db Stats', 'Database Stats'),
      description: t('Db Stats Desc', 'Inspect database table sizes and row counts'),
      endpoint: 'db-stats',
    }),
    el(BackendTool, {
      color: 'green',
      title: t('Migrations', 'Migrations'),
      description: t('Migrations Desc', 'View applied schema migration status'),
      endpoint: 'migration-status',
    }),
    el(
      ToolCard,
      {
        color: 'amber',
        title: t('Mqtt', 'MQTT Test'),
        description: t('Mqtt Desc', 'Publish a test message to an MQTT topic'),
      },
      UnavailableNote(
        t(
          'devtools.backendUnavailableShort',
          'Runs against the API server and is not available in the native parity build.',
        ),
      ),
    ),
    el(BackendTool, {
      color: 'purple',
      title: t('Env Check', 'Environment Check'),
      description: t('Env Check Desc', 'Validate required environment variables'),
      endpoint: 'env-check',
    }),
    el(BackendTool, {
      color: 'amber',
      title: t('Runtime', 'Runtime Info'),
      description: t('Runtime Desc', 'Inspect Go runtime and build information'),
      endpoint: 'runtime-info',
    }),
  );
}

/* ─── FleetTelemetryHealth ─────────────────────────────────────────────────
   web: two ToolCards (Error VINs + Error Log) backed by the useTelemetry fleet
   error hooks and DataTables. The live data loads from the telemetry API, which
   is not wired into the parity build, so each card keeps its title/description
   and surfaces an explicit unavailable note. */

export function FleetTelemetryHealth() {
  const note = UnavailableNote(
    t(
      'devtools.liveTelemetryUnavailable',
      'Live fleet telemetry data loads from the telemetry API and is not available in the native parity build.',
    ),
  );
  return el(
    View,
    {style: styles.sectionStack},
    el(
      ToolCard,
      {
        color: 'red',
        title: t('devtools.health.errorVinsTitle', 'Error VINs'),
        description: t(
          'devtools.health.errorVinsDesc',
          'Vehicles with fleet telemetry configuration errors',
        ),
      },
      note,
    ),
    el(
      ToolCard,
      {
        color: 'amber',
        title: t('devtools.health.errorLogTitle', 'Error Log'),
        description: t(
          'devtools.health.errorLogDesc',
          'Detailed fleet telemetry error history',
        ),
      },
      UnavailableNote(
        t(
          'devtools.liveTelemetryUnavailable',
          'Live fleet telemetry data loads from the telemetry API and is not available in the native parity build.',
        ),
      ),
    ),
  );
}

/* ─── FleetApiSection ──────────────────────────────────────────────────────
   web: live Fleet API config (react-query), an onboarding checklist, the
   SignalConfigModal, a telemetry-fields reference and per-vehicle telemetry
   error lookup. The live/backend pieces are unavailable in the parity build;
   the static onboarding checklist is ported faithfully. */

interface OnboardingStep {
  id: string;
  label: string;
  desc: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'account',
    label: 'Tesla Developer Account',
    desc: 'Create a Tesla Developer account at developer.tesla.com',
  },
  {
    id: 'application',
    label: 'Create Application',
    desc: 'Register a new application in the Tesla Developer Portal',
  },
  {
    id: 'keypair',
    label: 'Generate Key Pair',
    desc: 'Generate an EC private/public key pair for Fleet API authentication',
  },
  {
    id: 'register',
    label: 'Register Partner',
    desc: 'Register as a Fleet API partner with your public key',
  },
  {
    id: 'auth',
    label: 'Authorize Account',
    desc: 'Complete OAuth2 authorization to get API access tokens',
  },
  {
    id: 'pair',
    label: 'Pair Vehicle Key',
    desc: 'Pair your public key with each vehicle for command access',
  },
  {
    id: 'telemetry',
    label: 'Fleet Telemetry',
    desc: 'Configure Fleet Telemetry streaming for real-time data',
  },
];

export function FleetApiSection() {
  return el(
    View,
    {style: styles.sectionStack},
    el(
      ToolCard,
      {
        color: 'cyan',
        title: t('Config', 'Fleet API Configuration'),
        description: t(
          'Config Desc',
          'Base URL, client ID, auth status and configured regions',
        ),
      },
      UnavailableNote(
        t(
          'devtools.fleetApiConfigUnavailable',
          'Live Fleet API configuration loads from the API server and is not available in the native parity build.',
        ),
      ),
    ),
    el(
      ToolCard,
      {
        color: 'purple',
        title: t('devtools.onboarding.title', 'Fleet API Onboarding'),
        description: t(
          'devtools.onboarding.desc',
          'Steps to connect TeslaSync to the Tesla Fleet API',
        ),
      },
      el(
        View,
        {style: styles.onboardingList},
        ...ONBOARDING_STEPS.map((step, index) =>
          el(
            View,
            {key: step.id, style: styles.onboardingStep},
            el(
              View,
              {style: styles.stepIndex},
              el(AppText, {variant: 'caption', tone: 'accent', weight: 'semibold'}, String(index + 1)),
            ),
            el(
              View,
              {style: styles.onboardingStepText},
              el(AppText, {variant: 'body', weight: 'semibold'}, step.label),
              el(AppText, {variant: 'caption', tone: 'secondary'}, step.desc),
            ),
          ),
        ),
      ),
    ),
    el(
      ToolCard,
      {
        color: 'green',
        title: t('devtools.telemetryFields.title', 'Telemetry Fields Reference'),
        description: t(
          'devtools.telemetryFields.desc',
          'Catalog of Fleet Telemetry signal fields by category',
        ),
      },
      UnavailableNote(
        t(
          'devtools.telemetryFieldsUnavailable',
          'The full telemetry field catalog and per-vehicle error lookup land with the FleetApiSection native conversion.',
        ),
      ),
    ),
  );
}

/* ─── ClientUtilitiesSection (faithful searchable registry) ────────────────
   web: a search box filtering 15 client-side tool cards that each expand into
   an interactive utility (VIN/JWT decoders, base64, etc.). The search + the
   tool registry (names/descriptions) are ported faithfully; each tool's
   interactive body lands when its ./tools/* native module is converted. */

interface ToolRegistryEntry {
  id: string;
  name: string;
  desc: string;
  color: string;
}

const CLIENT_TOOLS: ToolRegistryEntry[] = [
  {id: 'vin', name: 'VIN Decoder', desc: 'Decode a Tesla VIN into make, model, year and plant', color: 'cyan'},
  {id: 'jwt', name: 'JWT Decoder', desc: 'Decode and inspect a JSON Web Token', color: 'purple'},
  {id: 'timestamp', name: 'Timestamp Converter', desc: 'Convert between Unix epoch and ISO timestamps', color: 'green'},
  {id: 'base64', name: 'Base64', desc: 'Encode and decode Base64 strings', color: 'amber'},
  {id: 'url', name: 'URL Encoder', desc: 'Encode and decode URL components', color: 'cyan'},
  {id: 'json', name: 'JSON Formatter', desc: 'Pretty-print and validate JSON', color: 'green'},
  {id: 'uuid', name: 'UUID Generator', desc: 'Generate random UUID v4 identifiers', color: 'purple'},
  {id: 'hash', name: 'Hash Calculator', desc: 'Compute hashes of an input string', color: 'red'},
  {id: 'bytes', name: 'Byte Size Converter', desc: 'Convert between bytes, KB, MB, GB and TB', color: 'cyan'},
  {id: 'color', name: 'Color Converter', desc: 'Convert between HEX, RGB and HSL colors', color: 'purple'},
  {id: 'cron', name: 'Cron Parser', desc: 'Explain a cron expression in plain language', color: 'green'},
  {id: 'http', name: 'HTTP Status', desc: 'Look up HTTP status codes and meanings', color: 'amber'},
  {id: 'tesla-api', name: 'Tesla API Reference', desc: 'Browse common Tesla Fleet API endpoints', color: 'cyan'},
  {id: 'regex', name: 'Regex Tester', desc: 'Test a regular expression against sample input', color: 'red'},
  {id: 'unix-perm', name: 'Unix Permissions', desc: 'Decode octal Unix file permission bits', color: 'green'},
];

export function ClientUtilitiesSection() {
  const [search, setSearch] = React.useState('');

  const query = search.trim().toLowerCase();
  const filtered = query
    ? CLIENT_TOOLS.filter(
        tool =>
          tool.name.toLowerCase().includes(query) ||
          tool.desc.toLowerCase().includes(query),
      )
    : CLIENT_TOOLS;

  return el(
    View,
    {style: styles.sectionStack},
    el(TextInput, {
      value: search,
      onChangeText: setSearch,
      placeholder: t('devtools.searchTools', 'Search tools...'),
      placeholderTextColor: colors.textMuted,
      style: styles.searchInput,
      accessibilityLabel: t('devtools.searchTools', 'Search tools...'),
    }),
    filtered.length > 0
      ? el(
          View,
          {style: styles.toolGrid},
          ...filtered.map(tool => {
            const accent = accentFor(tool.color);
            return el(
              View,
              {key: tool.id, style: styles.toolCard},
              el(
                View,
                {style: styles.toolCardHeader},
                IconChip(accent),
                el(
                  View,
                  {style: styles.toolCardHeaderText},
                  el(AppText, {variant: 'body', weight: 'semibold'}, tool.name),
                  el(AppText, {variant: 'caption', tone: 'secondary'}, tool.desc),
                ),
              ),
              UnavailableNote(
                t(
                  'devtools.toolBodyPending',
                  'Interactive tool available when its native module is converted.',
                ),
              ),
            );
          }),
        )
      : el(
          AppText,
          {variant: 'body', tone: 'muted', style: styles.centeredEmpty},
          t('devtools.noToolsFound', 'No tools match your search'),
        ),
  );
}

/* ─── capabilities (parity documentation, mirrors charts barrel) ──────────── */

export const nativeDevtoolsBarrelCapabilities = {
  backendDevTools: {
    available: false,
    reason:
      'The admin dev-tool mutations (db-stats, migration-status, mqtt-test, env-check, runtime-info, fleet-api-info) call the API server via ./helpers apiFetch and are not reachable from the native parity build.',
  },
  liveTelemetry: {
    available: false,
    reason:
      'FleetTelemetryHealth and the per-vehicle telemetry error lookup depend on the useTelemetry fleet-error hooks; live data is not wired into the parity tree.',
  },
  clientToolBodies: {
    available: false,
    reason:
      'The 15 ./tools/* client utilities are converted in their own iterations; the searchable registry (names/descriptions) and filter are ported here.',
  },
  fileDownload: {
    available: false,
    reason:
      'The telemetry-errors JSON export uses Blob + document.createElement("a"), which has no React Native equivalent.',
  },
} as const;

const styles = StyleSheet.create({
  toolCard: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
  toolCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  toolCardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  iconChip: {
    height: 40,
    width: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  unavailableNote: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  resultPanel: {
    marginTop: spacing.md,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
  },
  resultOk: {
    backgroundColor: colors.successSurface,
  },
  resultError: {
    backgroundColor: colors.dangerSurface,
  },
  resultIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  resultText: {
    marginTop: spacing.xs,
  },
  resultScroll: {
    marginTop: spacing.xs,
    maxHeight: 256,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.sm,
  },
  mono: {
    fontFamily: 'monospace',
  },
  italic: {
    fontStyle: 'italic',
  },
  statePanel: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
  },
  skeletonWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  skeletonBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  tableStack: {
    gap: spacing.sm,
  },
  table: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  tableCell: {
    flex: 1,
  },
  spaceBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    minWidth: 24,
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  disclosureToggle: {
    marginTop: spacing.sm,
  },
  refGrid: {
    gap: spacing.md,
  },
  refCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing.md,
  },
  refCardText: {
    flex: 1,
    gap: spacing.xs,
  },
  sectionStack: {
    gap: spacing.md,
  },
  onboardingList: {
    gap: spacing.sm,
  },
  onboardingStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  onboardingStepText: {
    flex: 1,
    gap: spacing.xs,
  },
  stepIndex: {
    height: 24,
    width: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
  },
  toolGrid: {
    gap: spacing.md,
  },
  centeredEmpty: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
