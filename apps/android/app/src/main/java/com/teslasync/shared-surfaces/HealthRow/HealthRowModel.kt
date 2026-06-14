// Pure, framework-free model + projection + diagnostics for the HealthRow shared surface — the native
// analogue of every decision the web component makes (web/src/components/status/HealthRow.tsx) before it
// paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL, single-line health-summary row: a status-coloured dot, an optional leading icon,
//     a truncated label, a right-aligned status-coloured summary (e.g. "12 / 12 healthy"), and — only when the
//     row is a link or has an onClick — a trailing chevron. It is meant to be stacked inside a panel as a
//     high-density at-a-glance health grid. The parent owns the `status`, the already-formatted `label` /
//     `summary`, and the click target; the component has NO `useTranslation` and NO data hook — so there is no
//     data port to bind (no P1/S8 state holder, no Source/ViewModel). Modelling one would invent a fetch the
//     web spec does not have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational
//     ports StatusHero / HistoryListRow / ScoreBadge document the same rationale (composable + model, no Source).
//   • The web keeps two IDENTICAL colour tables — `DOT_FOR_STATUS` and `TEXT_FOR_STATUS` — each mapping a
//     `HeroStatus` (imported from StatusHero) to a Tailwind colour family (green / amber / red / zinc / blue).
//     Because they are identical, ONE tone drives both the dot fill and the summary text colour here:
//     [projectHealthRow] reduces the status to a render-agnostic [HealthRowTone], and the Compose boundary maps
//     the tone onto a per-theme P1/S9 token colour (never a raw hex), so light / dark / high-contrast stay
//     correct. The `HeroStatus` enum itself is reused from the sibling StatusHero surface — exactly as the web
//     imports `HeroStatus` from `./StatusHero` rather than redeclaring it.
//   • Click handling is the surface's only real logic: `to ? (external ? <a target=_blank> : <Link to>) :
//     (onClick ? <button> : <div>)`. [healthRowInteraction] reduces `(to, external, hasOnClick)` to that
//     four-way [HealthRowInteraction] exactly — an external link, an internal link, a click handler, or a
//     static row — so the off-device test pins every branch without a Compose host. The chevron and the
//     interactive affordances render iff the row is one of the three interactive branches (web `to || onClick`).
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it paints the status + strings the parent already holds. Its real, fully
// reproduced states are the FIVE status branches (healthy / degraded / unhealthy / unknown / maintenance) and
// the FOUR interaction branches (external link / internal link / clickable / static), plus the optional-icon
// branch; each is reduced here and asserted off-device, and rendered in the on-device per-state UI test.
// `unknown` is this surface's not-yet-known / neutral branch — it still paints a full, non-blank row (a muted
// zinc dot + summary), never a hidden surface.
//
// i18n: the surface is anonymous — it owns no copy. The label and summary are caller-supplied strings the host
// has already localized (the web component has no `t()` call), so there is no literal to route through the
// P1/S10 catalog here, and no English literal lives in native code.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/HealthRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling StatusHero / HistoryListRow surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.healthrow

