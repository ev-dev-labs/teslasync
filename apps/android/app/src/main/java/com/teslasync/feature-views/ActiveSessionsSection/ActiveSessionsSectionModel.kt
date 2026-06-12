// Pure, framework-free model + projection for the Active-sessions / device-management feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/ActiveSessionsSection.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component reads the active-sessions list query (web `useSessions`, a discriminated union of
// `{ mode: 'open' }` and `{ mode: 'session'; sessions }`), the per-row user-agent → device label heuristic
// (web `describeDevice`), and the two revoke mutations (web `useRevokeSession` / `useRevokeAllOtherSessions`).
// This file owns exactly the data derivations: the open-mode vs forward-auth branch, the per-row projection
// (device label, IP fallback, formatted timestamps, current-device flag), the "has other devices" guard that
// drives the footer button (web `rows.some(r => !r.current)`), and the empty guard (web `emptyMessage`
// branch). Timestamp formatting and microcopy are render-boundary concerns, so the projection takes a
// `formatTimestamp` seam and carries no localized strings.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ActiveSessionsSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.activesessionssection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger

/** Em dash shown when a value is absent — the shared "no value" fallback (web `row.ip || '—'`). */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ActiveSessionsSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "active-sessions-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ActiveSessionsSection"
}

/**
 * The discriminated mode of the active-sessions list query — the vendor-neutral mirror of the web
 * `ActiveSessionsResponse` union tag. [Open] is the 501 AUTH_MODE_OPEN signal (forward-auth is not configured,
 * so per-device sessions cannot be tracked) and renders the advisory branch; [Session] carries the live list.
 */
enum class SessionMode {
    Open,
    Session,
}

/**
 * One active session — the native mirror of a web `ActiveSession` row. All fields are non-null primitives (the
 * backend always sends them); [userAgent] / [ip] may be blank and are handled at projection time. Timestamps
 * are raw ISO-8601 strings formatted at the render boundary, never in this pure layer.
 */
data class ActiveSession(
    val id: String,
    val userAgent: String,
    val ip: String,
    val createdAt: String,
    val lastSeenAt: String,
    val current: Boolean,
)

/**
 * The active-sessions payload the host's shared state holder (P1/S8) carries inside the `UiState` — the native
 * analogue of the web `useSessions` query value. [mode] discriminates the open-mode advisory from the
 * forward-auth list; [sessions] is empty for [SessionMode.Open].
 */
data class ActiveSessionsData(
    val mode: SessionMode,
    val sessions: List<ActiveSession> = emptyList(),
)

/**
 * A fully projected, render-ready session row — the native analogue of one web `DataTable` row. Pure data: the
 * composable renders the labels directly and resolves the per-row "Sign out" affordance from [isCurrent]
 * (current devices have no revoke action, web `row.current ? null : <Button/>`). [deviceLabel] is reused for
 * the row cell, the revoke aria-label, and the confirm-dialog message so all three agree.
 */
