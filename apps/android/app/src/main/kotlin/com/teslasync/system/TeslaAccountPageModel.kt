// Pure, framework-free metadata + domain model for the TeslaAccountPage system surface — the native analogue of
// the cross-cutting concerns + derivations the web page owns
// (web/src/features/system/pages/TeslaAccountPage.tsx, the Tesla-account profile screen mounted at
// /tesla-account). No Compose, no Android framework, no HTTP lives here, so the route identity, the
// envelope→view projection, the empty guard, and BOTH date faces (the relative "Last synced …" age the sync bar
// shows, web `formatRelative`; the absolute "Fetched At" stamp the detail list shows, web `formatDateTime`) are
// all exercised off-device and the composable stays a thin render layer.
//
// The web page reads `useTeslaUserProfile()` — the `{ profile, fetched_at }` envelope — and renders, when a
// profile is present, an avatar + a Name/Email/Fetched-At list; otherwise an empty state. The relative sync age
// buckets exactly as web `formatRelative`: under a minute → just-now; under an hour → minutes; under a day →
// hours; under a week → days; otherwise the absolute medium date. The buckets are carried structurally so the
// render boundary resolves each from the i18n catalog (the `freshness.*` phrases) — no English microcopy here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling system page
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.teslaaccount

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an unknown/blank value — the web `'—'` / invalid-date fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for the TeslaAccountPage surface. The web page is a top-level system route, so this object
 * carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires
 * (already a metadata-only destination at Destinations.kt `page("teslaAccount", "/tesla-account",
 * NavGroup.System)`) and the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11). There is
 * no page-size / feed metadata because the page renders a single profile feed it derives inline.
 */
object TeslaAccountPageRegistration {
    /** The navigation destination id (Destinations.kt `page("teslaAccount", "/tesla-account", NavGroup.System)`). */
    const val ROUTE_ID: String = "teslaAccount"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/tesla-account"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TeslaAccountPage"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no account data. */
internal fun recordTeslaAccountPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TeslaAccountPageRegistration.SLUG))
}

/**
 * One fully projected, render-ready profile document — the native analogue of the avatar + Name/Email/Fetched-At
 * detail list the web page renders inside its `profile ?` branch. Pure data (no Compose types): the composable
 * lays out the rows. The text fields already fall back to [EM_DASH] for a blank value (web `full_name || '—'` /
 * `email || '—'`); [fetchedAtIso] keeps the raw ISO stamp so the render boundary formats it with the device
 * zone/locale (web `formatDateTime(profile.fetched_at)`). [imageUrl] is the optional avatar source (web
 * `profile.profile_image_url`); `null`/blank selects the no-image frame.
 *
 * @property fullName the account name, blank-guarded to [EM_DASH] (web `full_name || '—'`).
 * @property email the account email, blank-guarded to [EM_DASH] (web `email || '—'`).
 * @property imageUrl the profile-image URL, `null` when blank (web `profile_image_url` truthiness).
 * @property fetchedAtIso the raw profile `fetched_at` ISO stamp, formatted absolute at the render boundary.
 */
data class TeslaProfileView(
    val fullName: String,
    val email: String,
    val imageUrl: String?,
    val fetchedAtIso: String,
)

/**
 * The structured result of the relative sync formatter — the native port of the buckets web `formatRelative`
 * collapses to: under a minute → [JustNow]; under an hour → [Minutes]; under a day → [Hours]; under a week →
 * [Days]; otherwise the absolute medium date ([AbsoluteDate], web's `formatDate` fallback). The count is carried
 * so the render boundary selects the localized catalog phrase (`freshness.*`); the absolute tail is already a
 * locale-formatted date string, not microcopy.
 */
sealed interface SyncedAge {
    /** Under one minute old — web `'just now'`. */
    data object JustNow : SyncedAge

    /** [count] whole minutes old — web `${minutes}m ago`. */
    data class Minutes(val count: Int) : SyncedAge

    /** [count] whole hours old — web `${hours}h ago`. */
    data class Hours(val count: Int) : SyncedAge

    /** [count] whole days old (still under a week) — web `${days}d ago`. */
    data class Days(val count: Int) : SyncedAge

