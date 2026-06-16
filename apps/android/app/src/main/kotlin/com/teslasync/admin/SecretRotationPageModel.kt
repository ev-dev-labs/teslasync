// Pure, framework-free model + projection for the SecretRotationPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/SecretRotationPage.tsx,
// the per-(kind, target) credential-rotation tracker). No Compose, no Android framework, no HTTP lives here:
// every type is exercised off-device, keeping the composable a thin render layer.
//
// The feed arrives already typed from the shared S8 OperatorConfidenceStore (`GET
// /admin/observability/secret-rotation` ▸ secretRotation()), so unlike the raw-JSON IngestXRay/ApiLogs ports
// this file owns no parsing — only the client-side derivations the web component does inline: the severity
// tier classification (web `SEVERITY_VARIANT`/`SEVERITY_LABEL`), the ok/warn/critical/total roll-up (web
// `counts`), and the active-subsystem predicate. The control-plane values (age in days, day thresholds, ISO
// stamps) are SI-agnostic and the backend already computed them, so there is no unit conversion here; locale
// number/date formatting is applied at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/admin —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling admin surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.secretrotation

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationStatus

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object SecretRotationPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminSecretRotation", "/admin/secret-rotation", …)`). */
    const val ROUTE_ID: String = "adminSecretRotation"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/secret-rotation"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SecretRotationPage"
}

/**
 * The severity tier of one tracked secret — the native mirror of the web `SecretRotationSeverity` union
 * (`ok | warn | critical | unknown`). The wire value arrives as a raw string (so an unexpected server token
 * round-trips verbatim instead of blanking the screen); [from] folds it to this closed tier, defaulting to
 * [Unknown] for anything unrecognised exactly as the web `SEVERITY_VARIANT[…] ?? 'neutral'` fallback does.
 */
enum class SecretSeverityTone {
    Ok,
    Warn,
    Critical,
    Unknown,
    ;

    internal companion object {
        /** Classify the raw `severity` string (web severity union), defaulting to [Unknown]. */
        fun from(raw: String): SecretSeverityTone =
            when (raw.lowercase()) {
                "ok" -> Ok
                "warn" -> Warn
                "critical" -> Critical
                else -> Unknown
            }
    }
}

/**
 * The ok / warn / critical / total roll-up over the tracked secrets — the native mirror of the web `counts`
 * memo. Computed once per payload and consumed by the four stat tiles; [critical] also gates the danger
 * "overdue rotations" banner (web `counts.critical > 0`).
 */
data class RotationCounts(
    val ok: Int,
    val warn: Int,
    val critical: Int,
    val total: Int,
) {
    internal companion object {
        val EMPTY: RotationCounts = RotationCounts(ok = 0, warn = 0, critical = 0, total = 0)

        /** Tally [items] by severity tier (web `counts` reducer). */
        fun from(items: List<SecretRotationStatus>): RotationCounts {
            var ok = 0
            var warn = 0
            var critical = 0
            for (item in items) {
                when (SecretSeverityTone.from(item.severity)) {
                    SecretSeverityTone.Ok -> ok += 1
                    SecretSeverityTone.Warn -> warn += 1
                    SecretSeverityTone.Critical -> critical += 1
                    SecretSeverityTone.Unknown -> Unit
                }
            }
            return RotationCounts(ok = ok, warn = warn, critical = critical, total = items.size)
        }
    }
}

/**
 * The render-ready projection the surface binds to: the tracked-secret [items] in server order and their
 * derived [counts]. [isEmpty] gates the native Empty phase — the server returned no tracked secrets (web
 * `items.length === 0`).
 */
data class SecretRotationView(
    val items: List<SecretRotationStatus>,
    val counts: RotationCounts,
) {
    val isEmpty: Boolean get() = items.isEmpty()

    internal companion object {
        val EMPTY: SecretRotationView = SecretRotationView(emptyList(), RotationCounts.EMPTY)

        /** Project the typed [response] into the counts-folded view. */
        fun from(response: SecretRotationResponse?): SecretRotationView {
            val items = response?.items ?: emptyList()
            return SecretRotationView(items = items, counts = RotationCounts.from(items))
        }
    }
}

/**
 * Whether the secret-rotation subsystem is unconfigured on this deployment — the native mirror of the web
 * `subsystemMissing = isApiError(error) && error.status === 503`. The backend returns HTTP 503 with
 * `code: SUBSYSTEM_NOT_CONFIGURED` when the rotation tracker repo was never wired; the surface branches on
 * this to render an explanatory warning banner + empty table rather than a hard error.
 */
fun isSubsystemMissing(httpStatus: Int?): Boolean = httpStatus == HTTP_SUBSYSTEM_NOT_CONFIGURED

/** The HTTP status the backend returns for an unconfigured operator-confidence subsystem. */
internal const val HTTP_SUBSYSTEM_NOT_CONFIGURED: Int = 503

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no log content. */
internal fun recordSecretRotationPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SecretRotationPageRegistration.SLUG))
}
