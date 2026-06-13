// Pure, framework-free model + projections + diagnostics for the HistoryListRow shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/HistoryListRow.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device
// in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web surface is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL, slot-based row used by the history pages — DriveCard (under /drives) and
//     ChargingSessionCard (under /charging) compose the same row with different leading badges, metric chips,
//     and hover actions. The parent owns every slot (checkbox / leading / primary / route / metrics / insight
//     / actions) and the click target; the component has NO hook of its own and performs NO data fetching.
//     So there is no data port to bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would
//     invent a fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The
//     sibling presentational ports BatteryDelta / DateGroupedList document the same rationale (composable +
//     model, no Source).
//   • Click handling is the one piece of real logic: `href ? <Link to={href}>{body}</Link>` wraps the row for
//     navigation, otherwise `onClick` is fired by the panel, otherwise the row is static. [historyListRowInteraction]
//     reduces `(href, hasOnClick)` to that three-way [HistoryListRowInteraction] exactly — href wins, then
//     onClick, then static — so the off-device test pins it without a Compose host.
//   • The trailing chevron, the `selected` ring, and the `glow` colour are presentational props the web threads
//     straight onto markup. [historyListRowRole] projects the interaction onto the TalkBack role the clickable
//     advertises (Button when navigable / clickable, none when static); [historyListRowAccent] projects
//     `(selected, glow)` onto the resting border accent the panel paints.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it lays out slots the parent already holds. Its real, fully reproduced states are
// the three interaction branches (Navigate / Clickable / Static), the selected-vs-unselected accent, and the
// presence/absence of each optional slot (rendered conditionally by the view). Each is reduced here and
// asserted in the off-device test; inventing a network lifecycle would fabricate behaviour the web spec lacks.
//
// On `glow`: the web `glow` ('cyan' | 'green' | 'purple' | 'none') is a :hover-only affordance — GlassPanel
// applies its glow border/shadow classes only under `hover &&`, so an at-rest web row shows the plain subtle
// border. A touch surface has no hover, so an unselected native row paints NO resting glow accent — faithful
// to the web at-rest appearance and avoiding over-decorating the default-`cyan` rows. [HistoryListRowGlow] is
// retained for API parity and is threaded through [historyListRowAccent], which documents and encodes the
// rule: `selected` is the only persistent accent (the web `border-cyan-400/40 ring` selected ring); every glow
// value on an unselected row resolves to no accent. The render layer maps the resolved accent onto the shared
// GlassPanel PanelAccent ("replacing the web 'glow' affordance", per its contract).
//
// i18n: the surface is anonymous — it owns no copy. Every visible string lives inside a caller-supplied slot
// already localized by the host, so there is no literal to route through the P1/S10 catalog here.
//
// The mandated surface directory (com/teslasync/shared-surfaces/HistoryListRow — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package id), so
// the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.historylistrow

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Hover-glow colour — the faithful port of the web `HistoryListRowGlow` type
 * (`'cyan' | 'green' | 'purple' | 'none'`). On the web it tints the GlassPanel border/shadow on `:hover`; a
 * touch surface has no hover, so it is accepted for API parity and resolves to no resting accent (see
 * [historyListRowAccent]). Field order mirrors the web union for parity readability.
 */
enum class HistoryListRowGlow {
    /** Web `glow="cyan"` — the component default. */
    Cyan,

    /** Web `glow="green"`. */
    Green,

    /** Web `glow="purple"`. */
    Purple,

    /** Web `glow="none"` — no hover tint. */
    None,
}

/**
 * How the row reacts to a tap — the native reduction of the web click split. The web wraps the body in a
 * router `<Link to={href}>` when `href` is set, otherwise fires `onClick` from the panel, otherwise renders a
 * static row. The three cases are mutually exclusive here (href takes precedence), matching the web prop
 * documentation ("mutually exclusive with `href`").
 */
sealed interface HistoryListRowInteraction {
    /** Web `href` branch — the row navigates; the render layer routes the [href] through the host's navigator. */
    data class Navigate(
        val href: String,
    ) : HistoryListRowInteraction

    /** Web `onClick` branch (no href) — the panel fires the host-supplied handler. */
    data object Clickable : HistoryListRowInteraction

