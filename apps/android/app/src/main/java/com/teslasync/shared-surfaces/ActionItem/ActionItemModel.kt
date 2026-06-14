// Pure, framework-free model + CTA taxonomy + render classifier for the ActionItem shared surface — the native
// analogue of every decision the web component makes (web/src/components/status/ActionItem.tsx) before it paints.
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, presentational component — "single operator task row" (web JSDoc) that surfaces a thing the
//     operator should do (run backup, re-auth, install update). The parent owns the data: it passes a
//     `severity`, a `title`, an optional `description` sub-line, and an optional `cta`. The component's only
//     logic is selecting the severity treatment (icon + tint) from `severity` and choosing the CTA's element
//     from the action shape. There is NO hook, NO fetch, and NO data port to bind (no P1/S8 state holder, no
//     Source/ViewModel) — modelling one would invent an async dependency the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The closest sibling precedent is the equally-presentational
//     InlineCallout / AlertBanner surfaces (composable + model, no Source/ViewModel); ActionItem is their
//     task-row cousin.
//   • So the surface's REAL, fully-reproduced branches are its three severity variants (info / warn / error)
//     crossed with: a real title vs a blank title (the empty fallback), a description present/absent (web
//     `{description && …}`), and which of FOUR CTA outcomes the action selects — the native mirror of the web
//     `ActionCTA` element switch:
//       – web `cta.to` truthy + `cta.external` ⇒ an `<a target="_blank">` external link ⇒ [ActionCtaKind.ExternalLink]
//       – web `cta.to` truthy (not external)   ⇒ a router `<Link>` in-app navigation     ⇒ [ActionCtaKind.InternalLink]
//       – web `cta.onClick` truthy (no `to`)   ⇒ a `<button>` in-app action              ⇒ [ActionCtaKind.Button]
//       – web fall-through (a `cta` with neither `to` nor `onClick`, or no `cta`) ⇒ no CTA region ⇒ `cta == null`
//     Each is reduced here in [classify] and asserted in the off-device test, doubling as the per-branch snapshot.
//   • The native CTA collapses the web `to` (navigation) and `onClick` (in-app) onto one
//     [ActionItemCta.onActivate] callback (a native app routes through a callback, never a DOM href), preserving
//     the web's external / internal / button distinction through [ActionItemCta.kind] so the view + caller mirror
//     the original element + navigation intent without shipping a dead `href` string the runtime could never
//     honour. The three active kinds paint identically (a severity-tinted label + chevron) — exactly as the web
//     does, where the `<a>` / `<Link>` / `<button>` differ only in element + target, not in painted output.
//   • The one place this surface improves on a literal port is the empty-title branch: the web takes `title` as a
//     required string, but the prompt's "empty → friendly empty state, never a blank box" contract is honoured by
//     [classify] flagging a blank title so the view renders a localized caption instead of an empty primary line.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is a controlled task row whose content is handed in by its parent. There is no query to be
// loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest. The owning panel
// that DOES fetch (e.g. ActionItemsPanel) renders its own data surface and only mounts these rows once it already
// has tasks to surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ActionItem — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling InlineCallout / RateLimitBanner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.actionitem

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no title, description, CTA
 * label, or severity — only this constant identifier — so a diagnostics line can never leak the row's content.
 */
const val ACTION_ITEM_SLUG: String = "ActionItem"

/**
 * The severity treatment the row paints with — the native mirror of the web `ActionSeverity` union
 * (`'info' | 'warn' | 'error'`). Drives the leading glyph + the icon/container tint; each maps 1:1 to a feedback
 * Tone palette in the view.
 */
enum class ActionSeverity {
    /** Blue informational task (web `severity="info"`, lucide `Info`). */
    Info,

    /** Amber cautionary task (web `severity="warn"`, lucide `AlertTriangle`). */
    Warn,

    /** Red critical task (web `severity="error"`, lucide `AlertCircle`). */
    Error,
}

/**
 * Parse a wire/string `severity` into an [ActionSeverity] — the native mirror of the web string union. Any
 * unrecognized or absent value collapses to [ActionSeverity.Info], the lowest-severity informational default, so
 * a forward-compatible client never crashes on a new backend value. Case-sensitive, like the web union.
 */
fun severityFromWire(raw: String?): ActionSeverity =
    when (raw) {
        "warn" -> ActionSeverity.Warn
        "error" -> ActionSeverity.Error
        else -> ActionSeverity.Info
    }

/**
 * Which element the web `ActionCTA` resolves to — carried on the parent-owned [ActionItemCta] so the view + the
 * production caller can mirror the original navigation intent. The web prefers `to` over `onClick`; a caller
 * declares the kind up front rather than passing a dead `href` the native runtime could never follow.
 */
enum class ActionCtaKind {
    /** Web `cta.to` + `cta.external` → an `<a target="_blank">`; activates navigation to an external URL. */
    ExternalLink,

    /** Web `cta.to` (not external) → a router `<Link>`; activates in-app navigation. */
    InternalLink,