import io.teslasync.android.sharedsurfaces.statushero.HeroStatus
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The render-agnostic colour family a row paints its status dot + summary with — the native mirror of the web
 * `DOT_FOR_STATUS` / `TEXT_FOR_STATUS` Tailwind families (which are identical, so one tone covers both). The
 * Compose boundary maps each onto a per-theme colour from the P1/S9 tokens (never a raw hex), so light / dark /
 * high-contrast all stay correct; keeping it an enum lets the off-device test assert the choice without a
 * Compose host.
 *
 * Web family → token:
 *   - healthy `green`   → [Success] (`status.success`)
 *   - degraded `amber`  → [Warning] (`status.warning`)
 *   - unhealthy `red`   → [Danger]  (`status.danger`)
 *   - maintenance `blue`→ [Info]    (`status.info`)
 *   - unknown `zinc`    → [Neutral] (the scheme's muted on-surface colour)
 */
enum class HealthRowTone { Success, Warning, Danger, Info, Neutral }

/**
 * The fully reduced, render-ready projection of the row's status — everything the dot + summary need to colour
 * themselves, derived purely so every branch is covered off-device. The view only resolves the tone's token
 * colour, then paints it.
 *
 * @property status the health tier the row renders (web `status`).
 * @property tone the render tone shared by the dot fill and the summary text (web `DOT_FOR_STATUS` /
 *   `TEXT_FOR_STATUS`, mapped to a token at the boundary).
 */
data class HealthRowProjection(
    val status: HeroStatus,
    val tone: HealthRowTone,
)

/** The shared status → tone table — a verbatim port of the web `DOT_FOR_STATUS` / `TEXT_FOR_STATUS` families. */
private val TONE_FOR_STATUS: Map<HeroStatus, HealthRowTone> =
    mapOf(
        HeroStatus.Healthy to HealthRowTone.Success,
        HeroStatus.Degraded to HealthRowTone.Warning,
        HeroStatus.Unhealthy to HealthRowTone.Danger,
        HeroStatus.Unknown to HealthRowTone.Neutral,
        HeroStatus.Maintenance to HealthRowTone.Info,
    )

/**
 * Reduce a [status] into the render-ready [HealthRowProjection] — the native mirror of the web
 * `DOT_FOR_STATUS[status]` / `TEXT_FOR_STATUS[status]` lookups. Pure (no Compose), so the per-status branch set
 * is fully covered by the JVM unit gate.
 */
fun projectHealthRow(status: HeroStatus): HealthRowProjection = HealthRowProjection(status, TONE_FOR_STATUS.getValue(status))

/**
 * How the row reacts to a tap — the native reduction of the web render split
 * `to ? (external ? <a target=_blank> : <Link to>) : (onClick ? <button> : <div>)`. The four cases are mutually
 * exclusive: a present `to` wins (and `external` decides browser-vs-router), then `onClick`, then a static row.
 */
sealed interface HealthRowInteraction {
    /** Web `to` + `external` branch — the `<a target="_blank">`; the render layer opens [url] in the browser. */
    data class OpenExternal(
        val url: String,
    ) : HealthRowInteraction

    /** Web `to` (not external) branch — the router `<Link to>`; the render layer routes [to] through the host. */
    data class Navigate(
        val to: String,
    ) : HealthRowInteraction

    /** Web `onClick` branch (no `to`) — the `<button>` fires the host-supplied handler. */
    data object Clickable : HealthRowInteraction

    /** Neither `to` nor `onClick` — the static `<div>`, a non-interactive row. */
    data object Static : HealthRowInteraction
}

/**
 * Reduce the row's click props to the resolved [HealthRowInteraction] — the adapter the web encodes as
 * `to ? (external ? a : Link) : (onClick ? button : div)`. A blank / whitespace-only [to] is treated as absent
 * (an empty link target navigates nowhere), so it falls through to the `onClick` / static branches. `external`
 * only matters when [to] is present, exactly as the web nests it inside the `if (to)` block.
 *
 * @param to the link target (web `to`); null / blank means "no link".
 * @param external whether a present [to] opens in a new tab / the browser (web `external`).
 * @param hasOnClick whether the host supplied a tap handler (web `onClick != null`).
 * @return the four-way interaction the render layer wires the clickable from.
 */
fun healthRowInteraction(
    to: String?,
    external: Boolean,
    hasOnClick: Boolean,
): HealthRowInteraction =
    when {
        !to.isNullOrBlank() && external -> HealthRowInteraction.OpenExternal(to)
        !to.isNullOrBlank() -> HealthRowInteraction.Navigate(to)
        hasOnClick -> HealthRowInteraction.Clickable
        else -> HealthRowInteraction.Static
    }

/**
 * The accessibility role the row's clickable advertises — the projection of the interaction. Any interactive
 * branch (external / internal link / clickable) is a [Button] (so assistive tech announces it as actionable and
 * offers the activate gesture); a [Static] row carries no role. Compose has no dedicated "link" role, so the
 * navigable rows reuse [HealthRowRole.Button] — the closest actionable semantic, exactly as the sibling
 * HistoryListRow does.
 */
enum class HealthRowRole {
    /** Non-interactive row — no actionable role is exposed. */
    None,

    /** Interactive row (external / internal link or clickable) — exposed as an actionable button. */
    Button,
}

/** Project the [interaction] onto the row's accessibility [HealthRowRole]. */
fun healthRowRole(interaction: HealthRowInteraction): HealthRowRole =
    when (interaction) {
        HealthRowInteraction.Static -> HealthRowRole.None
        HealthRowInteraction.Clickable -> HealthRowRole.Button
        is HealthRowInteraction.Navigate -> HealthRowRole.Button
        is HealthRowInteraction.OpenExternal -> HealthRowRole.Button
    }

/**
 * True when the row reacts to taps (any link or a click handler) — the native mirror of the web `(to || onClick)`
 * guard that gates BOTH the trailing chevron and the hover / focus affordance. Drives the merged-semantics /
 * clickable wiring and the chevron's presence in the render layer.
 */
fun healthRowShowsAffordance(interaction: HealthRowInteraction): Boolean = healthRowRole(interaction) == HealthRowRole.Button

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the status,
 * label, or summary (which can name subsystems and counts) — so a diagnostics line can never leak a vehicle's
 * instance health through this row.
 */
object HealthRowDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "HealthRow"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
