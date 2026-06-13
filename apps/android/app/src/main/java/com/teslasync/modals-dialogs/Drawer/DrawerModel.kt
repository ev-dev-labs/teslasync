// Pure, framework-free model + projection for the Drawer modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/ui/Drawer.tsx). No Compose,
// no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a generic slide-in side panel: `Drawer({ open, onClose, title?, children, footer?,
// side='right', className? })`. It binds NO data hook — it is purely presentational and owns no store — so,
// exactly like the sibling ConfirmDialog / AddAnnotationPopover surfaces, the cache-then-network lifecycle
// (loading / empty / error / stale / offline) lives on the OWNING surface that fills the drawer body, NOT
// here; modelling those phases would invent behaviour the web spec does not have (drift). The branches the web
// source actually defines are the complete state set this surface renders, and each is projected here:
//   1. the render gate (web `if (!open) return null`) — carried by the composable's early return,
//   2. the slide side (web `side='left' | 'right'`) — which edge the panel anchors to and slides in from,
//   3. the optional header (web `{title && (...)}`) — shown only for a non-empty title,
//   4. the optional footer (web `{footer && (...)}`) — shown only when a footer is supplied,
//   5. the accessible name (web `aria-label={title || 'Panel'}`) — the title, or the 'Panel' fallback.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/Drawer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modal/dialog surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.drawer

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DrawerRegistration {
    /** Stable surface id. */
    const val ID: String = "drawer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Drawer"
}

/**
 * Which edge the panel anchors to and slides in from — the native analogue of the web `side` prop
 * (`'left' | 'right'`, default `'right'`). Modelled as the RTL-aware logical [Start] / [End] edges (the
 * Android-idiomatic choice) rather than physical left/right, so the panel mirrors correctly in a
 * right-to-left layout; the composable maps the resolved logical edge to a physical slide direction.
 *
 * @property web the exact web `side` token this case corresponds to (web `'left'` / `'right'`).
 */
enum class DrawerSide(
    val web: String,
) {
    Start("left"),
    End("right"),
    ;

    companion object {
        /** The web component's default `side = 'right'`. */
        val DEFAULT: DrawerSide = End

        /** Resolves a web `side` token to its case; an unknown token falls back to [DEFAULT] (web default). */
        fun fromWeb(token: String): DrawerSide = entries.firstOrNull { it.web == token } ?: DEFAULT
    }
}

/**
 * The already-localized chrome strings the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless renderer takes plain strings and stays trivially previewable + UI-testable.
 *
 * @property close the close-button + scrim accessible label (web `aria-label="Close"`; key
 *   `translation_common_close`).
 * @property panel the title-less fallback accessible name (web `aria-label={title || 'Panel'}`; key
 *   `translation_drawer_panelLabel`).
 */
data class DrawerStrings(
    val close: String,
    val panel: String,
)

/**
 * The fully projected, render-ready view — the native analogue of every value the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property side the resolved anchor/slide edge (web `side`).
 * @property showHeader whether the title header row renders (web `{title && (...)}`).
 * @property showFooter whether the footer region renders (web `{footer && (...)}`).
 * @property accessibleName the dialog's accessible pane name (web `aria-label={title || 'Panel'}`).
 */
data class DrawerDisplay(
    val side: DrawerSide,
    val showHeader: Boolean,
    val showFooter: Boolean,
    val accessibleName: String,
)

/**
 * Pure projection from the surface's inputs to its render-ready [DrawerDisplay] — a 1:1 port of the
 * truthiness derivations the web component performs inline: the `title &&` header guard, the `footer &&`
 * footer guard, and the `title || 'Panel'` accessible-name fallback. No Compose, no formatting.
 */
object DrawerProjection {
    /**
     * Projects the surface inputs into the render-ready [DrawerDisplay].
     *
     * @param title the optional header title (web `title`); a `null`/empty value renders no header and falls
     *   back to [panelFallback] for the accessible name, matching the web `title && …` / `title || 'Panel'`.
     * @param side the resolved anchor/slide edge (web `side`).
     * @param hasFooter whether a footer slot was supplied (web `footer` truthiness).
     * @param panelFallback the localized 'Panel' fallback used when [title] is absent (web `'Panel'`).
     */
    fun project(
        title: String?,
        side: DrawerSide,
        hasFooter: Boolean,
        panelFallback: String,
    ): DrawerDisplay =
        DrawerDisplay(
            side = side,
            showHeader = !title.isNullOrEmpty(),
            showFooter = hasFooter,
            accessibleName = if (title.isNullOrEmpty()) panelFallback else title,
        )
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DrawerRegistration.SLUG] (P1/S11).
 * Carries only the slug — never the caller's title or body content — so a diagnostics line can never leak
 * what the drawer is showing. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordDrawerOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DrawerRegistration.SLUG))
}
