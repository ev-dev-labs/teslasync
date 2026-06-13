// Pure, framework-free model + projection + time helpers + diagnostics for the TimeMachineBanner shared surface —
// the native analogue of every decision the web component makes (web/src/components/feedback/TimeMachineBanner.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The web component is the
// global "viewing data as of …" notice for the read-only point-in-time time-machine view. Its only data source is
// the `useAsOfDate` hook — a client-side holder over the canonical `?as_of=` URL query parameter (an RFC 3339
// instant, or null in live mode); it performs NO fetch of its own. Its render decisions are:
//   • live + picker closed  → `if (effective == null && !pickerOpen) return null` — nothing is shown;
//   • viewing (asOf set)     → an `info` AlertBanner: title "Viewing data as of {when}", body
//     "Read-only point-in-time mode.", a "Pick a date" toggle and a "Return to live" affordance;
//   • prompt (no asOf, picker opened from the command palette) → the same banner with a "pick a point in time"
//     prompt and no return-to-live (there is no live anchor to return from yet);
//   • picker open (either mode) → an inline date/time field, a "View as of date" submit disabled until a draft is
//     entered, and a "Cancel" affordance.
//
// HOW THE GENERIC DATA-SURFACE STATES MAP (honesty covenant: no scope narrowing, no silent drift). This surface
// fetches nothing — it reflects a client-held instant, exactly like the web hook reflects a URL parameter. There
// is therefore no query to be loading, to error, to go stale, or to be offline; inventing those states would be
// dishonest. They fold onto the surface's real, fully-reproduced states: the dormant/idle live state (the honest
// "empty" — renders nothing, contributing zero layout, never a blank box), the prompt state, the viewing state,
// and the picker-open state with its submit-disabled-until-drafted branch. The owning screen that DOES fetch the
// point-in-time data renders its own data surface; this banner only narrates which moment is in view. The same
// rationale is documented by the sibling AlertBanner / SignalCompareControls / OfflineBanner ports.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TimeMachineBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Canonical registry metadata for the TimeMachineBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`TimeMachineBanner`); [ID]
 * is the stable `viewModel` key the host binds the surface with.
 */
object TimeMachineBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "time-machine-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TimeMachineBanner"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The PII-free projection of the time-machine holder the surface renders — the native mirror of the web
 * `useAsOfDate` result. It carries only the current as-of instant ([asOf], an RFC 3339 string, or `null` in live
 * mode), never a vehicle id or any signal payload, so a diagnostics line or a re-share can never leak which
 * vehicle a user was inspecting.
 *
 * @property asOf the current point-in-time anchor (RFC 3339), or `null` when the SPA is in live mode.
 */
data class TimeMachineBannerSnapshot(
    val asOf: String?,
) {
    companion object {
        /** The live-mode snapshot: no point-in-time anchor set (web `asOf === null`). */
        fun live(): TimeMachineBannerSnapshot = TimeMachineBannerSnapshot(null)
    }
}

/**
 * The view-owned inputs to the banner, bundled so the pure [TimeMachineBannerProjection] reads a single argument
 * — the native mirror of the web component's `effective` / `pickerOpen` / `draft` locals.
 *
 * @property asOf the current point-in-time anchor (web `effective`), or `null` in live mode.
 * @property pickerOpen whether the inline date/time picker is expanded (web `pickerOpen`).
 * @property draftLocal the `datetime-local`-shaped draft the picker holds (web `draft`); blank ⇒ no draft yet.
 */
data class TimeMachineBannerInput(
    val asOf: String? = null,
    val pickerOpen: Boolean = false,
    val draftLocal: String? = null,
)

/**
 * The fully-resolved render decision the composable paints — the native mirror of the web component's render
 * guards. Pure, so the composable only resolves localized strings + tone from it and every branch is unit-tested
 * off-device.
 *
 * @property visible whether the banner renders at all — web `if (effective == null && !pickerOpen) return null`.
 * @property viewing whether a point-in-time anchor is set (web `effective != null`) — drives the title + body copy.
 * @property showReturnToLive whether the "Return to live" affordance is shown (web `{effective != null && …}`).
 * @property showPicker whether the inline date/time picker region is expanded (web `{pickerOpen && …}`).
 * @property submitEnabled whether the "View as of date" submit is enabled (web `disabled={!draft}`).
 */
data class TimeMachineBannerRender(
    val visible: Boolean,
    val viewing: Boolean,
    val showReturnToLive: Boolean,
    val showPicker: Boolean,
    val submitEnabled: Boolean,
)

/**
 * Pure projection of a [TimeMachineBannerInput] into the [TimeMachineBannerRender] — the native mirror of the web
 * component's render guards. Framework-free so the whole contract is covered by the JVM unit gate without a
 * Compose host.
 */
object TimeMachineBannerProjection {
    /** Folds the view-owned [input] into the render decision. */
    fun render(input: TimeMachineBannerInput): TimeMachineBannerRender {
        val viewing = input.asOf != null
        return TimeMachineBannerRender(
            visible = viewing || input.pickerOpen,
            viewing = viewing,
            showReturnToLive = viewing,
            showPicker = input.pickerOpen,
            submitEnabled = !input.draftLocal.isNullOrBlank(),
        )
    }
}

/**
 * The `datetime-local` ⇄ RFC 3339 helpers + display formatting — the native mirror of the web component's
 * `localInputToRfc3339`, the `useAsOfDate` `looksLikeIso` sniff, the command-palette open seed, and the
 * `formatDateTime` title rendering. The draft strings use the exact HTML `datetime-local` shape
 * (`yyyy-MM-ddTHH:mm`) so the picker contract matches the web component one-for-one, and the wire value is a UTC
 * RFC 3339 instant — the same string the backend `signal.ParseAsOf` consumes. Every function is deterministic
 * (the clock + zone + locale are injected, never read from a global), so the whole contract is unit-tested
 * off-device.
 */
