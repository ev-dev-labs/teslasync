// Pure, framework-free model + projection + diagnostics for the DriveDetailHeader feature view — the native
// analogue of everything the web component derives from its props before returning JSX
// (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// DriveDetailHeader is a presentational header — the web component renders a back affordance, a title (a
// Route glyph + either the "startAddress → endAddress" route or the localized "Drive Details" fallback), a
// muted subtitle ("vehicleName · date · time TZ [→ endTime]" in the vehicle's local time), and a Replay +
// Share action pair. Its ONLY web hook is `useTranslation`; it binds NO data hook and performs NO fetch (the
// fully-loaded DriveDetail arrives as a prop from the owning page). As in the sibling QuickNav port (the other
// zero-data-source presentational surface), there is therefore no loading / error / stale / offline lifecycle
// to model — inventing those states would fabricate behaviour the web spec does not have (honesty covenant:
// no silent drift). What the surface genuinely varies, and what this pure file owns, is the web component's two
// real conditional branches:
//   • the title — the web `startAddress && endAddress ? "{start} → {end}" : t('driveDetail.title')` choice,
//     exposed as a nullable [DriveHeaderUiModel.routeTitle] (null ⇒ the composable resolves the i18n fallback);
//   • the subtitle — the web `vehicleName · <DateTime date> · <DateTime time showTz>` line plus the optional
//     `drive.endTs && (→ <DateTime time>)` tail, assembled here into one localized string.
//
// Timezone parity: the web renders each timestamp through `<DateTime in="vehicle">`, which resolves the car's
// IANA zone from a provider OUTSIDE this component's data sources. This surface keeps that separation — the
// owning page resolves the zone and hands it in; the projection formats in whatever [java.time.ZoneId] +
// [java.util.Locale] it is given (defaulting, at the Compose boundary, to the device zone/locale). Formatting
// uses the same localized java.time formatters the app's other timestamp surfaces use
// (ofLocalizedDate(MEDIUM) ≙ web `{year,month:short,day}`, ofLocalizedTime(SHORT) ≙ web `{hour,minute}`),
// and the em-dash fallback ("—") mirrors the web `@/lib/dateFormat` contract for nullish / unparseable input.
//
// i18n parity: the web `t('driveDetail.title' | 'driveDetail.replay' | 'driveDetail.share')` keys all exist in
// the generated catalog (P1/S10); they resolve at the Compose boundary (no English literal in native code).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveDetailHeader — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling QuickNav / KioskOverlay surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivedetailheader

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The raw header inputs — the native analogue of the web `DriveDetailHeaderProps` (the fields of the loaded
 * `DriveDetail` the header reads, plus `driveId` and `vehicleName`). Pure data so the projection is fully
 * covered by the off-device unit gate; every optional field is nullable and tolerated, exactly as the web
 * reads `drive.startAddress` / `drive.endAddress` / `drive.endTs` defensively.
 *
 * @property driveId the drive identifier (web `driveId`; carried so the Replay action can target the drive).
 * @property vehicleName the owning vehicle's display name (web `vehicleName`).
 * @property startAddress the reverse-geocoded start address, or null/blank when unknown (web `drive.startAddress`).
 * @property endAddress the reverse-geocoded end address, or null/blank when unknown (web `drive.endAddress`).
 * @property startTsIso the ISO-8601 drive start instant (web `drive.startTs`), or null.
 * @property endTsIso the ISO-8601 drive end instant (web `drive.endTs`), or null while the drive is live.
 */
data class DriveHeaderData(
    val driveId: String,
    val vehicleName: String,
    val startAddress: String?,
    val endAddress: String?,
    val startTsIso: String?,
    val endTsIso: String?,
)

/**
 * The fully projected, render-ready header — the native analogue of the values the web component computes
 * inline before returning JSX. Pure data (no Compose/Android types) so it is asserted directly in the unit
 * gate; the composable only resolves the i18n title fallback and paints these strings.
 *
 * @property routeTitle the "start → end" route when BOTH addresses are present, else null so the composable
 *   substitutes the localized `driveDetail.title` fallback (web `start && end ? … : t('driveDetail.title')`).
 * @property subtitle the assembled, localized subtitle line ("vehicleName · date · time TZ [→ endTime]"),
 *   already formatted in the requested zone/locale; blank only for fully-degenerate input.
 */
data class DriveHeaderUiModel(
    val routeTitle: String?,
    val subtitle: String,
) {
    /**
     * True when there is no meaningful header content to show (no route title AND a blank subtitle) — a
     * fully-degenerate drive. The composable still renders the back affordance, the localized fallback title,
     * and the action pair, so the surface is never a blank box; this flag just drives whether the (empty)
     * subtitle line is omitted rather than rendered as a dangling separator.
     */
    val isEmpty: Boolean get() = routeTitle == null && subtitle.isBlank()
}

