// Pure, framework-free model + projection for the SessionList feature view — the native analogue of everything
// the web component derives before returning JSX (web/src/features/system/components/chatbot/SessionList.tsx).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — the hosting Chat page loads the sessions feed (the shared
// ChatStore, P1/S8) and wires the select / new-chat / rename / delete actions through callbacks. This file owns
// exactly the parts the web component computes from its props: the visible title (web `displayTitle`: explicit
// title → first user message truncated to 60 chars → "Untitled"), the tolerant parse of `last_message_at`, and
// the relative-age bucketing the web `formatRelative` renders (<60s "just now", <60m minutes, <24h hours, <7d
// days, else an absolute date). None of the fields are unit-bearing, so there is no SI conversion at this layer
// (S5); display formatting is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionList — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessionlist

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown when `last_message_at` is present but unparseable — the web `formatRelative` "—" fallback. */
internal const val EM_DASH: String = "\u2014"

/** Ellipsis appended to a first-message-derived title that exceeds [TITLE_MAX_CHARS] — the web `…`. */
internal const val ELLIPSIS: String = "\u2026"

/** Max characters of a first-message-derived title before it is ellipsized — the web `slice(0, 60)`. */
internal const val TITLE_MAX_CHARS: Int = 60

/** Diagnostics surface identity for the SessionList surface (P1/S11). */
object SessionListDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SessionList"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG] — never a session id,
     * title, message, or count — so a diagnostics line can never leak the user's conversations. Kept free of
     * Compose so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition
     * effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info("view.opened", mapOf("surface" to SLUG))
    }
}

/**
 * Coarse, i18n-friendly bucket for the age of a session's last message — the native mirror of the web
 * `formatRelative` cutoffs. The composable maps each bucket to a localized string (the shared `freshness.*`
 * catalog) so this pure logic carries no English microcopy. [Absolute] falls through to a localized absolute
 * date at the render boundary, exactly as the web helper falls back to `formatDate` past one week.
 */
sealed interface SessionRelativeAge {
    /** Younger than one minute — the web `seconds < 60` "just now". */
    data object JustNow : SessionRelativeAge

    /** Whole minutes old (1–59) — the web `${minutes}m ago`. */
    data class Minutes(
        val value: Long,
    ) : SessionRelativeAge

    /** Whole hours old (1–23) — the web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : SessionRelativeAge

    /** Whole days old (1–6) — the web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : SessionRelativeAge

    /** Seven days or older — rendered as an absolute date, the web `formatDate` fallback. */
    data class Absolute(
        val instant: Instant,
    ) : SessionRelativeAge
}

/**
 * One fully projected, render-ready session row — the native analogue of everything the web component reads off
 * a `ChatSessionInfo`. Pure data (no Compose types): the composable resolves [title] (falling back to the
 * localized "Untitled" label when null), renders the relative age of [lastMessageAt] via
 * [SessionListProjection.relativeAge], and folds in the message count.
 *
 * @property id the session id — the row key and the argument threaded back through the action callbacks.
 * @property title the visible title (explicit title or truncated first message), or `null` when neither exists
 *   (the render boundary then shows the localized "Untitled conversation").
 * @property hasLastMessageAt whether `last_message_at` was present on the wire — web `Boolean(last_message_at)`;
 *   `false` renders the localized "Empty" label.
 * @property lastMessageAt the parsed `last_message_at`, or `null` when missing/unparseable.
 * @property messageCount the number of messages in the session — the web `{{count}} msgs` plural argument.
 */
data class SessionRowData(
    val id: String,
    val title: String?,
    val hasLastMessageAt: Boolean,
    val lastMessageAt: Instant?,
    val messageCount: Int,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SessionListProjection {
    private val ABSOLUTE_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy")

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    /**
     * Resolves the visible title for a session — the exact derivation of the web `displayTitle`: an explicit
     * (trimmed, non-blank) [ChatSessionInfo.title] wins; else the (trimmed, non-blank) first user message,
     * truncated to [TITLE_MAX_CHARS] with an [ELLIPSIS]; else `null`, signalling the render boundary to show the
     * localized "Untitled conversation".
     */
    fun resolveTitle(session: ChatSessionInfo): String? {
        val title = session.title?.trim()
        val first = session.firstMessage?.trim()
        return when {
            !title.isNullOrEmpty() -> title
            first.isNullOrEmpty() -> null
            first.length > TITLE_MAX_CHARS -> first.take(TITLE_MAX_CHARS) + ELLIPSIS
            else -> first
        }
    }

    /** Projects a [session] into a render-ready [SessionRowData], mirroring the web component's derivations 1:1. */
    fun project(session: ChatSessionInfo): SessionRowData {
        val raw = session.lastMessageAt
        return SessionRowData(
            id = session.id,
            title = resolveTitle(session),
            hasLastMessageAt = !raw.isNullOrBlank(),
            lastMessageAt = parseTimestamp(raw),
            messageCount = session.messageCount,
        )
    }

    /**
     * Parses a `last_message_at` string into an [Instant], tolerating an RFC-3339 instant, an offset date-time,
     * or a zoneless local date-time (treated as UTC). Returns `null` for a blank/unparseable value.
     */
    fun parseTimestamp(raw: String?): Instant? = if (raw.isNullOrBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    /**
     * Buckets the age of [instant] relative to [nowMillis] into a [SessionRelativeAge], mirroring the web
     * `formatRelative` cutoffs exactly: <60s "just now", <60m minutes, <24h hours, <7d days, else an absolute
     * date. A future or `null` [instant] is treated as age zero / absent — `null` is returned only when
     * [instant] is `null` so the caller can fall back to the em-dash.
     */
    fun relativeAge(
        instant: Instant?,
        nowMillis: Long,
    ): SessionRelativeAge? {
        if (instant == null) return null
        val deltaMs = nowMillis - instant.toEpochMilli()
        val seconds = if (deltaMs <= 0L) 0L else deltaMs / MILLIS_PER_SECOND
        return when {
            seconds < SECONDS_PER_MINUTE -> SessionRelativeAge.JustNow
            seconds < SECONDS_PER_HOUR -> SessionRelativeAge.Minutes(seconds / SECONDS_PER_MINUTE)
            seconds < SECONDS_PER_DAY -> SessionRelativeAge.Hours(seconds / SECONDS_PER_HOUR)
            seconds < SECONDS_PER_WEEK -> SessionRelativeAge.Days(seconds / SECONDS_PER_DAY)
            else -> SessionRelativeAge.Absolute(instant)
        }
    }

    /**
     * Formats a one-week-or-older [instant] as a localized absolute date in [zone] — the web `formatDate`
     * fallback ("Apr 4, 2026").
     */
    fun formatAbsolute(
        instant: Instant,
        zone: ZoneId,
        locale: Locale,
    ): String = ABSOLUTE_FORMAT.withLocale(locale).withZone(zone).format(instant)

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    private const val MILLIS_PER_SECOND: Long = 1_000L
    private const val SECONDS_PER_MINUTE: Long = 60L
    private const val SECONDS_PER_HOUR: Long = 3_600L
    private const val SECONDS_PER_DAY: Long = 86_400L
    private const val SECONDS_PER_WEEK: Long = 604_800L
}