object TimeMachineTime {
    private const val LOCAL_PATTERN = "yyyy-MM-dd'T'HH:mm"
    private val LOCAL_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(LOCAL_PATTERN, Locale.ROOT)

    /** Noon — the local hour the command-palette open seed lands on (web `d.setHours(12, 0, 0, 0)`). */
    private const val SEED_HOUR = 12

    /**
     * Strict RFC 3339 sniff — the native mirror of the web `useAsOfDate` `looksLikeIso` guard. A value must both
     * match the RFC 3339 shape (date, `T`, time, optional seconds/fraction, `Z` or numeric offset) AND parse to a
     * real instant, so a hand-edited but impossible date (e.g. `2024-02-31T00:00:00Z`) is rejected exactly as the
     * web `Date.parse` second-pass rejects it. The wire only ever receives values that pass this.
     */
    fun looksLikeIso(value: String): Boolean {
        if (!ISO_RFC3339_RE.matches(value)) return false
        return runCatching { OffsetDateTime.parse(value) }.isSuccess
    }

    /**
     * Converts a `datetime-local` [localValue] (interpreted in [zone]) into a UTC RFC 3339 instant string, or
     * `null` when blank/invalid — the native mirror of web `localInputToRfc3339` (`new Date(local).toISOString()`).
     */
    fun localInputToIso(
        localValue: String,
        zone: ZoneId,
    ): String? {
        val parsed = parseLocalDatetime(localValue) ?: return null
        return parsed.atZone(zone).toInstant().toString()
    }

    /**
     * Parses a `datetime-local` string back to a [LocalDateTime], or `null` when blank or malformed — used to
     * seed the date/time pickers from the current draft. Mirrors the web component reading `value={draft}`.
     */
    fun parseLocalDatetime(localValue: String): LocalDateTime? {
        if (localValue.isBlank()) return null
        return runCatching { LocalDateTime.parse(localValue, LOCAL_FORMAT) }.getOrNull()
    }

    /** Formats [epochMillis] (an absolute instant) as a `datetime-local` string in [zone]. */
    fun toLocalDatetimeInput(
        epochMillis: Long,
        zone: ZoneId,
    ): String =
        Instant
            .ofEpochMilli(epochMillis)
            .atZone(zone)
            .toLocalDateTime()
            .format(LOCAL_FORMAT)

    /** Formats an already-local [value] as a `datetime-local` string — the picker-confirm path. */
    fun toLocalDatetimeInput(value: LocalDateTime): String = value.format(LOCAL_FORMAT)

    /**
     * The `datetime-local` value the picker opens pre-filled with — the native mirror of the web command-palette
     * `onOpen` seed: the current [asOf] when one is set, otherwise yesterday at noon in [zone], a sensible default
     * that lands inside the supported lookback window. [nowMillis] + [zone] are injected so the math is
     * deterministic under test.
     */
    fun seedLocalInput(
        asOf: String?,
        nowMillis: Long,
        zone: ZoneId,
    ): String {
        val anchored = asOf?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() }
        val local =
            if (anchored != null) {
                anchored.atZone(zone).toLocalDateTime()
            } else {
                Instant
                    .ofEpochMilli(nowMillis)
                    .atZone(zone)
                    .toLocalDate()
                    .minusDays(1)
                    .atTime(SEED_HOUR, 0)
            }
        return local.format(LOCAL_FORMAT)
    }

    /**
     * The human-friendly field text for the current [localValue] draft: the parsed datetime rendered as
     * `yyyy-MM-dd HH:mm`, or [emptyLabel] when no draft is set — so the tap-to-pick field is never an empty box.
     */
    fun displayLabel(
        localValue: String,
        emptyLabel: String,
    ): String = parseLocalDatetime(localValue)?.format(DISPLAY_FORMAT) ?: emptyLabel

    /**
     * The localized "{when}" the title interpolates — the native mirror of the web `formatDateTime(effective)`.
     * Renders the RFC 3339 [iso] anchor in [zone] using a medium localized date-time for [locale]; falls back to
     * the raw [iso] (never blank) when the value cannot be parsed, so the title is always populated.
     */
    fun formatAsOfDisplay(
        iso: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull() ?: return iso
        return DISPLAY_LOCALIZED
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    private const val DISPLAY_PATTERN = "yyyy-MM-dd HH:mm"
    private val DISPLAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(DISPLAY_PATTERN, Locale.ROOT)
    private val DISPLAY_LOCALIZED: DateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)

    private val ISO_RFC3339_RE =
        Regex("""^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$""")
}

/**
 * Builds the merged accessibility announcement for the banner from its already-localized [title] + [body] (the
 * view resolves both through the i18n catalog). Kept pure so TalkBack-label presence is unit-tested without a
 * Compose host. Blank parts are skipped and the rest joined into one sentence.
 */
fun bannerAccessibilityLabel(
    title: String,
    body: String,
): String =
    listOf(title, body)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(separator = ". ")

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [TimeMachineBannerRegistration.SLUG]
 * (P1/S11) — never the as-of value nor a vehicle id, so a diagnostics line can never leak which historical moment
 * a user was viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it
 * once per surface open.
 */
fun recordTimeMachineBannerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TimeMachineBannerRegistration.SLUG))
}
