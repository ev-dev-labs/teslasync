// Pure, framework-free metadata + domain model for the DiagnosticPage system surface — the native analogue of the
// cross-cutting concerns + derivations the web page owns (web/src/features/system/pages/DiagnosticPage.tsx, the
// operator-facing self-test wizard). No Compose, no Android framework, no HTTP lives here, so the route identity, the
// per-check/overall status → tone mapping, the download-filename stamp, the report JSON serialization (web
// `JSON.stringify(report, null, 2)`), and the run-phase reduction are all exercised off-device and the composable
// stays a thin render layer.
//
// The web page reads ONE mutation (`useRunDiagnostic`) and never auto-runs: the endpoint fans out concurrent probes
// against every shared dependency and is rate-limited, so the report is operator-initiated. This model therefore
// reduces the run into an immutable [DiagnosticUiState] (idle → running → loaded → failed) the ViewModel exposes, and
// carries the two pure helpers the page render boundary needs — the SI-free, display-only `generated_at` formatter
// and the report's plain-text/JSON serializations (the shared-core `formatDiagnosticReportText` stays the text form).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the P3
// prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace uses,
// so the package intentionally diverges from the path — exactly as the sibling CommandsPage / SqlPlaygroundPage
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.diagnostic

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemdiagnostic.DiagnosticReport
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Canonical metadata for the DiagnosticPage surface. The web page is UNROUTED (it has no `web/src/App.tsx` route, so
 * there is no `Destinations` row to mirror); the host instead wires it as an explicit Navigation-Compose destination
 * keyed by [ROUTE_ID] (see TeslaSyncNavHost). This object carries the cross-cutting concerns the surface owes: the
 * navigation [ROUTE_ID] the host registers and the diagnostics [SLUG] emitted with the one-shot `view.opened` event
 * (P1/S11). There is no per-vehicle feed — the page renders a single operator-initiated report.
 */
object DiagnosticPageRegistration {
    /** The Navigation-Compose destination id the host registers; the web surface is unrouted, so this is its slug. */
    const val ROUTE_ID: String = "DiagnosticPage"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DiagnosticPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no report data. */
internal fun recordDiagnosticPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DiagnosticPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

// ── Backend status enums (web DiagnosticCheckStatus / DiagnosticOverallStatus) ─────────────────────────────────────

/** A per-check outcome that passed — web `DiagnosticCheckStatus` `'ok'`. */
const val CHECK_STATUS_OK: String = "ok"

/** A per-check outcome that is degraded but functional — web `'warn'`. */
const val CHECK_STATUS_WARN: String = "warn"

/** A per-check outcome that failed — web `'fail'` (also the fallback for any unknown status). */
const val CHECK_STATUS_FAIL: String = "fail"

/** The rolled-up "all healthy" verdict — web `DiagnosticOverallStatus` `'ok'`. */
const val OVERALL_STATUS_OK: String = "ok"

/** The rolled-up "some checks need attention" verdict — web `'degraded'`. */
const val OVERALL_STATUS_DEGRADED: String = "degraded"

/** The rolled-up "one or more checks failed" verdict — web `'down'` (also the fallback for any unknown status). */
const val OVERALL_STATUS_DOWN: String = "down"

/**
 * The semantic tone a status maps to at the render boundary — the framework-free analogue of the web
 * `statusBadgeVariant` / `overallTone` `'success' | 'warning' | 'danger'` union. Kept Compose-free here so the
 * mapping is unit-tested off-device; the page translates each tone into its themed color + badge variant + glyph.
 */
enum class DiagnosticTone { Success, Warning, Danger }

/** Maps a per-check status to its tone — web `statusBadgeVariant` (ok → success, warn → warning, else danger). */
fun toneForCheckStatus(status: String): DiagnosticTone =
    when (status) {
        CHECK_STATUS_OK -> DiagnosticTone.Success
        CHECK_STATUS_WARN -> DiagnosticTone.Warning
        else -> DiagnosticTone.Danger
    }

/** Maps the overall status to its tone — web `overallTone` (ok → success, degraded → warning, else danger). */
fun toneForOverallStatus(status: String): DiagnosticTone =
    when (status) {
        OVERALL_STATUS_OK -> DiagnosticTone.Success
        OVERALL_STATUS_DEGRADED -> DiagnosticTone.Warning
        else -> DiagnosticTone.Danger
    }

// ── Display-only serializations (no SI conversion: no field is unit-bearing — see SystemDiagnosticModels) ──────────

private val GENERATED_AT_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")
private val FILENAME_FRACTION_REGEX = Regex("\\.\\d+Z$")

private val DIAGNOSTIC_REPORT_JSON: Json =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
        encodeDefaults = true
        explicitNulls = false
    }

