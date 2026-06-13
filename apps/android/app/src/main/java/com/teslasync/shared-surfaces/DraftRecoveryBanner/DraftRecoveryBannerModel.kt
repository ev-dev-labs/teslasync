// Pure, framework-free model + relative-age reducer + surface classifier for the DraftRecoveryBanner shared
// surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/DraftRecoveryBanner.tsx) before it paints its banner. No Compose, no Android
// UI, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL banner shown at the top of an editor that was hydrated from `useFormDraft`. The
//     parent owns the data (whether a draft was restored + when it was persisted) and supplies the callbacks
//     ("Use draft" / "Discard draft"); the banner's only hook is `useTranslation`. So there is no data port to
//     bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a fetch the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). The closest sibling precedents are the
//     equally presentational AiLimitBanner and RouteAnnouncer surfaces (composable + model, no Source/ViewModel).
//   • `!hasDraft || dismissed` → the web returns `null` (renders nothing). Native mirror: [DraftBannerSurface.Hidden].
//   • Otherwise the banner is shown. Its copy is chosen from `itemNoun`
//     (`itemNoun` truthy → "{noun} draft restored from {when}." / else → "Draft restored from {when}."), and the
//     `{when}` phrase is the relative age of `draftSavedAt` (web `formatRelativeTime`), or "a moment ago" when no
//     timestamp is known. Both buttons dismiss the banner; "Discard draft" additionally calls the parent. All of
//     that is reduced here in [classify] + [relativeDraftAge].
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it IS the inline acknowledgement that the editor already restored the operator's
// unsaved work. Its real, fully reproduced states are the Hidden surface and the Visible surface's branches
// (noun vs no-noun × the relative-age bucket the timestamp falls in), each reduced here and asserted in the
// off-device test. The relative-age buckets mirror the web `dateFormat.formatRelativeTime` thresholds exactly so
// the rendered phrase matches the rest of the app.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DraftRecoveryBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AiLimitBanner / RouteAnnouncer surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrecoverybanner

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no draft contents, noun, or
 * timestamp, so a diagnostics line can never leak what the operator was editing or when.
 */
const val DRAFT_RECOVERY_BANNER_SLUG: String = "DraftRecoveryBanner"

/**
 * The relative age of the restored draft — the native mirror of the buckets web `dateFormat.formatRelativeTime`
 * collapses to. Carried as a structured value so the view localizes it through the i18n catalog (P1/S10) rather
 * than baking English into the model.
 */
sealed interface DraftAge {
    /** No timestamp was known (web `draftSavedAt == null`) — the view shows `draft.unknownTime` ("a moment ago"). */
    data object Unknown : DraftAge

    /** Under one minute old — web `'Just now'`. */
    data object JustNow : DraftAge

    /** [count] whole minutes old — web `${diffMin}m ago`. */
    data class Minutes(
        val count: Int,
    ) : DraftAge

    /** [count] whole hours old — web `${diffHrs}h ago`. */
    data class Hours(
        val count: Int,
    ) : DraftAge

    /** Over a day old — the pre-formatted absolute short date + time (web's `toLocaleDateString` fallback). */
    data class Absolute(
        val value: String,
    ) : DraftAge
}

/**
 * The render-ready classification of the banner — a closed set of mutually-exclusive surfaces the view switches
 * on, so every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface DraftBannerSurface {
    /** `!hasDraft || dismissed` → the banner renders nothing (web returns `null`). */
    data object Hidden : DraftBannerSurface

    /**
     * The banner is shown. Carries everything the render layer needs: the optional already-localized [noun] the
     * caller chose (web `itemNoun`; `null` selects the noun-free copy) and the relative [age] of the draft.
     */
    data class Visible(
        val noun: String?,
        val age: DraftAge,
    ) : DraftBannerSurface
}

private const val MINUTE_MILLIS: Long = 60_000L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L

/**
 * Buckets the age of [savedAtMillis] against [nowMillis] — the native port of web `formatRelativeTime`: a null
 * timestamp → [DraftAge.Unknown]; under a minute → [DraftAge.JustNow]; under an hour → [DraftAge.Minutes]; under
 * a day → [DraftAge.Hours]; otherwise the absolute short date + time ([DraftAge.Absolute]). A future timestamp
 * (negative age) buckets to [DraftAge.JustNow], matching the web `diffMin < 1` branch. [zone] / [locale] anchor
 * the absolute fallback and default to the device settings; they are threaded so this stays deterministic under
 * test.
 */
fun relativeDraftAge(
    savedAtMillis: Long?,
    nowMillis: Long,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
): DraftAge {
    if (savedAtMillis == null) return DraftAge.Unknown
    val diffMinutes = Math.floorDiv(nowMillis - savedAtMillis, MINUTE_MILLIS)
    val diffHours = diffMinutes / MINUTES_PER_HOUR
    return when {
        diffMinutes < 1 -> DraftAge.JustNow
        diffMinutes < MINUTES_PER_HOUR -> DraftAge.Minutes(diffMinutes.toInt())
        diffHours < HOURS_PER_DAY -> DraftAge.Hours(diffHours.toInt())
        else -> DraftAge.Absolute(formatAbsolute(savedAtMillis, zone, locale))
    }
}

/**
 * The absolute short date + time fallback (web `toLocaleDateString` with `month: 'short', day: 'numeric', hour /
 * minute`): "MMM d" joined with the locale's short time, e.g. "Jun 5, 2:30 PM". Matches the sibling DateTime
 * surface's absolute formatting so the phrase reads identically across the app.
 */
private fun formatAbsolute(
    epochMillis: Long,
    zone: ZoneId,
    locale: Locale,
): String {
    val zoned = Instant.ofEpochMilli(epochMillis).atZone(zone)
    val date = DateTimeFormatter.ofPattern("MMM d", locale).format(zoned)
    val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(zoned)
    return "$date, $time"
}

/**
 * Select the render-ready [DraftBannerSurface] for the current inputs. Pure (no Compose/clock): the composable
 * supplies whether a draft is present, whether either action dismissed the banner, the persisted timestamp, the
 * current time, and the caller's optional noun. `!hasDraft || dismissed` collapses to [DraftBannerSurface.Hidden]
 * (web `null`); otherwise the noun (an empty/blank string is treated as absent, mirroring the web truthiness of
 * `itemNoun ? …`) and the relative age are reduced into [DraftBannerSurface.Visible].
 */
fun classify(
    hasDraft: Boolean,
    dismissed: Boolean,
    savedAtMillis: Long?,
    nowMillis: Long,
    itemNoun: String?,
): DraftBannerSurface {
    if (!hasDraft || dismissed) return DraftBannerSurface.Hidden
    return DraftBannerSurface.Visible(
        noun = itemNoun.takeUnless { it.isNullOrEmpty() },
        age = relativeDraftAge(savedAtMillis, nowMillis),
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the noun, the
 * draft contents, or the persisted timestamp — so a diagnostics line can never leak what the operator was
 * editing.
 */
object DraftRecoveryBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = DRAFT_RECOVERY_BANNER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
