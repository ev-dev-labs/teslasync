// Pure, framework-free model + derivations for the SchemaDriftPage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/SchemaDriftPage.tsx, the schema-drift observability surface). No Compose, no
// Android UI, no HTTP lives here: the feed arrives as the shared, already-decoded S8 payload (the KMP
// `OperatorConfidenceStore.schemaDrift()` ▸ `GET /admin/observability/schema-drift`, a typed
// `SchemaDriftResponse`), so this file owns only the client-side derivations the web component does inline: the
// drifted/clean status fold (web `data.is_different ?? drift.has_drift`), the empty-fingerprint guard (web
// empty-state condition), the locale-grouped integer + signed-delta formatters (web `fmtNumber` / `formatDelta`),
// and the one PII-safe `view.opened` diagnostic. None of the schema-drift fields is unit-bearing (SHA
// fingerprints, integer roll-ups, signed deltas, an ISO stamp), so there is no SI conversion — locale formatting
// is applied here at the model boundary and the timestamp at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.schemadrift

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SchemaDriftResponse
import java.text.NumberFormat
import java.util.Locale

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11). There is no page size or feed metadata because the page renders a
 * single read-only fingerprint comparison.
 */
object SchemaDriftPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminSchemaDrift", "/admin/schema-drift", …)`). */
    const val ROUTE_ID: String = "adminSchemaDrift"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/schema-drift"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no fingerprint bytes. */
    const val SLUG: String = "SchemaDriftPage"
}

/**
 * The HTTP status the operator-confidence endpoints return when their backing repo is nil — the web `503` /
 * `SUBSYSTEM_NOT_CONFIGURED` signal the page branches on to render the "subsystem unavailable" banner rather
 * than a hard error (web `isApiError(error) && error.status === 503`).
 */
const val HTTP_SUBSYSTEM_UNAVAILABLE: Int = 503

/** Em dash used as the universal "no value" marker, matching the web `'—'` SHA fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Whether drift is present — the native fold of the web `data.is_different ?? drift.has_drift`. The envelope's
 * [SchemaDriftResponse.isDifferent] is preferred; the body's `has_drift` is the fallback, so either signal
 * surfaces the drifted status badge.
 */
val SchemaDriftResponse.isDrifted: Boolean
    get() = isDifferent || drift.hasDrift

/**
 * Whether no fingerprint has been computed yet — both the current and expected SHA are blank. Gates the native
 * Empty phase (web empty-state: "The schema fingerprint has not been computed yet"). A response that carries a
 * real fingerprint, even one with zero drift, is content (the summary + details panels), not empty.
 */
val SchemaDriftResponse.isEmptyDrift: Boolean
    get() = drift.current.sha256.isBlank() && drift.expected.sha256.isBlank()

/**
 * Locale-grouped integer formatting (web `fmtNumber` ▸ `Number.toLocaleString`): `formatCount(1234)` →
 * `"1,234"` in `en-US`. Used for every table/column/index roll-up and the delta magnitudes.
 */
fun formatCount(
    value: Long,
    locale: Locale = Locale.getDefault(),
): String = NumberFormat.getIntegerInstance(locale).format(value)

/**
 * Signed, locale-grouped delta (web `formatDelta`): `0` → `"0"`, a positive delta gets a leading `+`, and a
 * negative delta keeps the locale minus sign from [formatCount]. Drives the three "Δ" stat-card values.
 */
fun formatDelta(
    delta: Long,
    locale: Locale = Locale.getDefault(),
): String =
    when {
        delta == 0L -> "0"
        delta > 0L -> "+" + formatCount(delta, locale)
        else -> formatCount(delta, locale)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SchemaDriftPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no SHA, table name, or count.
 */
fun recordSchemaDriftPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SchemaDriftPageRegistration.SLUG))
}