/**
 * Formats the report's `generated_at` ISO instant for the overall-hero "Generated …" caption (web
 * `useDateFormat().formatDateTime`). Mirrors the sibling ApiLogsPage formatter (UTC, second precision). A malformed
 * stamp falls back to the raw value rather than throwing, so the hero never blanks on a bad timestamp.
 */
fun formatGeneratedAt(generatedAt: String): String =
    runCatching {
        OffsetDateTime.parse(generatedAt).atZoneSameInstant(ZoneOffset.UTC).format(GENERATED_AT_FORMATTER)
    }.getOrDefault(generatedAt)

/**
 * Builds the filesystem-safe timestamp slug for the downloaded report filename — the native analogue of the web
 * `downloadFilename` helper: take the report's `generated_at` (or "now" when it is unparseable), render it ISO, then
 * replace `:` with `-` and strip fractional seconds so re-running and saving twice never collide. The page feeds the
 * result into the `diagnostic.filename` resource (`teslasync-diagnostic-%1$s.txt`).
 *
 * @param now injectable clock seam so the fallback branch is deterministic in tests.
 */
fun downloadFilenameStamp(
    generatedAt: String,
    now: () -> Instant = Instant::now,
): String {
    val instant = runCatching { OffsetDateTime.parse(generatedAt).toInstant() }.getOrElse { now() }
    return instant.toString().replace(":", "-").replace(FILENAME_FRACTION_REGEX, "Z")
}

/**
 * Serializes a [DiagnosticReport] to the pretty-printed JSON the Copy-report affordance writes to the clipboard — the
 * native analogue of the web `JSON.stringify(report, null, 2)`. The @SerialName-driven snake_case keys
 * (`generated_at`, `overall_status`, `duration_ms`) round-trip verbatim; `encodeDefaults` keeps present fields and
 * `explicitNulls = false` omits an absent `remediation` exactly as `JSON.stringify` omits `undefined`.
 */
fun diagnosticReportJson(report: DiagnosticReport): String =
    DIAGNOSTIC_REPORT_JSON.encodeToString(DiagnosticReport.serializer(), report)

// ── Run-phase reduction (web useRunDiagnostic mutation status + latestError) ───────────────────────────────────────

/**
 * The immutable run phase the ViewModel exposes and the screen renders — the native reduction of the web page's
 * mutation status (`runDiagnostic.isPending` / `runDiagnostic.data`) plus its `latestError`:
 *  - [Idle]    — no run yet (web initial: `data` undefined, not pending) → the no-report empty state (GlassPanel5);
 *  - [Running] — the probe set is in flight (web `isPending`) → the centered spinner panel (GlassPanel4);
 *  - [Loaded]  — a report resolved (web `data`) → the overall hero (GlassPanel2) + per-check cards (GlassPanel3);
 *  - [Failed]  — the run errored (web `latestError`, `data` reset to undefined) → the error banner (GlassPanel1)
 *    AND the no-report empty state, exactly as the web shows both once the mutation rejects.
 */
sealed interface DiagnosticUiState {
    /** No diagnostic has been run in this session yet — the web initial mutation state (page never auto-runs). */
    data object Idle : DiagnosticUiState

    /** The probe set is in flight — web `runDiagnostic.isPending`. */
    data object Running : DiagnosticUiState

    /** A report resolved — web `runDiagnostic.data`. */
    data class Loaded(val report: DiagnosticReport) : DiagnosticUiState

    /** The run rejected — web `latestError`; [message] is the failure text, or `null` when none was supplied. */
    data class Failed(val message: String?) : DiagnosticUiState
}

/** Whether the probe set is in flight — web `runDiagnostic.isPending` (drives the spinner + disabled Run button). */
val DiagnosticUiState.isRunning: Boolean get() = this is DiagnosticUiState.Running

/** Whether a resolved report is on screen — web `Boolean(runDiagnostic.data)` (drives the Re-run label + actions). */
val DiagnosticUiState.hasReport: Boolean get() = this is DiagnosticUiState.Loaded

/** The resolved report, or `null` in every non-loaded phase — web `runDiagnostic.data`. */
val DiagnosticUiState.report: DiagnosticReport? get() = (this as? DiagnosticUiState.Loaded)?.report

/** The failure text when the run rejected, else `null` — web `latestError?.message`. */
val DiagnosticUiState.errorMessage: String? get() = (this as? DiagnosticUiState.Failed)?.message
