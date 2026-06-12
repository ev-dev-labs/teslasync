// Pure, framework-free model + projection for the TeslaAuthCard feature view — the native analogue of everything
// the web component derives before returning JSX (web/src/features/system/components/status/TeslaAuthCard.tsx). No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — a hosting status page passes the auth check's `authenticated` flag,
// the token `expiresAt` ISO string, and a `now` tick. It ALWAYS renders (operator-grade visibility); the styling
// intensifies as the situation worsens (healthy -> amber when expiring within 7 days -> red when expired). This file
// owns exactly the parts the web component computes from those props: the severity classifier (web `severityFor`),
// the day-bucket countdown (web's `Math.floor((exp - now) / DAY)` arithmetic), and the detail-message kind the web
// derives in its `detail` memo. The render layer maps each enum case to a glyph, a status-token color, a Material 3
// Badge variant, and the localized microcopy at the Compose boundary, so no English literal is baked in here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TeslaAuthCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaauthcard

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** Milliseconds in a day — the web `24 * 60 * 60 * 1000` divisor for the expiry countdown. */
internal const val MILLIS_PER_DAY: Long = 24L * 60L * 60L * 1000L

/** Inclusive day threshold below which the token is "expiring soon" — the web `days <= 7` warn bound. */
internal const val WARN_THRESHOLD_DAYS: Long = 7L

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TeslaAuthCardRegistration {
    /** Stable surface id. */
    const val ID: String = "tesla-auth-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TeslaAuthCard"
}

/**
 * The Tesla auth status the host's state holder (P1/S8) carries — the native analogue of the web component's
 * non-`now` props. Pure data so the projection is fully unit-testable.
 *
 * @property authenticated whether the auth check is currently authenticated; `null` when not yet known (web
 *   `boolean | undefined`). A literal `false` is the "disconnected" signal, distinct from the unknown `null`.
 * @property expiresAt the token-expiry ISO-8601 instant, or `null` when unknown (web `string | undefined`).
 */
data class TeslaAuthStatus(
    val authenticated: Boolean?,
    val expiresAt: String?,
)

/**
 * Operator-grade severity of the Tesla connection — the native mirror of the web `Severity` union. The render layer
 * resolves each case to a glyph, a status-token color, a Badge variant, and a localized label, so this enum stays
 * free of Compose types and is fully unit-testable.
 */
enum class AuthSeverity {
    /** Token valid for more than the warn window — web `'ok'` (ShieldCheck, green). */
    Ok,

    /** Token expires within the warn window — web `'warn'` (ShieldAlert, amber). */
    Warn,

    /** Token already expired — web `'expired'` (ShieldX, red). */
    Expired,

    /** No Tesla account connected (`authenticated === false`) — web `'disconnected'` (ShieldX, red). */
    Disconnected,

    /** Authenticated but expiry unknown / unparseable — web `'unknown'` (ShieldAlert, neutral). */
    Unknown,
}

/**
 * The localized detail line the card shows under the title — the native analogue of the web `detail` memo. A
 * structured kind (never a baked-in string) the render layer folds into the matching i18n catalog entry.
 */
sealed interface AuthDetail {
    /** No account connected — render `translation_tesla_subtitle`. Web "No Tesla account is currently connected." */
    data object NotConnected : AuthDetail

    /** Expired or expiry-unknown — render `translation_tesla_reauth_body`. Web "…re-authenticate to resume…". */
    data object Reconnect : AuthDetail

    /**
     * A non-negative day countdown — render `translation_tesla_expiringSoon` ("Expires in %1$sd"). Web
     * "Token expires in N days." for both the healthy and expiring-soon states.
     */
    data class ExpiresInDays(
        val days: Long,
    ) : AuthDetail
}

/**
 * One fully projected, render-ready auth status — everything the web component reads off its props. Pure data (no
 * Compose types): the composable maps [severity] to a glyph + status color + Badge variant + label, folds [detail]
 * through the i18n catalog, and picks the CTA label from [reauthenticate].
 *
 * @property severity the connection severity driving the glyph, bar color, and Badge variant.
 * @property detail the structured detail-line kind the render layer localizes.
 * @property reauthenticate whether the CTA is the "Re-authorize" call to action (web's expired/disconnected
 *   branch), as opposed to the neutral "Manage/Open" affordance.
 */
data class TeslaAuthRow(
    val severity: AuthSeverity,
    val detail: AuthDetail,
    val reauthenticate: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object TeslaAuthCardProjection {
    /**
     * Classifies the connection exactly like the web `severityFor`: a literal `authenticated === false` is
     * [AuthSeverity.Disconnected]; a missing or unparseable [expiresAt] is [AuthSeverity.Unknown]; otherwise the
     * floor-divided day delta selects expired (`< 0`), warn (`<= 7`), or ok. [now] is injected so the bucket is
     * deterministic in tests; the composable supplies the real wall clock.
     */
    fun severityFor(
        authenticated: Boolean?,
        expiresAt: String?,
        now: Instant,
    ): AuthSeverity {
        val days = daysUntil(expiresAt, now)
        return when {
            authenticated == false -> AuthSeverity.Disconnected
            days == null -> AuthSeverity.Unknown
            days < 0 -> AuthSeverity.Expired
            days <= WARN_THRESHOLD_DAYS -> AuthSeverity.Warn
            else -> AuthSeverity.Ok
        }
    }

    /**
     * Whole days from [now] until [expiresAt], floored toward negative infinity (web `Math.floor`), or `null` when
     * the timestamp is missing/unparseable. Negative values mean the token already expired.
     */
    fun daysUntil(
        expiresAt: String?,
        now: Instant,
    ): Long? {
        val exp = parseExpiry(expiresAt) ?: return null
        return Math.floorDiv(exp.toEpochMilli() - now.toEpochMilli(), MILLIS_PER_DAY)
    }

    /**
     * Projects [status] into a render-ready [TeslaAuthRow]. [now] is injected for deterministic tests; the composable
     * supplies the real wall clock. The detail kind mirrors the web `detail` memo branch-for-branch, and the CTA
     * `reauthenticate` flag mirrors the web `sev === 'expired' || sev === 'disconnected'` ternary.
     */
    fun project(
        status: TeslaAuthStatus,
        now: Instant,
    ): TeslaAuthRow {
        val severity = severityFor(status.authenticated, status.expiresAt, now)
        val detail =
            when (severity) {
                AuthSeverity.Disconnected -> AuthDetail.NotConnected
                AuthSeverity.Expired, AuthSeverity.Unknown -> AuthDetail.Reconnect
                AuthSeverity.Ok, AuthSeverity.Warn ->
                    AuthDetail.ExpiresInDays((daysUntil(status.expiresAt, now) ?: 0L).coerceAtLeast(0L))
            }
        return TeslaAuthRow(
            severity = severity,
            detail = detail,
            reauthenticate = severity == AuthSeverity.Expired || severity == AuthSeverity.Disconnected,
        )
    }

    // Tolerant decode chain mirroring the web `Date.parse`: an RFC-3339 instant ("…Z"), then an offset date-time,
    // then a zoneless local date-time treated as UTC. The first that parses wins; none parsing yields null (the
    // web `!Number.isFinite(exp)` -> 'unknown' guard).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseExpiry(raw: String?): Instant? = if (raw.isNullOrBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TeslaAuthCardRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordTeslaAuthCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TeslaAuthCardRegistration.SLUG))
}