    /** Neither `href` nor `onClick` — a non-interactive row. */
    data object Static : HistoryListRowInteraction
}

/**
 * Reduce the row's click props to the resolved [HistoryListRowInteraction] — the adapter the web encodes as
 * `href ? Link : (onClick ? clickable : static)`. A blank / whitespace-only [href] is treated as absent (an
 * empty router target navigates nowhere), so it falls through to the `onClick` / static branches.
 *
 * @param href the navigation target (web `href`); null / blank means "no link".
 * @param hasOnClick whether the host supplied a tap handler (web `onClick != null`).
 * @return the three-way interaction the render layer wires the clickable from.
 */
fun historyListRowInteraction(
    href: String?,
    hasOnClick: Boolean,
): HistoryListRowInteraction =
    when {
        !href.isNullOrBlank() -> HistoryListRowInteraction.Navigate(href)
        hasOnClick -> HistoryListRowInteraction.Clickable
        else -> HistoryListRowInteraction.Static
    }

/**
 * The TalkBack role the row's clickable advertises — the accessibility projection of the interaction. A
 * navigable or clickable row is a [Button] (so TalkBack announces it as actionable and offers the activate
 * gesture); a [Static] row carries no role. Compose has no dedicated "link" role, so the navigable row reuses
 * [HistoryListRowRole.Button] — the closest actionable semantic.
 */
enum class HistoryListRowRole {
    /** Non-interactive row — no actionable role is exposed. */
    None,

    /** Interactive row (navigable or clickable) — exposed as an actionable button. */
    Button,
}

/** Project the [interaction] onto the row's accessibility [HistoryListRowRole]. */
fun historyListRowRole(interaction: HistoryListRowInteraction): HistoryListRowRole =
    when (interaction) {
        HistoryListRowInteraction.Static -> HistoryListRowRole.None
        HistoryListRowInteraction.Clickable -> HistoryListRowRole.Button
        is HistoryListRowInteraction.Navigate -> HistoryListRowRole.Button
    }

/** True when the row reacts to taps (navigable or clickable) — drives the merged-semantics / clickable wiring. */
fun historyListRowInteractive(interaction: HistoryListRowInteraction): Boolean =
    historyListRowRole(interaction) == HistoryListRowRole.Button

/**
 * The resting border accent the panel paints — the framework-free reduction the render layer maps onto the
 * shared GlassPanel PanelAccent. Only [Selected] is a persistent web affordance (the `border-cyan-400/40
 * ring-1 ring-cyan-400/20` selected ring); the hover-only `glow` contributes no resting accent on a touch
 * surface (see [historyListRowAccent]).
 */
enum class HistoryListRowAccent {
    /** No resting accent — the plain subtle panel border (web at-rest, unselected). */
    None,

    /** The persistent selected ring — the web `selected` cyan border + ring. */
    Selected,
}

/**
 * Project `(selected, glow)` onto the resting [HistoryListRowAccent]. `selected` paints the persistent ring
 * and takes precedence; for an unselected row every [glow] value resolves to [HistoryListRowAccent.None],
 * because the web `glow` is a `:hover`-only border/shadow (GlassPanel applies it only under `hover &&`) and a
 * touch surface has no hover — so the resting native row matches the plain web at-rest border. The [glow]
 * argument is read (the exhaustive `when` below) so the parity prop stays in the data flow and the rule is
 * pinned by the off-device test, not silently dropped.
 *
 * @param selected whether the row is in the selected state (web `selected`).
 * @param glow the parity glow colour (web `glow`); does not alter the resting accent on touch.
 * @return the resting accent the panel paints.
 */
fun historyListRowAccent(
    selected: Boolean,
    glow: HistoryListRowGlow,
): HistoryListRowAccent =
    if (selected) {
        HistoryListRowAccent.Selected
    } else {
        when (glow) {
            HistoryListRowGlow.Cyan,
            HistoryListRowGlow.Green,
            HistoryListRowGlow.Purple,
            HistoryListRowGlow.None,
            -> HistoryListRowAccent.None
        }
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any slot
 * content (which can hold locations, timestamps, vehicle activity) — so a diagnostics line can never leak user
 * data through this row.
 */
object HistoryListRowDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "HistoryListRow"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
