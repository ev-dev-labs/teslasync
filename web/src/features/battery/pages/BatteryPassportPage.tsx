import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  useBatteryPassport,
  useVerifyPassport,
  type BatteryPassport,
} from '@/api/hooks/useBatteryPassport';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';

import {
  BatteryPassportCapacityContext,
  BatteryPassportFieldDirectory,
  BatteryPassportGradeAudit,
  BatteryPassportKpiBand,
  BatteryPassportMasthead,
  BatteryPassportMethodology,
  BatteryPassportProvenanceMatrix,
  BatteryPassportRecommendations,
  BatteryPassportThermalProfile,
  BatteryPassportTrendDiagnostics,
  BatteryPassportTrendDistribution,
  BatteryPassportTrendTimeline,
  BatteryPassportUsageProfile,
  BatteryPassportVerificationDiagnostics,
  type BatteryPassportQueryState,
  type BatteryPassportVerificationState,
} from '../components/battery-passport';
import {
  analyzeBatteryPassport,
  toBatteryPassportCertificate,
} from '../lib/batteryPassportAnalysis';

/**
 * Battery Passport workspace orchestration contract
 * -------------------------------------------------
 *
 * This page intentionally owns only cross-section concerns:
 *
 * - resolve the selected vehicle once for both API hooks;
 * - keep the certificate and verification hooks mounted unconditionally;
 * - distinguish unresolved, loading, initial-error, empty-success, cached,
 *   and cached-refresh states without hiding the workspace;
 * - capture one immutable page clock for every date-based diagnostic;
 * - derive one immutable analysis result for every extracted section;
 * - create the canonical snake_case download from unmodified response facts;
 * - pass vehicle-time display context only to instant-based identity fields;
 * - leave UTC trend dates in UTC throughout analysis and presentation;
 * - expose one retry action, owned by the masthead's initial-error surface;
 * - treat verification failure as status evidence rather than page failure.
 *
 * Section components own their panel shells and state-specific interiors.
 * Consequently, PageContainer must never receive a page-level loading,
 * error, or empty gate: doing so would unmount all fourteen evidence shells.
 *
 * Persistent state matrix:
 *
 * - no vehicle: both API hooks are disabled by null arguments;
 * - initial loading: every shell remains present with local loading content;
 * - initial error: only the masthead can retry, while other shells stay calm;
 * - empty success: export remains disabled and every shell reports no facts;
 * - certificate success: all sections read one shared deterministic analysis;
 * - verification loading: certificate facts remain fully interactive;
 * - verification error: the certificate remains visible and exportable;
 * - verification mismatch: both digests remain separate and inspectable;
 * - cached refresh: cached facts stay mounted with a non-destructive notice.
 *
 * Keeping this contract here makes the page a readable route-level map while
 * the substantial rendering and deterministic evidence logic remain in the
 * extracted component and lib modules.
 */
const TWO_COLUMNS = {
  default: 1,
  xl: 2,
} as const;

