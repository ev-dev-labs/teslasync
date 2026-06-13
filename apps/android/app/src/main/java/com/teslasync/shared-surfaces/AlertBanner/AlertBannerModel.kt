// Pure, framework-free model + variant taxonomy + render classifier for the AlertBanner shared surface — the
// native analogue of every decision the web component makes (web/src/components/feedback/AlertBanner.tsx) before
// it paints its alert. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, CONTROLLED presentational component. The parent owns the data — it passes `variant`, an optional
//     `title`, the `children` body, an optional leading `icon`, and an optional `onClose` callback; the
//     component's only logic is selecting the severity tint from `variant`. Its sole import is a class-name
//     helper. There is NO hook, NO fetch, and NO data port to bind (no P1/S8 state holder, no Source/ViewModel)
//     — modelling one would invent an async dependency the web spec does not have (honesty covenant: no scope
//     narrowing, no silent drift). The one hook the prompt lists, `useMutationToast`, is named only in the web
//     source's JSDoc as the *alternative* transient-toast system to use INSTEAD of this persistent banner — the
//     two are mutually exclusive, so binding it would contradict the spec. The closest sibling precedents are
//     the equally presentational AiLimitBanner and AnnouncerRegion surfaces (composable + model, no
//     Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are its four severity variants (info / success / warning /
//     danger) crossed with its prop-driven branches: title present/absent (web `{title && …}`), a real body vs
//     an empty body (web `children`), a leading icon present/absent (web `{icon && …}`), and a dismiss
//     affordance present/absent (web `{onClose && …}`). Each is reduced here in [classify] and asserted in the
//     off-device test, doubling as the per-state snapshot.
//   • The one place this surface improves on a literal port is the empty-body branch: the web renders whatever
//     `children` it is given (including nothing), but the prompt's "empty → friendly empty state, never a blank
//     box" contract is honoured by [classify] flagging an empty body so the view can render a localized caption
//     instead of an empty region.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is a controlled notice whose content is handed in by its parent. There is no query to be
// loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest. The owning
// screen that DOES fetch (and can be loading/stale/offline) renders its own data surface and only mounts this
// banner once it already has a message to show.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AlertBanner — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AiLimitBanner / AnnouncerRegion surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.alertbanner

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no title, body, or variant —
 * only this constant identifier — so a diagnostics line can never leak the notice's content.
 */
const val ALERT_BANNER_SLUG: String = "AlertBanner"

/**
 * The severity treatment the banner paints with — the native mirror of the web `variant` union
 * (`'info' | 'success' | 'warning' | 'danger'`). Each maps 1:1 to a feedback Tone palette in the view.
 */
enum class AlertVariant {
    /** Cyan informational notice (web `variant="info"`). */
    Info,

    /** Green confirmation notice (web `variant="success"`). */
    Success,

    /** Amber cautionary notice (web `variant="warning"`). */
    Warning,

    /** Red critical notice (web `variant="danger"`). */
    Danger,
}

/**
 * Parse a wire/string `variant` into an [AlertVariant] — the native mirror of the web string union. Any
 * unrecognized or absent value collapses to [AlertVariant.Info], the lowest-severity informational default, so a
 * forward-compatible client never crashes on a new backend variant. Case-sensitive, like the web union.
 */
fun variantFromWire(raw: String?): AlertVariant =
    when (raw) {
        "success" -> AlertVariant.Success
        "warning" -> AlertVariant.Warning
        "danger" -> AlertVariant.Danger
        else -> AlertVariant.Info
    }

/**
 * The render-ready classification of the banner — everything the view needs to draw, reduced from the parent's
 * props so every branch is exhaustively covered and unit-tested off-device. The web component always renders (it
 * is controlled; the parent decides whether to mount it), so there is no hidden surface — only which regions are
 * shown.
 *
 * @property variant the severity tint (web `variant`).
 * @property showIcon a leading severity glyph is shown — only when the parent supplied one (web `{icon && …}`).
 * @property showTitle the optional title row is shown (web `{title && …}`).
 * @property showBody a real body (a non-blank message or a slot) is shown (web `children`).
 * @property showEmptyFallback no body was supplied — the view shows a localized caption, never a blank box.
 * @property dismissible the trailing dismiss affordance is shown (web `{onClose && …}`).
 */
data class AlertBannerRender(
    val variant: AlertVariant,
    val showIcon: Boolean,
    val showTitle: Boolean,
    val showBody: Boolean,
    val showEmptyFallback: Boolean,
    val dismissible: Boolean,
)

/**
 * The parent-owned inputs to the banner, bundled into one value object so the pure [classify] reads a single
 * argument instead of a long parameter list — the native mirror of the web `AlertBannerProps` the parent
 * supplies. A blank [title] or [message] is treated as absent (web falsy `title` / empty `children`).
 *
 * @property variant the severity tint (web `variant`).
 * @property title the optional heading (web `title`).
 * @property message the flat body text (the common web `children`).
 * @property hasSlotContent whether the parent passed an arbitrary body slot (the faithful web `children`).
 * @property hasIcon whether the parent supplied a leading glyph (web truthy `icon`).
 * @property dismissible whether the parent supplied a dismiss callback (web truthy `onClose`).
 */
data class AlertBannerInput(
    val variant: AlertVariant = AlertVariant.Info,
    val title: String? = null,
    val message: String? = null,
    val hasSlotContent: Boolean = false,
    val hasIcon: Boolean = false,
    val dismissible: Boolean = false,
)

/**
 * Reduce the parent's [input] into the render-ready [AlertBannerRender]. Pure (no Compose). A blank title or
 * message is treated as absent (web falsy `title` / empty `children`); when neither a message nor a slot is
 * present the body is empty and [AlertBannerRender.showEmptyFallback] is set so the view never paints a blank
 * region.
 */
fun classify(input: AlertBannerInput): AlertBannerRender {
    val hasBody = input.hasSlotContent || !input.message.isNullOrBlank()
    return AlertBannerRender(
        variant = input.variant,
        showIcon = input.hasIcon,
        showTitle = !input.title.isNullOrBlank(),
        showBody = hasBody,
        showEmptyFallback = !hasBody,
        dismissible = input.dismissible,
    )
}

/**
 * Build the merged accessibility announcement for the alert from its already-localized parts (the view resolves
 * the title + body through props / i18n). Kept pure so TalkBack-label presence is unit-tested without a Compose
 * host. Blank parts are skipped and joined into one sentence; when both are blank the [emptyFallback] caption is
 * announced so the region is never silent.
 */
fun bannerAccessibilityLabel(
    title: String?,
    body: String?,
    emptyFallback: String,
): String {
    val parts = listOfNotNull(title, body).map { it.trim() }.filter { it.isNotEmpty() }
    return if (parts.isEmpty()) emptyFallback else parts.joinToString(separator = ". ")
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the title,
 * body, or variant — so a diagnostics line can never leak the notice's content.
 */
object AlertBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ALERT_BANNER_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
