// Native parity port of
// web/src/features/admin/components/ingest-xray/XRayHeader.tsx.
//
// Ingest X-Ray — header strip. Three StatCards summarising what the current
// X-Ray window contains:
//   - Total samples ingested in the window
//   - Distinct signal fields seen
//   - Window length the operator selected (echoed back so the strip reads like
//     a self-explanatory summary)
//
// Web dependencies absent from the native parity manifest are made native-safe
// (contract rules 4 & 5) and documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L10) -> inlined useNativeTranslation():
//     a useCallback-stable (key, fallback, options?) => fallback shim that
//     reproduces i18next `{{name}}` interpolation against the English fallback
//     copy (the established ChangesPanel / QueryError pattern). Every i18n key +
//     default string is preserved verbatim, including the template-literal
//     `admin.xray.windowLabel.${windowSel}` key.
//   - lucide-react Activity / Layers / Clock (web L11) -> SemanticIcon
//     (activity / layoutTemplate / clock); the `h-5 w-5` icons carry no
//     aria-label on the web, so they are rendered `decorative`.
//   - `@/components/data-display` StatCard (web L13) -> the already-ported native
//     web-parity StatCard (same label / value / icon / sublabel contract).
//   - `@/components/layout` Grid (web L14) -> a native flex-wrap row that mirrors
//     the web `cols={{ default: 1, sm: 3 }}` responsively (1-up below the
//     Tailwind `sm` 640px breakpoint, 3-up at/above it) with `gap-4` (16px).
//   - `@/lib/numberFormat` fmtInt (web L15) -> an inlined faithful port (locale
//     separators, 0 fraction digits, nullish/NaN -> 0).
//   - `@/types/admin-diagnostics` IngestXRayResponse / IngestXRayWindow
//     (web L16-19): the native types module is not yet ported, so the ingest
//     X-Ray type block is mirrored locally and re-exported to keep this file
//     self-contained and typecheck-clean.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components
// are imported — only react, react-native primitives, and existing apps/native
// components / tokens.

import React, {useCallback} from 'react';
import {StyleSheet, View, useWindowDimensions} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {StatCard} from '../../../../components/data-display';

/**
 * Native mirror of web/src/types/admin-diagnostics.ts (native types module not
 * yet ported). Allowed window literals — server rejects anything else with 400.
 */
export type IngestXRayWindow = '5m' | '15m' | '1h' | '6h' | '24h';

/** Allowed bucket literals — server rejects anything else with 400. */
export type IngestXRayBucket = '30s' | '1m' | '5m' | '15m' | '1h';

/**
 * `value_kind` matches `protomodel.ValueKind` in the Go ingest path. 0 is
 * "unknown", everything else is a typed kind.
 */
export type IngestXRayValueKind = number;

export interface IngestXRayFieldStat {
  field: string;
  sample_count: number;
  last_seen_at: string;
  value_kind: IngestXRayValueKind;
}

export interface IngestXRayBucketPoint {
  bucket_start: string;
  count: number;
}

export interface IngestXRayResponse {
  vehicle_id: number;
  window: IngestXRayWindow;
  bucket: IngestXRayBucket;
  generated_at: string;
  total_samples: number;
  unique_fields: number;
  fields: IngestXRayFieldStat[];
  buckets: IngestXRayBucketPoint[];
}

interface XRayHeaderProps {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
}

const WINDOW_LABEL: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

// Tailwind `sm` breakpoint — drives the web Grid `cols.sm = 3` switch.
const SM_BREAKPOINT = 640;

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next useTranslation replacement: returns the English fallback,
// reproducing i18next `{{name}}` interpolation against that fallback copy.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

// Inlined faithful port of web lib/numberFormat fmtInt: locale separators, 0
// fraction digits, nullish/NaN coerced to 0.
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

export function XRayHeader({data, loading, windowSel}: XRayHeaderProps) {
  const t = useNativeTranslation();
  const {width} = useWindowDimensions();
  const itemStyle = width < SM_BREAKPOINT ? styles.itemSingle : styles.itemTriple;

  return (
    <View style={styles.grid}>
      <View style={[styles.item, itemStyle]}>
        <StatCard
          icon={<SemanticIcon decorative name="activity" size="sm" />}
          label={t('admin.xray.stats.samples', 'Total samples')}
          sublabel={t('admin.xray.stats.samplesSub', 'within selected window')}
          value={loading ? '—' : fmtInt(data?.total_samples ?? 0)}
        />
      </View>
      <View style={[styles.item, itemStyle]}>
        <StatCard
          icon={<SemanticIcon decorative name="layoutTemplate" size="sm" />}
          label={t('admin.xray.stats.fields', 'Distinct fields')}
          sublabel={t('admin.xray.stats.fieldsSub', 'unique signal names')}
          value={loading ? '—' : fmtInt(data?.unique_fields ?? 0)}
        />
      </View>
      <View style={[styles.item, itemStyle]}>
        <StatCard
          icon={<SemanticIcon decorative name="clock" size="sm" />}
          label={t('admin.xray.stats.window', 'Window')}
          sublabel={t('admin.xray.stats.windowSub', 'observation horizon')}
          value={t(
            `admin.xray.windowLabel.${windowSel}`,
            WINDOW_LABEL[windowSel],
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  item: {
    flexGrow: 1,
  },
  itemSingle: {
    flexBasis: '100%',
  },
  itemTriple: {
    flexBasis: '30%',
  },
});