data class SessionRowProjection(
    val id: String,
    val deviceLabel: String,
    val isCurrent: Boolean,
    val ipLabel: String,
    val createdAtLabel: String,
    val lastSeenAtLabel: String,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component reads
 * from the `useSessions` result. [isOpenMode] selects the advisory branch (web `!data || mode === 'open'`),
 * [rows] is the projected forward-auth list, [hasOtherDevices] drives the "Sign out all other devices" footer
 * button (web `rows.some(r => !r.current)`), and [isEmpty] is the forward-auth empty guard (no rows).
 */
data class ActiveSessionsProjectionResult(
    val isOpenMode: Boolean,
    val rows: List<SessionRowProjection>,
    val hasOtherDevices: Boolean,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ActiveSessionsProjection {
    /**
     * Projects the list query [data] into render-ready inputs. A `null` payload or [SessionMode.Open] yields
     * the advisory branch (web `!sessions.data || sessions.data.mode === 'open'`); otherwise each session is
     * projected with its [describeDevice] label, IP fallback, and [formatTimestamp]-formatted stamps, and the
     * footer/empty guards are derived from the resulting rows.
     */
    fun project(
        data: ActiveSessionsData?,
        formatTimestamp: (String) -> String,
    ): ActiveSessionsProjectionResult {
        if (data == null || data.mode == SessionMode.Open) {
            return ActiveSessionsProjectionResult(
                isOpenMode = true,
                rows = emptyList(),
                hasOtherDevices = false,
                isEmpty = false,
            )
        }
        val rows =
            data.sessions.map { session ->
                SessionRowProjection(
                    id = session.id,
                    deviceLabel = describeDevice(session.userAgent),
                    isCurrent = session.current,
                    ipLabel = session.ip.ifBlank { EM_DASH },
                    createdAtLabel = formatTimestamp(session.createdAt),
                    lastSeenAtLabel = formatTimestamp(session.lastSeenAt),
                )
            }
        return ActiveSessionsProjectionResult(
            isOpenMode = false,
            rows = rows,
            hasOtherDevices = rows.any { !it.isCurrent },
            isEmpty = rows.isEmpty(),
        )
    }

    /**
     * Heuristic device label derived from the User-Agent — a dependency-free `match` ladder that is the exact
     * port of the web `describeDevice`. It covers the major browsers + OSes well enough to populate a
     * "Firefox on Windows" label and falls back to the raw markers on misses so the row stays identifiable.
     * The browser/OS tokens are universal product names (not localizable UI chrome) and are reproduced
     * verbatim from the web source for cross-surface parity.
     */
    fun describeDevice(userAgent: String): String {
        val ua = userAgent.trim()
        if (ua.isEmpty()) return "Unknown device"
        return "${browserToken(ua)} on ${osToken(ua)}"
    }
}

/** The browser arm of [ActiveSessionsProjection.describeDevice] (web `describeDevice` browser ladder). */
private fun browserToken(ua: String): String =
    when {
        Regex("Edg/").containsMatchIn(ua) -> "Edge"
        Regex("OPR/|Opera").containsMatchIn(ua) -> "Opera"
        Regex("Chrome/").containsMatchIn(ua) && !ua.contains("Chromium") -> "Chrome"
        ua.contains("Chromium") -> "Chromium"
        Regex("Firefox/").containsMatchIn(ua) -> "Firefox"
        Regex("Safari/").containsMatchIn(ua) && !Regex("Chrome/").containsMatchIn(ua) -> "Safari"
        else -> "Browser"
    }

/** The OS arm of [ActiveSessionsProjection.describeDevice] (web `describeDevice` OS ladder). */
private fun osToken(ua: String): String =
    when {
        ua.contains("Windows NT") -> "Windows"
        ua.contains("Mac OS X") || ua.contains("Macintosh") -> "macOS"
        ua.contains("Android") -> "Android"
        Regex("iPhone|iPad|iPod").containsMatchIn(ua) -> "iOS"
        ua.contains("Linux") -> "Linux"
        else -> "Unknown OS"
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ActiveSessionsSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. No session id, IP, or user-agent is ever attached.
 */
fun recordActiveSessionsSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ActiveSessionsSectionRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws four lucide icons (`Laptop`, `AlertTriangle`, `LogOut`, `ShieldAlert`). Android has
// no bundled lucide set, and feature views may not expand the shared icon library from a surface prompt
// (allowed-files), so the four are authored here as 24×24 stroked vectors in the shared monochrome style —
// recolored at render time by the `Icon` composable's tint, exactly as the sibling surfaces author their local
// glyphs.

/** The web forward-auth header `Laptop` (lucide) — a screen panel above a base bar. */
val LaptopGlyph: ImageVector =
    strokedGlyph("Laptop") {
        moveTo(4f, 5f)
        lineTo(20f, 5f)
        lineTo(20f, 16f)
        lineTo(4f, 16f)
        close()
        moveTo(2f, 19.5f)
        lineTo(22f, 19.5f)
    }

/** The web open-mode advisory `AlertTriangle` (lucide) — a triangle enclosing an exclamation. */
val AlertTriangleGlyph: ImageVector =
    strokedGlyph("AlertTriangle") {
        moveTo(12f, 3.5f)
        lineTo(22f, 20.5f)
        lineTo(2f, 20.5f)
        close()
        moveTo(12f, 9f)
        lineTo(12f, 13f)
        exclamationDot(12f, 16.5f)
    }

/** The web per-row `LogOut` (lucide) — a door bracket with an arrow leaving to the right. */
val LogOutGlyph: ImageVector =
    strokedGlyph("LogOut") {
        moveTo(9f, 4f)
        lineTo(4f, 4f)
        lineTo(4f, 20f)
        lineTo(9f, 20f)
        moveTo(21f, 12f)
        lineTo(9f, 12f)
        moveTo(17f, 8f)
        lineTo(21f, 12f)
        lineTo(17f, 16f)
    }

/** The web footer `ShieldAlert` (lucide) — a shield outline enclosing an exclamation. */
val ShieldAlertGlyph: ImageVector =
    strokedGlyph("ShieldAlert") {
        moveTo(12f, 3f)
        lineTo(20f, 6f)
        lineTo(20f, 11.5f)
        lineTo(12f, 21f)
        lineTo(4f, 11.5f)
        lineTo(4f, 6f)
        close()
        moveTo(12f, 8f)
        lineTo(12f, 12.5f)
        exclamationDot(12f, 15.5f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** A round-capped near-zero-length segment that renders as the exclamation dot at ([x], [y]). */
private fun PathBuilder.exclamationDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}