/**
 * Pure projection from the raw [DriveHeaderData] to the render-ready [DriveHeaderUiModel] — the native port of
 * the web component's inline title/subtitle derivation. The [zone] and [locale] are injected (the owning page
 * resolves the vehicle zone, mirroring web `<DateTime in="vehicle">`), keeping formatting deterministic in
 * tests. All formatting tolerates null/blank/unparseable input by returning the em-dash fallback, matching the
 * web `@/lib/dateFormat` contract.
 */
object DriveDetailHeaderProjection {
    /** Universal em-dash fallback for nullish / unparseable timestamps (web `@/lib/dateFormat` FALLBACK). */
    const val FALLBACK: String = "—"

    /** Middot separator between subtitle segments (web `·`). */
    private const val SEPARATOR: String = " · "

    /** Arrow joining the route endpoints and the start→end times (web `→`). */
    private const val ARROW: String = " → "

    /**
     * Project [data] into the render-ready model, formatting every timestamp in [zone] using [locale].
     *
     * Title: the web `startAddress && endAddress` truthiness check — both must be present AND non-blank — or a
     * null route title so the composable falls back to `driveDetail.title`.
     *
     * Subtitle: the non-blank segments of `vehicleName`, the start date, and the start time (with its short
     * timezone abbreviation, web `showTz`) joined by the middot, then the optional `→ endTime` tail rendered
     * only when an end timestamp is present (web `drive.endTs && …`). An ABSENT start timestamp omits the
     * date/time segments entirely (a present-but-unparseable one still renders the em-dash fallback, matching
     * the web `formatDate`/`formatTime` contract) so a fully-degenerate drive yields a blank subtitle rather
     * than a dangling "— · —".
     */
    fun project(
        data: DriveHeaderData,
        zone: ZoneId,
        locale: Locale,
    ): DriveHeaderUiModel =
        DriveHeaderUiModel(
            routeTitle = routeTitle(data.startAddress, data.endAddress),
            subtitle = subtitle(data, zone, locale),
        )

    /** Web `start && end ? "{start} → {end}" : null`. Treats null OR blank as absent (web truthiness). */
    fun routeTitle(
        startAddress: String?,
        endAddress: String?,
    ): String? {
        val start = startAddress?.trim().orEmpty()
        val end = endAddress?.trim().orEmpty()
        return if (start.isNotEmpty() && end.isNotEmpty()) "$start$ARROW$end" else null
    }

    private fun subtitle(
        data: DriveHeaderData,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val head =
            buildList {
                val name = data.vehicleName.trim()
                if (name.isNotEmpty()) add(name)
                if (!data.startTsIso.isNullOrBlank()) {
                    add(formatDate(data.startTsIso, zone, locale))
                    val tz = timeZoneAbbrev(data.startTsIso, zone, locale)
                    val time = formatTime(data.startTsIso, zone, locale)
                    add(if (tz.isEmpty()) time else "$time $tz")
                }
            }.joinToString(SEPARATOR)
        val endTime = data.endTsIso?.takeIf { it.isNotBlank() }?.let { formatTime(it, zone, locale) }
        return when {
            endTime == null -> head
            head.isEmpty() -> endTime
            else -> "$head$ARROW$endTime"
        }
    }

    /** Web `formatDate` — localized date ("Apr 4, 2026" in en-US) in [zone], or the em-dash fallback. */
    fun formatDate(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String = format(iso, DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone))

    /** Web `formatTime` — localized, locale-aware 12/24h time ("2:30 PM" in en-US) in [zone], or the fallback. */
    fun formatTime(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String = format(iso, DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).withZone(zone))

    /** Web `tzAbbreviation` — the DST-aware short zone name ("PST"/"PDT") for [iso] in [zone], or empty. */
    fun timeZoneAbbrev(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String = format(iso, ZONE_FORMATTER.withLocale(locale).withZone(zone), onFailure = "")

    private fun format(
        iso: String?,
        formatter: DateTimeFormatter,
        onFailure: String = FALLBACK,
    ): String {
        val instant = parseInstant(iso) ?: return onFailure
        return runCatching { formatter.format(instant) }.getOrDefault(onFailure)
    }

    private fun parseInstant(iso: String?): Instant? {
        val raw = iso?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return runCatching { Instant.parse(raw) }.getOrNull()
    }

    /** Short timezone-name formatter (pattern `zzz` ⇒ "PST"/"PDT"), reused across calls. */
    private val ZONE_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("zzz", Locale.US)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any drive
 * data, address, vehicle name, or timestamp — so a diagnostics line can never leak anything about the user or
 * their vehicle.
 */
object DriveDetailHeaderDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "drive-detail-header"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveDetailHeader"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
