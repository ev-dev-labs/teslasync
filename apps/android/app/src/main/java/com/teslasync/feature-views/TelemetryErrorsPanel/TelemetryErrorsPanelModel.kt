// Pure, framework-free model + projection for the TelemetryErrorsPanel feature view — the native
// analogue of every render branch the web component selects between
// (web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx) before returning JSX. No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TelemetryErrorsPanel — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetryerrorspanel

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN or error
 * payload, so a diagnostics line can never leak the fleet's posture.
 */
const val TELEMETRY_ERRORS_PANEL_SLUG: String = "TelemetryErrorsPanel"

/** The export pretty-printer — 2-space indent to match the web `JSON.stringify(value, null, 2)`. */
private val EXPORT_JSON: Json =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

/**
 * The UI-normalised error row after Tesla's response envelope has been unwrapped — the native mirror
 * of the web `./types` `TelemetryError`. `@Serializable` so the data-state export reproduces the web
 * `JSON.stringify(errors, null, 2)` blob byte-for-byte (same keys, same order).
 */
@Serializable
data class TelemetryError(
    val rowKey: String,
    val timestamp: String,
    val code: String,
    val message: String,
)

/**
 * The already-localized strings the panel renders. The web component is anonymous — it receives every
 * label as a prop resolved by its parent — so these arrive through the P1/S10 i18n facade at the
 * Compose boundary and are passed in, keeping the panel free of any English literal.
 */
data class TelemetryErrorsPanelLabels(
    val title: String,
    val idleMessage: String,
    val emptyMessage: String,
    val rawDisclosureLabel: String,
    val downloadLabel: String,
)

/**
 * The pre-serialized JSON export payload for the data-state download affordance — the native analogue
 * of the web Blob download: a [fileName] (`telemetry-errors-{vin|all}.json`) and the pretty-printed
 * [json] body.
 */
data class TelemetryErrorsDownload(
    val fileName: String,
    val json: String,
)

/**
 * The empty-state status chip — the native mirror of the web `Badge variant={ok ? 'success' : 'warning'}`
 * showing `0` (Tesla returned zero errors — the healthy steady state) or `?` (Tesla returned a shape
 * the extractor did not recognise).
 */
enum class TelemetryErrorsEmptyBadge(
    val text: String,
) {
    Healthy("0"),
    Unknown("?"),
}

/**
 * The five mutually-exclusive render branches of the web component — `idle` (not requested), `loading`,
 * `error`, `data` (one or more rows), and `empty` (request succeeded with zero rows). Pure data so the
 * branch selection is unit-tested without a UI host.
 */
sealed interface TelemetryErrorsPanelState {
    /** The "View Errors" button has not been pressed yet (web `!requested`). */
    data object Idle : TelemetryErrorsPanelState

    /** The fetch is in flight (web `loading`). */
    data object Loading : TelemetryErrorsPanelState

    /** The fetch failed with a message (web `error`). */
    data class Failure(
        val message: String,
    ) : TelemetryErrorsPanelState

    /** The fetch produced rows (web `errors.length > 0`); [download] is the precomputed export blob. */
    data class Data(
        val errors: List<TelemetryError>,
        val download: TelemetryErrorsDownload,
    ) : TelemetryErrorsPanelState

    /**
     * The fetch succeeded but produced zero rows (web empty branch). [badge] distinguishes the healthy
     * `0` from the unknown-shape `?`; [rawJson] is the pretty-printed raw response shown beneath the
     * message only when the extractor failed (web `!ok && rawData != null`), else `null`.
     */
    data class Empty(
        val badge: TelemetryErrorsEmptyBadge,
        val rawJson: String?,
    ) : TelemetryErrorsPanelState
}

/**
 * Pure projection from the panel's inputs to its [TelemetryErrorsPanelState] — a 1:1 port of the web
 * component's `if (!requested) … if (loading) … if (error) … if (errors.length > 0) … else …` ladder,
 * including the empty-state badge selection and the raw-response disclosure gate.
 */
object TelemetryErrorsPanelProjection {
    /**
     * Select the render branch for the given inputs, in the web's exact precedence order. [error] is the
     * truthy-string failure message (an empty string is "no error", matching JS falsiness); [vin] feeds
     * the data-state export filename; [rawData] is the raw Tesla response surfaced only on the
     * unknown-shape empty branch.
     *
     * The seven inputs mirror the web `TelemetryErrorsPanel` props that select the branch; bundling them
     * into a holder would only move the count onto a data-class constructor (also flagged), so the 1:1
     * prop mapping is kept and the parameter-list threshold is suppressed.
     */
    @Suppress("LongParameterList")
    fun project(
        requested: Boolean,
        loading: Boolean,
        error: String?,
        errors: List<TelemetryError>,
        ok: Boolean,
        vin: String,
        rawData: JsonElement?,
    ): TelemetryErrorsPanelState =
        when {
            !requested -> TelemetryErrorsPanelState.Idle
            loading -> TelemetryErrorsPanelState.Loading
            !error.isNullOrEmpty() -> TelemetryErrorsPanelState.Failure(error)
            errors.isNotEmpty() -> TelemetryErrorsPanelState.Data(errors, downloadOf(vin, errors))
            else ->
                TelemetryErrorsPanelState.Empty(
                    badge = if (ok) TelemetryErrorsEmptyBadge.Healthy else TelemetryErrorsEmptyBadge.Unknown,
                    rawJson = rawDisclosureJson(ok, rawData),
                )
        }

    /** Build the data-state export blob: the filename + the pretty-printed errors array (web download). */
    fun downloadOf(
        vin: String,
        errors: List<TelemetryError>,
    ): TelemetryErrorsDownload = TelemetryErrorsDownload(fileName = downloadFileName(vin), json = EXPORT_JSON.encodeToString(errors))

    /** The export filename — web `telemetry-errors-${vin || 'all'}.json` (blank/whitespace VIN → `all`). */
    fun downloadFileName(vin: String): String = "telemetry-errors-${vin.ifBlank { "all" }}.json"

    /**
     * The raw-response JSON to disclose beneath the empty state, or `null` when it should be hidden —
     * web `!ok && rawData != null`. A JSON `null` (kotlinx `JsonNull`) is treated as absent so it mirrors
     * the JS nullish check rather than printing the literal `null`.
     */
    fun rawDisclosureJson(
        ok: Boolean,
        rawData: JsonElement?,
    ): String? =
        if (!ok && rawData != null && rawData != JsonNull) {
            EXPORT_JSON.encodeToString(JsonElement.serializer(), rawData)
        } else {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TELEMETRY_ERRORS_PANEL_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls
 * it from its first-composition effect.
 */
fun recordTelemetryErrorsPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TELEMETRY_ERRORS_PANEL_SLUG))
}