    /** A week old or more — the pre-formatted absolute medium date (web `formatRelative`'s `formatDate` tail). */
    data class AbsoluteDate(val value: String) : SyncedAge
}

private const val MILLIS_PER_SECOND: Long = 1_000L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
private const val DAYS_PER_WEEK: Long = 7L

/**
 * The pure projection the composable renders — the native mirror of the web page's data derivations. Stateless
 * and side-effect-free (the [ZoneId]/[Locale]/`nowMillis` are injected) so it is fully covered by the off-device
 * unit gate.
 */
object TeslaAccountProjection {
    /**
     * Whether the envelope resolves to "no profile yet" — the web empty-state guard, which falls back whenever
     * `data?.profile` is null (the account has not been linked / fetched). A `null` envelope is also empty.
     */
    fun isEmpty(envelope: TeslaProfileEnvelope?): Boolean = envelope?.profile == null

    /** Whether the envelope has ever been synced (web `data?.fetched_at` truthiness — drives the sync-bar copy). */
    fun hasSynced(envelope: TeslaProfileEnvelope?): Boolean = !envelope?.fetchedAt.isNullOrBlank()

    /**
     * Projects [envelope] into the render-ready [TeslaProfileView], or `null` when there is no profile (the web
     * `profile ?` guard is false) — in which case the surface renders its empty state. Text fields fall back to
     * [EM_DASH] for a blank value (web `|| '—'`); the image URL collapses to `null` when blank.
     */
    fun profileView(envelope: TeslaProfileEnvelope?): TeslaProfileView? {
        val profile = envelope?.profile ?: return null
        return TeslaProfileView(
            fullName = profile.fullName.ifBlank { EM_DASH },
            email = profile.email.ifBlank { EM_DASH },
            imageUrl = profile.profileImageUrl?.takeIf { it.isNotBlank() },
            fetchedAtIso = profile.fetchedAt,
        )
    }

    /**
     * Localized "medium date, short time" formatter for the detail-list "Fetched At" stamp — the native analogue
     * of the web `formatDateTime`. A blank or unparseable input yields [EM_DASH].
     */
    fun formatFetchedAt(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(iso) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /**
     * Buckets the age of [iso] against [nowMillis] for the sync-bar "Last synced …" copy — the native port of
     * web `formatRelative`: under a minute → [SyncedAge.JustNow]; under an hour → [SyncedAge.Minutes]; under a
     * day → [SyncedAge.Hours]; under a week → [SyncedAge.Days]; otherwise the absolute medium date
     * ([SyncedAge.AbsoluteDate], web's `formatDate` fallback). A blank/unparseable [iso] yields `null` (the web
     * `'—'` guard); a future instant (negative age) buckets to [SyncedAge.JustNow], matching the web
     * `seconds < 60` branch. Each step floors like the web's chained `Math.floor`.
     */
    fun relativeSynced(
        iso: String?,
        nowMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): SyncedAge? {
        val instant = parseInstant(iso) ?: return null
        val diffMillis = nowMillis - instant.toEpochMilli()
        val seconds = Math.floorDiv(diffMillis, MILLIS_PER_SECOND)
        val minutes = Math.floorDiv(seconds, SECONDS_PER_MINUTE)
        val hours = Math.floorDiv(minutes, MINUTES_PER_HOUR)
        val days = Math.floorDiv(hours, HOURS_PER_DAY)
        return when {
            seconds < SECONDS_PER_MINUTE -> SyncedAge.JustNow
            minutes < MINUTES_PER_HOUR -> SyncedAge.Minutes(minutes.toInt())
            hours < HOURS_PER_DAY -> SyncedAge.Hours(hours.toInt())
            days < DAYS_PER_WEEK -> SyncedAge.Days(days.toInt())
            else -> SyncedAge.AbsoluteDate(formatDate(instant, zone, locale))
        }
    }

    /** Date only (web `formatDate`: medium date, e.g. "Apr 4, 2026") — the relative over-a-week tail. */
    private fun formatDate(
        instant: Instant,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val instantParsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String?): Instant? =
        if (raw.isNullOrBlank()) null else instantParsers.firstNotNullOfOrNull { it(raw) }

    private fun <T> tryParse(block: () -> T): T? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}
