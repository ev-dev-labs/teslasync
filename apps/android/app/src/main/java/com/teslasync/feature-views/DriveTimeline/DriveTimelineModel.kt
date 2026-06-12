// Pure, framework-free model + projection for the DriveTimeline feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/DriveTimeline.tsx + its ./helpers formatDuration and
// @/lib/dateFormat formatTime). No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// DriveTimeline is a purely presentational surface — the web component takes its `drive` as a prop from the
// drive-detail page that owns the TanStack query, so this surface binds NO data hook of its own. Its only web
// hook is `useTranslation` (the i18n catalog, P1/S10); the times are rendered by `formatTime` against the
// browser locale/timezone, which maps to the injected [java.time.ZoneId] + [java.util.Locale] boundary here.
// As in the sibling DriveHighlightSlide / EventTimeline ports, the cache-then-network lifecycle (loading /
// error / stale / offline) lives on the OWNING page, not here; modelling those states would invent behaviour
// the spec does not have. The single branch the web source actually defines — a finished drive (an `end_ts`
// is present, so its formatted end time is shown) versus an in-progress drive (`end_ts` is absent, so the
// localized "In progress" copy is shown) — is the complete state set this surface renders, and it is
// projected here as [DriveTimelineDisplay.inProgress].
//
// Values stay SI on the wire ([DriveTimelineDrive.durationS] is seconds); the seconds -> minutes scaling the
// web performs inline (`drive.durationS / 60`) happens here, never by mutating the source — the Phase-48
// SI-canonical rule. The start/end timestamps are ISO-8601 UTC strings (the backend contract); converting
// them to the viewer's wall-clock time is the projection's job through the injected zone/locale.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveTimeline — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivetimeline

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** Em dash shown wherever a timestamp is absent or unparseable — the web `formatTime` invalid-date fallback. */
internal const val DRIVE_TIMELINE_EM_DASH: String = "\u2014"

/** Seconds per minute — the web scales the SI `duration_s` to minutes (`drive.durationS / 60`) before formatting. */
internal const val SECONDS_PER_MINUTE: Double = 60.0

/** Minutes per hour — the web `Math.floor(min / 60)` / `min % 60` split inside `formatDuration`. */
private const val MINUTES_PER_HOUR: Double = 60.0

/**
 * The minimal slice of a drive this surface needs — the native mirror of the `startTs` / `endTs` / `durationS`
 * fields the web `DriveTimeline` reads off its `DriveDetail` prop (web/src/types/driving.ts). Wire field names
 * keep their snake_case via @SerialName (the Go `Drive` JSON contract: `start_ts`, `end_ts`, `duration_s`) and
 * every field defaults so a partial payload decodes without error (a decoder configured with
 * `ignoreUnknownKeys` ignores the rest of the drive row). [startTs] / [endTs] are ISO-8601 UTC strings;
 * [endTs] is `null` while a drive is in progress (the same contract the backend `Drive.EndTs *time.Time`
 * carries). [durationS] is SI seconds; converting it to a display string is the projection's job.
 */
@Serializable
data class DriveTimelineDrive(
    @SerialName("start_ts") val startTs: String = "",
    @SerialName("end_ts") val endTs: String? = null,
    @SerialName("duration_s") val durationS: Long = 0,
)

/**
 * The fully projected, render-ready view of a drive — the native analogue of everything the web component
 * computes before returning JSX: the formatted start time, the `Hh Mm` / `Mm` duration string, whether the
 * drive is still in progress, and the formatted end time. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host.
 *
 * @property startTime the start timestamp rendered as the viewer's short wall-clock time, or an em dash when
 *   the source is blank/unparseable (web `formatTime(drive.startTs)`).
 * @property duration the `Hh Mm` (or `Mm` when under an hour) duration string (web
 *   `formatDuration(drive.durationS / 60)`).
 * @property inProgress `true` when the drive has no `end_ts` — the composable then shows the localized
 *   "In progress" copy instead of an end time (web `drive.endTs ? … : t('driveDetail.inProgress')`).
 * @property endTime the end timestamp rendered as the viewer's short wall-clock time (em dash when present but
 *   unparseable); an em dash when [inProgress] is `true`, in which case the composable ignores it.
 */
data class DriveTimelineDisplay(
    val startTime: String,
    val duration: String,
    val inProgress: Boolean,
    val endTime: String,
)

/**
 * Pure projection from a [DriveTimelineDrive] (+ the viewer's [ZoneId]/[Locale], the web `formatTime` browser
 * boundary) to its render-ready [DriveTimelineDisplay] — a 1:1 port of the derivations the web component
 * performs before returning JSX. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate.
 */
object DriveTimelineProjection {
    /**
     * Projects [drive] for the viewer's [zone]/[locale] into the render-ready [DriveTimelineDisplay]. Mirrors
     * the web verbatim: the start time formats through [formatClockTime]; the duration scales the SI seconds
     * to minutes (`duration_s / 60`) and formats through [formatDuration]; a missing/blank `end_ts` marks the
     * drive in progress (web truthiness of `drive.endTs`) and the end time otherwise formats through
     * [formatClockTime].
     */
    fun project(
        drive: DriveTimelineDrive,
        zone: ZoneId,
        locale: Locale,
    ): DriveTimelineDisplay {
        val inProgress = drive.endTs.isNullOrBlank()
        return DriveTimelineDisplay(
            startTime = formatClockTime(drive.startTs, zone, locale),
            duration = formatDuration(drive.durationS / SECONDS_PER_MINUTE),
            inProgress = inProgress,
            endTime = if (inProgress) DRIVE_TIMELINE_EM_DASH else formatClockTime(drive.endTs.orEmpty(), zone, locale),
        )
    }

    /**
     * The `Hh Mm` / `Mm` duration string the web builds from `Math.floor(min / 60)` and
     * `Math.round(min % 60)` (web `./helpers` `formatDuration`). The hours segment is dropped when the drive
     * is under an hour (web `h > 0 ? … : …`). Minutes are rounded half-up to match JavaScript `Math.round`
     * (Kotlin [roundToLong] rounds ties towards positive infinity); both segments render as integers so a
     * whole-minute count never gains a trailing `.0`, matching a JavaScript template literal.
     */
    fun formatDuration(minutes: Double): String {
        val hours = floor(minutes / MINUTES_PER_HOUR).toLong()
        val mins = (minutes % MINUTES_PER_HOUR).roundToLong()
        return if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
    }

    /**
     * Tolerant ISO-8601 -> localized short-time formatter — the native analogue of the web `formatTime`
     * (`toLocaleTimeString` with `{ hour: '2-digit', minute: '2-digit' }`). Pure (java.time only) so it is
     * unit-tested deterministically with a fixed [zone]/[locale]. A blank or unparseable [timestamp] yields
     * [DRIVE_TIMELINE_EM_DASH], like the web invalid-date guard (`if (isNaN(d.getTime())) return '—'`).
     */
    fun formatClockTime(
        timestamp: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(timestamp) ?: return DRIVE_TIMELINE_EM_DASH
        return DateTimeFormatter
            .ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the drive
 * times or duration — so a diagnostics line can never leak when a user drove.
 */
object DriveTimelineDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DriveTimeline"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
