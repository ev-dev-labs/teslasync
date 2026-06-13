// Pure, framework-free model + projection + diagnostics for the EmptyStateThreshold shared surface — the
// native analogue of every decision the web component makes (web/src/components/feedback/EmptyStateThreshold.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device
// in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL primitive — the non-error empty state for a section that becomes useful only at
//     scale (e.g. a cost heatmap that needs ≥ 30 charging sessions). The parent owns the counts and the
//     localized section copy; the component's only hook is useTranslation. So there is no data port to bind
//     (no P1/S8 state holder, no Source/ViewModel); modelling one would invent a fetch the web spec does not
//     have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational ports
//     ScoreBadge / FreshnessIndicator / Distance document the same rationale (composable + model, no Source).
//   • The component renders a "healthy" green check (the section is fine, just waiting for more data), the
//     caller's section label, a muted info hint, an optional description, the count message, and an optional
//     call-to-action. Per the web spec it NEVER hides the section — operators must see it exists and know
//     what unlocks it — so this port always renders too (there is no nullable / collapsed branch).
//   • Noun resolution (web `itemNoun ?? t('emptyState.threshold.defaultItem', 'items')`): a caller-supplied
//     noun wins; otherwise the localized default "items" is used. Native mirror: [EmptyStateThresholdNoun].
//   • Message resolution (web `message ?? defaultMessage`): a caller-supplied override wins; otherwise the
//     localized default "Need at least {{threshold}} {{noun}} to show meaningful patterns. You have
//     {{current}} so far." is composed from the counts + resolved noun. Native mirror:
//     [EmptyStateThresholdMessage] — the [EmptyStateThresholdMessage.Default] branch carries the raw
//     threshold + current counts so the Compose layer can interpolate them (with the resolved noun) through
//     the P1/S10 catalog string, exactly as the web `t(key, '…', { threshold, noun, current })` call does.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is the empty state itself, handed counts the parent already holds. Its real,
// fully reproduced branches are the noun (custom / default), the message (custom / default), the optional
// description (present / absent), and the optional action (present / absent); each is reduced here and
// asserted in the off-device test.
//
// SI boundary (unit-conversion instructions, Phase-48): the inputs are unitless counts (how many sessions /
// drives / trips the user has versus the threshold), so — like the web component — this projection performs
// no display-unit conversion and the surface needs no live formatter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/EmptyStateThreshold — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ScoreBadge / FreshnessIndicator
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.emptystatethreshold

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The noun woven into the default count message — the native mirror of the web `itemNoun ?? t(defaultItem)`
 * resolution. The Compose layer turns this into the visible word: [Custom] uses the value verbatim, [Default]
 * resolves the localized `emptyState.threshold.defaultItem` ("items") through the P1/S10 catalog so no
 * English literal lives in the view.
 */
sealed interface EmptyStateThresholdNoun {
    /** Web `itemNoun` was supplied — use it verbatim (e.g. "sessions", "drives", "trips"). */
    data class Custom(
        val value: String,
    ) : EmptyStateThresholdNoun

    /** Web `itemNoun` was omitted — fall back to the localized default noun ("items"). */
    data object Default : EmptyStateThresholdNoun
}

/**
 * Which message the surface shows — the native mirror of the web `message ?? defaultMessage` choice.
 * [Custom] is a caller-supplied override shown verbatim; [Default] carries the raw [threshold] + [current]
 * counts so the Compose layer can interpolate them (with the resolved [EmptyStateThresholdNoun]) into the
 * localized `emptyState.threshold.message` template, exactly as the web `t(key, '…', { threshold, noun,
 * current })` call does.
 */
sealed interface EmptyStateThresholdMessage {
    /** Web `message` override was supplied — show it verbatim (the default copy is not composed). */
    data class Custom(
        val value: String,
    ) : EmptyStateThresholdMessage

    /**
     * Web `message` was omitted — compose the localized default from these counts and the resolved noun.
     *
     * @property threshold the minimum count the section needs (web `threshold`).
     * @property current how many items the user has so far (web `currentCount`).
     */
    data class Default(
        val threshold: Int,
        val current: Int,
    ) : EmptyStateThresholdMessage
}

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs, derived purely
 * so every branch is covered off-device. The view resolves the localized noun + message strings, paints the
 * green check, the [sectionLabel], the muted info hint, the optional [description], the message, and the
 * optional action.
 *
 * @property sectionLabel the gated section's title (web `sectionLabel`), caller-supplied + already localized.
 * @property description the optional one-line subtitle under the title (web `description`); `null` when absent.
 * @property noun the resolved noun source for the default message (web `itemNoun ?? t(defaultItem)`).
 * @property message the resolved message source (web `message ?? defaultMessage`).
 */
data class EmptyStateThresholdProjection(
    val sectionLabel: String,
    val description: String?,
    val noun: EmptyStateThresholdNoun,
    val message: EmptyStateThresholdMessage,
)

/**
 * The caller-supplied parameters bundled for [projectEmptyStateThreshold] — a 1:1 mirror of the web component
 * props. Bundling keeps the pure projection a single-argument function (the sibling MetricCard surface uses the
 * same `…Input` pattern) and lets a caller forward a whole spec without positional drift.
 *
 * @property currentCount how many items the user currently has (web `currentCount`).
 * @property threshold the minimum items the section needs to become useful (web `threshold`).
 * @property sectionLabel the gated section's title (web `sectionLabel`).
 * @property itemNoun optional short noun for the items (web `itemNoun`); `null` → the localized "items".
 * @property description optional one-line subtitle under the title (web `description`).
 * @property message optional override for the auto-composed message (web `message`).
 */
data class EmptyStateThresholdInput(
    val currentCount: Int,
    val threshold: Int,
    val sectionLabel: String,
    val itemNoun: String? = null,
    val description: String? = null,
    val message: String? = null,
)

/**
 * Reduce the caller's [input] into the render-ready [EmptyStateThresholdProjection] — the native mirror of the
 * web component's prop handling. Pure (no Compose): the noun and message are resolved to `Custom` when the
 * caller supplied one (web nullish-coalescing `??`, so only a `null` triggers the default), otherwise to the
 * [EmptyStateThresholdNoun.Default] / [EmptyStateThresholdMessage.Default] branch the view localizes.
 */
fun projectEmptyStateThreshold(input: EmptyStateThresholdInput): EmptyStateThresholdProjection {
    val noun =
        if (input.itemNoun != null) {
            EmptyStateThresholdNoun.Custom(input.itemNoun)
        } else {
            EmptyStateThresholdNoun.Default
        }
    val resolvedMessage =
        if (input.message != null) {
            EmptyStateThresholdMessage.Custom(input.message)
        } else {
            EmptyStateThresholdMessage.Default(threshold = input.threshold, current = input.currentCount)
        }
    return EmptyStateThresholdProjection(
        sectionLabel = input.sectionLabel,
        description = input.description,
        noun = noun,
        message = resolvedMessage,
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the counts,
 * the noun, or the section label — so a diagnostics line can never leak how much data a vehicle has produced
 * or which section the operator is looking at.
 */
object EmptyStateThresholdDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "EmptyStateThreshold"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