function downloadCertificate(passport: BatteryPassport): void {
  const certificate = toBatteryPassportCertificate(passport);
  const blob = new Blob(
    [JSON.stringify(certificate, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const hashPrefix =
    typeof passport.provenance_hash === 'string'
      ? passport.provenance_hash.slice(0, 12)
      : '';
  anchor.href = url;
  anchor.download =
    `battery-passport-${passport.vehicle_id}-${hashPrefix}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function BatteryPassportPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(
    t(
      'batteryPassport.title',
      'Battery Passport',
    ),
  );

  /*
   * Selection is deliberately resolved before both query hooks, but neither
   * hook is conditional. This keeps exactly one passport query and one
   * verification query mounted for every workspace state, including the
   * no-vehicle state.
   */
  const { vehicleId } = useSelectedVehicle();
  const vehicleTimeZone = useTimezone('vehicle');
  const vehicleIdString =
    vehicleId != null
      ? String(vehicleId)
      : null;

  const passportQuery = useBatteryPassport(
    vehicleIdString,
  );
  const passport = passportQuery.data ?? null;

  /*
   * Verification always receives the digest from the currently displayed
   * certificate. The hook remains disabled until both arguments exist; an
   * unavailable verification request never removes certificate evidence.
   */
  const verifyQuery = useVerifyPassport(
    vehicleIdString,
    passport?.provenance_hash ?? null,
  );

  /*
   * One page clock is captured for the lifetime of this mount. Query updates
   * can change evidence, but cannot move a date between future/included
   * categories or age the recency KPI under the user's cursor.
   */
  const [pageNowMs] = useState(
    () => Date.now(),
  );
  const analysis = useMemo(
    () => analyzeBatteryPassport(
      passport,
      pageNowMs,
    ),
    [
      pageNowMs,
      passport,
    ],
  );

  /*
   * `undefined` means the initial request has not produced a payload.
   * `null` is a resolved empty response and must remain distinct so an empty
   * success never turns into an initial-error retry surface.
   */
  const payloadResolved =
    passportQuery.data !== undefined;
  const vehicleSelected =
    vehicleIdString !== null;
  const dataAvailable =
    vehicleSelected
    && (
      payloadResolved
      || passportQuery.isSuccess
    );
  const isLoading =
    vehicleSelected
    && !dataAvailable
    && !passportQuery.isError
    && (
      passportQuery.isLoading
      || passportQuery.isFetching
    );
  const initialError =
    vehicleSelected
    && !payloadResolved
    && passportQuery.isError
      ? passportQuery.error
      : null;
  const refreshError =
    vehicleSelected
    && payloadResolved
    && passportQuery.isError
      ? passportQuery.error
      : null;
  const isResolved =
    vehicleSelected
    && (
      dataAvailable
      || Boolean(initialError)
    );

  const onRetry = useCallback(
    () => {
      void passportQuery.refetch();
    },
    [passportQuery],
  );
  const queryState: BatteryPassportQueryState = {
    vehicleSelected,
    passport,
    isLoading,
    isResolved,
    initialError,
    refreshError,
    onRetry,
  };

  /*
   * Verification failure is a certificate status, not a page failure.
   * Initial verification loading is shown only when no response exists.
   * During a background fetch, cached evidence is identified explicitly as
   * a previous result rather than presented as a current digest comparison.
   */
  const verification: BatteryPassportVerificationState = (() => {
    if (
      passport == null
      || typeof passport.provenance_hash !== 'string'
      || passport.provenance_hash === ''
    ) {
      return {
        status: 'unavailable',
        data: null,
        error: null,
      };
    }
    if (
      verifyQuery.isLoading
      && verifyQuery.data == null
    ) {
      return {
        status: 'loading',
        data: null,
        error: null,
      };
    }
    if (
      verifyQuery.isFetching
      && verifyQuery.data != null
    ) {
      return {
        status: 'refreshing',
        data: verifyQuery.data,
        error: null,
      };
    }
    if (verifyQuery.error) {
      return {
        status: 'error',
        data: verifyQuery.data ?? null,
        error: verifyQuery.error,
      };
    }
    if (verifyQuery.data?.valid === true) {
      return {
        status: 'valid',
        data: verifyQuery.data,
        error: null,
      };
    }
    if (verifyQuery.data?.valid === false) {
      return {
        status: 'mismatch',
        data: verifyQuery.data,
        error: null,
      };
    }
    return {
      status: 'unavailable',
      data: verifyQuery.data ?? null,
      error: null,
    };
  })();

  const onExport = useCallback(
    () => {
      if (passport) {
        downloadCertificate(passport);
      }
    },
    [passport],
  );

  return (
    <PageContainer
      title={t(
        'batteryPassport.title',
        'Battery Passport',
      )}
      subtitle={t(
        'batteryPassport.subtitle',
        'Persistent certificate evidence, transparent reconstruction, provenance boundaries, and verification diagnostics',
      )}
    >
      {/*
       * 1 · Certificate identity, controls, export, and verification state.
       * This is the sole owner of the initial-query retry action.
       */}
      <FadeIn>
        <BatteryPassportMasthead
          state={queryState}
          verification={verification}
          locale={i18n.language}
          timeZone={vehicleTimeZone}
          onExport={onExport}
        />
      </FadeIn>

      {/*
       * 2 · Six certificate-reported headline fields.
       * Invalid diagnostic values are withheld rather than coerced.
       */}
      <FadeIn delay={0.03}>
        <BatteryPassportKpiBand
          analysis={analysis}
          state={queryState}
        />
      </FadeIn>

      {/*
       * 3 · UTC trend timeline.
       * Its shared chart shell remains mounted for every query state.
       */}
      <FadeIn delay={0.06}>
        <BatteryPassportTrendTimeline
          analysis={analysis}
          state={queryState}
          locale={i18n.language}
        />
      </FadeIn>

      {/*
       * 4 · Trend diagnostics.
       * Exact accounting, coverage, cadence, variability, and fit gates.
       */}
      <FadeIn delay={0.09}>
        <BatteryPassportTrendDiagnostics
          analysis={analysis}
          state={queryState}
        />
      </FadeIn>

      {/*
       * 5 and 6 · Distribution and capacity context.
       * These sit together visually but retain independent panel shells.
       */}
      <FadeIn delay={0.12}>
        <Grid
          cols={TWO_COLUMNS}
          gap={4}
          className="items-stretch"
        >
          <BatteryPassportTrendDistribution
            analysis={analysis}
            state={queryState}
          />
          <BatteryPassportCapacityContext
            analysis={analysis}
            state={queryState}
          />
        </Grid>
      </FadeIn>

      {/*
       * 7 · Transparent server-grade rule reconstruction.
       * Reported and reconstructed grades are never silently reconciled.
       */}
      <FadeIn delay={0.15}>
        <BatteryPassportGradeAudit
          analysis={analysis}
          state={queryState}
        />
      </FadeIn>

      {/*
       * 8 and 9 · Usage and thermal profiles.
       * Neutral rollups and exact thermal accounting share one dense row.
       */}
      <FadeIn delay={0.18}>
        <Grid
          cols={TWO_COLUMNS}
          gap={4}
          className="items-stretch"
        >
          <BatteryPassportUsageProfile
            analysis={analysis}
            state={queryState}
          />
          <BatteryPassportThermalProfile
            analysis={analysis}
            state={queryState}
          />
        </Grid>
      </FadeIn>

      {/*
       * 10 · Server rule-output directory.
       * Verbatim outputs remain framed as evidence, not prescriptions.
       */}
      <FadeIn delay={0.21}>
        <BatteryPassportRecommendations
          state={queryState}
        />
      </FadeIn>

      {/*
       * 11 · Provenance matrix.
       * Exact v1 hash inputs are separated from explicitly unbound facts.
       */}
      <FadeIn delay={0.24}>
        <BatteryPassportProvenanceMatrix
          analysis={analysis}
          state={queryState}
        />
      </FadeIn>

      {/*
       * 12 · Verification diagnostics.
       * Current recomputation is non-blocking certificate status evidence.
       */}
      <FadeIn delay={0.27}>
        <BatteryPassportVerificationDiagnostics
          state={queryState}
          verification={verification}
        />
      </FadeIn>

      {/*
       * 13 · Certificate field directory.
       * Every top-level and relevant nested wire field remains inspectable.
       */}
      <FadeIn delay={0.3}>
        <BatteryPassportFieldDirectory
          analysis={analysis}
          state={queryState}
        />
      </FadeIn>

      {/*
       * 14 · Methodology and interpretation limits.
       * Static disclosure remains visible independently of API availability.
       */}
      <FadeIn delay={0.33}>
        <BatteryPassportMethodology />
      </FadeIn>
    </PageContainer>
  );
}
