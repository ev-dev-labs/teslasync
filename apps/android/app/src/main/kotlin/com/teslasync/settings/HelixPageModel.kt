// Pure, framework-free metadata for the HelixPage settings surface — the native analogue of the cross-cutting
// navigation identity the web page owns (web/src/features/settings/pages/HelixPage.tsx, the dedicated
// /integrations/helix wrapper that promotes the optional Helix AI integration to a first-class Integrations
// route). No Compose, no Android framework, no HTTP lives here, so the route id + slug are exercised off-device
// and the composable stays a thin render layer.
//
// Unlike the sibling ArchivedPage / ChannelsPage models this surface carries NO `view.opened` recorder of its
// own: HelixPage renders inside the shared PageContainer surface (web parity — the web page is a
// `<PageContainer><AISettings/></PageContainer>` wrapper), and PageContainer already emits the single
// surface-level `view.opened` diagnostic (P1/S11). Emitting a second here would double-count, so the slug is
// kept purely as the stable ViewModel key for the page's two scoped view-models.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/settings — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling ChannelsPage / GasPriceAutoPollPage surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.helix

/**
 * Canonical metadata for the HelixPage surface. The web page is a top-level Integrations route, not a draggable
 * dashboard widget, so there is no web registry row to mirror — this object carries the navigation [ROUTE_ID] /
 * [WEB_PATH] the host wires (already a metadata-only destination at Destinations.kt:
 * `page("integrationsHelix", "/integrations/helix", …)`) and the [SLUG] used as the stable per-route ViewModel
 * key. There is no page size or feed metadata because the page owns only the `useSettings` loading flag (web
 * `const { isLoading } = useSettings()`); the embedded AISettings feature view owns the configuration feeds.
 */
object HelixPageRegistration {
    /** The navigation destination id (Destinations.kt `page("integrationsHelix", "/integrations/helix", …)`). */
    const val ROUTE_ID: String = "integrationsHelix"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/integrations/helix"

    /** Stable key scoping the page's view-models to the /integrations/helix navigation entry. */
    const val SLUG: String = "HelixPage"
}