    /** Web `cta.onClick` (no `to`) → a `<button>`; activates an in-app action. */
    Button,
}

/**
 * The parent-owned call-to-action that renders as a right-aligned affordance — the native port of the web
 * `cta?: { label; to?; external?; onClick? }`. The web `to` (navigation) and `onClick` (in-app) collapse onto one
 * [onActivate] callback because a native app routes through a callback rather than a DOM href; [kind] preserves
 * the web's external / internal / button distinction so the view + caller reproduce the original element +
 * navigation intent.
 *
 * @property label the affordance text shown before the chevron (web `cta.label`); already localized by the
 *   caller, exactly like the web string.
 * @property kind which web element this CTA reproduces (external link / internal link / button).
 * @property onActivate invoked when the CTA is tapped; `null` reproduces the degenerate web `cta` that carries a
 *   label but neither `to` nor `onClick` (the web `ActionCTA` returns `null` → no CTA region). A native link has
 *   no inert href to fall back on, so every kind activates through this callback.
 */
data class ActionItemCta(
    val label: String,
    val kind: ActionCtaKind = ActionCtaKind.Button,
    val onActivate: (() -> Unit)? = null,
)

/**
 * The parent-owned inputs to the row, bundled into one value object so the pure [classify] reads a single
 * argument instead of a long parameter list — the native mirror of the web `ActionItemProps` the parent supplies.
 * A blank [title] is treated as the empty fallback (never a blank box); a blank [ctaLabel] or an action with no
 * activation is treated as no CTA (the web `ActionCTA` fall-through).
 *
 * @property severity the severity treatment (web `severity`).
 * @property title the primary task line (web required `title`); blank ⇒ the empty fallback.
 * @property hasDescription whether the parent supplied a description sub-line (web truthy `description`).
 * @property ctaLabel the CTA affordance text (web `cta.label`); blank ⇒ no CTA.
 * @property ctaKind which web element the CTA reproduces; `null` when there is no CTA.
 * @property ctaHasActivation whether the CTA carries an activation handler (web truthy `to` or `onClick`).
 */
data class ActionItemInput(
    val severity: ActionSeverity = ActionSeverity.Info,
    val title: String? = null,
    val hasDescription: Boolean = false,
    val ctaLabel: String? = null,
    val ctaKind: ActionCtaKind? = null,
    val ctaHasActivation: Boolean = false,
)

/**
 * The render-ready classification of the row — everything the view needs to draw, reduced from the parent's props
 * so every branch is exhaustively covered and unit-tested off-device. The web component always renders (the
 * parent decides whether to mount it), so there is no hidden surface — only which regions are shown and which CTA
 * element, if any, is appended.
 *
 * @property severity the severity treatment (web `severity`).
 * @property showTitle a real (non-blank) title is shown as the primary line (web `title`).
 * @property showEmptyFallback the title was blank — the view shows a localized caption, never a blank line.
 * @property showDescription the description sub-line is shown (web `{description && …}`).
 * @property cta which CTA element is appended (web `ActionCTA`), or `null` for no CTA region.
 */
data class ActionItemRender(
    val severity: ActionSeverity,
    val showTitle: Boolean,
    val showEmptyFallback: Boolean,
    val showDescription: Boolean,
    val cta: ActionCtaKind?,
)

/**
 * Reduce the parent's [input] into the render-ready [ActionItemRender]. Pure (no Compose). A blank title is
 * treated as the empty fallback so the view never paints a blank primary line. A CTA is shown only when it
 * carries both a non-blank label and an activation handler — the native mirror of the web `ActionCTA`, which
 * renders nothing for a `cta` with neither `to` nor `onClick`; its [ActionCtaKind] is carried through unchanged.
 */
fun classify(input: ActionItemInput): ActionItemRender {
    val hasTitle = !input.title.isNullOrBlank()
    val cta = if (!input.ctaLabel.isNullOrBlank() && input.ctaHasActivation) input.ctaKind else null
    return ActionItemRender(
        severity = input.severity,
        showTitle = hasTitle,
        showEmptyFallback = !hasTitle,
        showDescription = input.hasDescription,
        cta = cta,
    )
}

/**
 * Build the merged accessibility announcement for the row from its already-localized parts (the view resolves the
 * title + description through props / i18n). Kept pure so TalkBack-label presence is unit-tested without a Compose
 * host. The title (or, when blank, the [emptyFallback]) leads; a present description is appended so a screen-reader
 * user hears the task and its detail in one focus. The CTA is announced separately by its own button node, so it
 * is intentionally not folded in here. Blank parts are skipped.
 */
fun actionItemAccessibilityLabel(
    title: String?,
    description: String?,
    emptyFallback: String,
): String {
    val lead = title?.trim().takeUnless { it.isNullOrEmpty() } ?: emptyFallback
    val detail = description?.trim().takeUnless { it.isNullOrEmpty() }
    return listOfNotNull(lead, detail).joinToString(separator = ". ")
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the title,
 * description, CTA label, or severity — so a diagnostics line can never leak the row's content.
 */
object ActionItemDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ACTION_ITEM_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
