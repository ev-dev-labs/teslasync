// Pure, framework-free model + projection + diagnostics for the StatusHero shared surface — the native
// analogue of every decision the web component makes (web/src/components/status/StatusHero.tsx) before it
// paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL "is my instance healthy?" hero card. The parent owns the status and passes it in
//     (`status`), optionally overriding the headline / supplying a subline / a live flag / a CTA. The web
//     component has NO `useTranslation` and NO data hook — so there is no data port to bind (no P1/S8 state
//     holder, no Source/ViewModel); modelling one would invent a fetch the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The sibling presentational ports ScoreBadge /
//     BatteryDelta / ProgressRing document the same rationale (composable + model, no Source).
//   • The web `STATUS_CONFIG` maps each of the five `HeroStatus` values to an icon, a colour family, a glow,
//     and a default headline. Native mirror: [STATUS_CONFIG] → a render-agnostic [StatusHeroProjection]
//     ([StatusTone] + [StatusGlyphKind]); the Compose boundary resolves the tone to a per-theme token colour
//     and the glyph-kind to an [androidx.compose.ui.graphics.vector.ImageVector], and the default headline to
//     a localized P1/S10 string (never a raw hex / English literal in the view).
//   • The web glow (`boxShadow: 0 0 60px {rgba}`) has no literal native analogue; the native GlassPanel
//     documents its tinted `accent` border as the platform replacement, so each tone also selects a panel
//     accent at the boundary.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it renders the status the parent already holds. Its real, fully reproduced
// states are the FIVE status branches (healthy / degraded / unhealthy / unknown / maintenance) plus the
// optional headline-override, subline, live-dot, and CTA branches; each is reduced here and asserted in the
// off-device test, and rendered in the on-device per-state UI test.
//
// `unknown` is the cold-start / "status not yet known" branch (the web SystemStatusPage passes `unknown`
// while health is stale) — i.e. it is this surface's loading/empty/unknown equivalent, and it always renders
// a non-blank card (muted help glyph + headline), never a hidden panel.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/StatusHero — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ScoreBadge / LiveIndicator surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statushero

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The overall health a [StatusHero] surfaces — the native mirror of the web `HeroStatus` union
 * (`'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'maintenance'`). The parent owns the value; the
 * surface only paints it.
 */
enum class HeroStatus {
    /** Web `'healthy'` — all systems operational (emerald check). */
    Healthy,

    /** Web `'degraded'` — degraded performance (amber alert-triangle). */
    Degraded,

    /** Web `'unhealthy'` — service outage (red x-circle). */
    Unhealthy,

    /** Web `'unknown'` — status not yet known / health is stale (muted help-circle); the cold-start branch. */
    Unknown,

    /** Web `'maintenance'` — scheduled maintenance (blue wrench). */
    Maintenance,
}

/**
 * The render-agnostic colour family a status paints with — the native mirror of the web `STATUS_CONFIG`
 * `ring` / `bg` / `text` Tailwind families. The Compose boundary maps each onto a per-theme colour from the
 * P1/S9 tokens (never a raw hex), so light / dark / high-contrast all stay correct; keeping it an enum lets
 * the off-device test assert the choice without a Compose host.
 *
 * Web family → token:
 *   - healthy `green`  → [Success] (`status.success`)
 *   - degraded `amber` → [Warning] (`status.warning`)
 *   - unhealthy `red`  → [Danger]  (`status.danger`)
 *   - maintenance `blue` → [Info]  (`status.info`)
 *   - unknown `zinc`   → [Neutral] (the scheme's muted on-surface colour)
 */
enum class StatusTone { Success, Warning, Danger, Info, Neutral }

/**
 * The status glyph a tier draws — the native mirror of the web `STATUS_CONFIG` `lucide-react` icon. The
 * render boundary maps each onto a stroked [androidx.compose.ui.graphics.vector.ImageVector]; keeping it an
 * enum lets the off-device test assert the icon choice without a Compose host.
 *
 * Web icon → kind: CheckCircle → [CheckCircle], AlertTriangle → [AlertTriangle], XCircle → [XCircle],
 * HelpCircle → [HelpCircle], Wrench → [Wrench].
 */
enum class StatusGlyphKind { CheckCircle, AlertTriangle, XCircle, HelpCircle, Wrench }

/**
 * The fully reduced, render-ready projection of the surface — everything the composable needs to paint the
 * hero, derived purely so every branch is covered off-device. The view only resolves the tone's token
 * colour + panel accent, the glyph-kind's vector, and the localized default headline, then draws them.
 *
 * @property status the health tier the hero renders (web `status`).
 * @property tone the render tone (web colour family, mapped to a token at the boundary).
 * @property glyph the status glyph (web `STATUS_CONFIG.icon`, mapped to a vector at the boundary).
 */
data class StatusHeroProjection(
    val status: HeroStatus,
    val tone: StatusTone,
    val glyph: StatusGlyphKind,
)

/**
 * The shared status → (tone, glyph) table — a verbatim port of the web `STATUS_CONFIG` icon + colour choices
 * (the default headline is a localized string resolved at the Compose boundary, so it is not carried here).
 */
private val STATUS_CONFIG: Map<HeroStatus, StatusHeroProjection> =
    mapOf(
        HeroStatus.Healthy to StatusHeroProjection(HeroStatus.Healthy, StatusTone.Success, StatusGlyphKind.CheckCircle),
        HeroStatus.Degraded to StatusHeroProjection(HeroStatus.Degraded, StatusTone.Warning, StatusGlyphKind.AlertTriangle),
        HeroStatus.Unhealthy to StatusHeroProjection(HeroStatus.Unhealthy, StatusTone.Danger, StatusGlyphKind.XCircle),
        HeroStatus.Unknown to StatusHeroProjection(HeroStatus.Unknown, StatusTone.Neutral, StatusGlyphKind.HelpCircle),
        HeroStatus.Maintenance to StatusHeroProjection(HeroStatus.Maintenance, StatusTone.Info, StatusGlyphKind.Wrench),
    )

/**
 * Reduce a [status] into the render-ready [StatusHeroProjection] — the native mirror of the web
 * `cfg = STATUS_CONFIG[status]` lookup. Pure (no Compose), so the per-status branch set is fully covered by
 * the JVM unit gate.
 */
fun projectStatus(status: HeroStatus): StatusHeroProjection = STATUS_CONFIG.getValue(status)

/**
 * The optional call-to-action a [StatusHero] renders — the native mirror of the web `cta` prop
 * (`{ label, onClick, loading? }`). Framework-free (a label, a click lambda, a loading flag), so it lives
 * with the model; the composable maps it onto the shared `Button` (a refresh leading icon, a [loading]
 * spinner that also disables the control).
 *
 * @property label the already-localized button label the caller supplies (web `cta.label`).
 * @property onClick the click handler (web `cta.onClick`).
 * @property loading whether the action is in flight — disables the button and shows a spinner (web
 *   `cta.loading`).
 */
data class StatusHeroCta(
    val label: String,
    val onClick: () -> Unit,
    val loading: Boolean = false,
)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * status, headline, or subline — so a diagnostics line can never leak a vehicle's instance health.
 */
object StatusHeroDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "StatusHero"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
