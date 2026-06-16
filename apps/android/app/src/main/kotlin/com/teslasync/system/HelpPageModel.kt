// Pure metadata + domain model for the HelpPage system surface — the native analogue of the route identity +
// curated-link palette the web page owns (web/src/features/system/pages/HelpPage.tsx, the deterministic /help
// baseline). No Compose layout and no HTTP live here: the surface has no API data source (it renders entirely from
// this local, static link model), so the route identity, the curated link set, and the in-app deep links are all
// exercised off-device and the composable stays a thin render layer.
//
// The web page renders a short, intentionally-stable palette of five curated links to existing canonical
// destinations (the docs/status-api page, onboarding, system-status, search, and the chatbot). Each entry carries a
// stable id (React key / test marker), the target route, a Lucide icon, and an i18n title + description. This port
// mirrors that record one-to-one: every visible string resolves from the generated res/values catalog (ADR-014) at
// the render boundary, and the AI surface the web page layers alongside (AIRAGHelp) is a separate, conditional
// component — outside this page parity unit and its allowed files.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling CommandsPage surface documents.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.help

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.R
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the HelpPage surface. The web page is the deterministic /help baseline, but it is unrouted
 * in web/src/App.tsx (absent from the generator-locked Destinations registry), so A7 wires it as a standalone
 * deep-linkable composable in TeslaSyncNavHost under [ROUTE_ID]. This object carries the route id, the web path it
 * mirrors, the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11), and the deep-link URIs the
 * NavHost registers for it.
 */
object HelpPageRegistration {
    /** The Navigation-Compose route id for the standalone Help composable (TeslaSyncNavHost). */
    const val ROUTE_ID: String = "help"

    /** The web path this surface mirrors (deep-link target; the page is otherwise unrouted). */
    const val WEB_PATH: String = "/help"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "HelpPage"

    /**
     * The deep-link URIs the NavHost registers for the standalone Help route — the app's own `teslasync://app/help`
     * custom scheme plus the `https://app.teslasync.io/help` App-Link, built from the shared [RouteTable] scheme/host
     * so the two never drift.
     */
    val deepLinkUris: List<String> =
        listOf(
            "${RouteTable.APP_SCHEME}://app$WEB_PATH",
            "https://${RouteTable.APP_HOST}$WEB_PATH",
        )
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no user data. */
internal fun recordHelpPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to HelpPageRegistration.SLUG))
}

/**
 * One curated help link — the native analogue of the web `HelpLink` record. [id] is the stable key (web React key /
 * test marker); [webPath] is an existing canonical destination the card deep-links to (web `to`); [icon] is the
 * leading glyph (web Lucide `Icon`); [titleRes] / [descRes] are the i18n title + one-line description, resolved from
 * the string catalog at the render boundary so no copy is hardcoded (ADR-014). Every [webPath] points at a route
 * already mounted in Destinations, so the page introduces no new entity-detail surface.
 */
data class HelpLink(
    val id: String,
    val webPath: String,
    val icon: ImageVector,
    @param:StringRes val titleRes: Int,
    @param:StringRes val descRes: Int,
)

/**
 * The curated link palette the page renders — order is intentional and mirrors the web `HELP_LINKS`: documentation
 * first (most common entry point), then onboarding (new users), system status (operators), search (everyone), and
 * the chatbot (ask a question). The set is deliberately short + stable so even users who never see the AI surface
 * get a single visible jumping-off point to the canonical destinations the app already exposes.
 */
val HELP_LINKS: List<HelpLink> =
    listOf(
        HelpLink(
            id = "docs-status-api",
            webPath = "/docs/status-api",
            icon = HelpGlyphs.BookOpen,
            titleRes = R.string.translation_help_baseline_links_docsStatusApi_title,
            descRes = R.string.translation_help_baseline_links_docsStatusApi_description,
        ),
        HelpLink(
            id = "onboarding",
            webPath = "/onboarding",
            icon = HelpGlyphs.Rocket,
            titleRes = R.string.translation_help_baseline_links_onboarding_title,
            descRes = R.string.translation_help_baseline_links_onboarding_description,
        ),
        HelpLink(
            id = "system-status",
            webPath = "/system-status",
            icon = HelpGlyphs.ServerCog,
            titleRes = R.string.translation_help_baseline_links_systemStatus_title,
            descRes = R.string.translation_help_baseline_links_systemStatus_description,
        ),
        HelpLink(
            id = "search",
            webPath = "/search",
            icon = HelpGlyphs.Search,
            titleRes = R.string.translation_help_baseline_links_search_title,
            descRes = R.string.translation_help_baseline_links_search_description,
        ),
        HelpLink(
            id = "chatbot",
            webPath = "/chatbot",
            icon = HelpGlyphs.MessagesSquare,
            titleRes = R.string.translation_help_baseline_links_chatbot_title,
            descRes = R.string.translation_help_baseline_links_chatbot_description,
        ),
    )

/**
 * The immutable success surface the ViewModel exposes and the page renders — the resolved curated [links]. The
 * HelpPage has no API data source, so this content is static + always available; the model is still threaded through
 * the lifecycle-aware UiState the page collects so the surface follows the same state-holder contract every A7 page
 * uses.
 */
data class HelpContent(
    val links: List<HelpLink>,
)

/**
 * Build the in-app deep-link URI for a curated link's [webPath] — the native analogue of the web `<Link to={…}>`. No
 * NavController is exposed to page hosts, so the app's own `teslasync://app/{path}` scheme (AndroidManifest +
 * TeslaSyncNavHost) is the sanctioned forward-navigation seam, opened via `LocalUriHandler`.
 */
fun helpDeepLinkFor(webPath: String): String = "${RouteTable.APP_SCHEME}://app$webPath"
