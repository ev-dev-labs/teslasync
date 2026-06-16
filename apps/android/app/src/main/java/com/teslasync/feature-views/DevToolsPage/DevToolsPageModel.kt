// Pure, framework-free model for the DevToolsPage feature view — the native analogue of the small amount of
// state the web page derives before it returns JSX (web/src/features/admin/pages/DevToolsPage.tsx, the thin
// tabbed Developer Tools shell). No Compose, no Android, no HTTP lives here, so every type is exercised
// off-device in the :android:testDebugUnitTest gate and the composable stays a thin render layer.
//
// The web page is a tab container: `usePageTitle(t('devtools.title'))`, a `<PageContainer title subtitle>`
// header, and a `<TabNav>` switching the five `TABS` (Fleet API / Telemetry / Infrastructure / Utilities /
// Reference) whose selection it persists in the URL via `useUrlEnum('tab', TAB_KEYS, 'fleet-api')`. This
// file owns the canonical pieces of that shell: the ordered [DevToolsTab] catalog with the stable keys the
// web persists, the default-tab + key-resolution rules (web `useUrlEnum` fallback), the diagnostics SLUG,
// and the PII-safe `view.opened` emitter. The page renders no data, so there is no parser / projection /
// UiState here — only the deterministic shell contract the unit test pins.
//
// i18n note (web parity): the title + subtitle are the two manifest parity strings and resolve through the
// generated catalog (`devtools.title` -> R.string.translation_devtools_title, `devtools.subtitle` ->
// translation_devtools_subtitle), applied at the render boundary in DevToolsPage.kt. The tab labels are
// hardcoded English in the web `TABS` constant (not `t()` calls); to honour ADR-014 (zero hardcoded
// literals) the native port routes each one through a catalog key (translation_devtools_tab_*) resolved in
// the composable, so the framework-free catalog here carries only the stable, locale-independent tab keys.
//
// `MatchingDeclarationName` is suppressed for the co-located enum + helper; `InvalidPackageDeclaration`
// because the mandated surface directory (com/teslasync/feature-views/DevToolsPage) cannot form a valid
// Kotlin package identifier (a hyphen and PascalCase segments are illegal), so the package diverges from
// the path — the same divergence every sibling feature view declares.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.devtoolspage

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for this surface. The web page is a top-level route, not a draggable dashboard widget,
 * so there is no web registry row to mirror — this object carries only the cross-cutting concern every
 * surface owes the diagnostics contract (P1/S11): the surface [SLUG] emitted with the one-shot `view.opened`
 * event. It doubles as the canonical navigation id for the surface (web route `/dev-tools`).
 */
object DevToolsPageRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DevToolsPage"
}

/**
 * The five dev-tools sections, in the exact web order (web `TABS` / `TAB_KEYS`). [key] is the stable,
 * locale-independent identifier the web persists in the URL (`?tab=`) and the native tab strip echoes back
 * through its `onSelect` callback — kept byte-identical to the web keys so deep links stay compatible.
 */
enum class DevToolsTab(
    val key: String,
) {
    FleetApi("fleet-api"),
    Telemetry("telemetry"),
    Infrastructure("infrastructure"),
    Utilities("utilities"),
    Reference("reference"),
    ;

    companion object {
        /** The initially selected tab (web `DEFAULT_TAB = 'fleet-api'`). */
        val DEFAULT: DevToolsTab = FleetApi

        /**
         * Resolves a persisted [key] to its tab, falling back to [DEFAULT] for an unknown or `null` key —
         * the native analogue of the web `useUrlEnum(TAB_KEY, TAB_KEYS, DEFAULT_TAB)` clamp that ignores
         * any `?tab=` value outside the enum.
         */
        fun fromKey(key: String?): DevToolsTab = entries.firstOrNull { it.key == key } ?: DEFAULT
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). The event carries no
 * payload beyond the slug — this surface reads no vehicle or activity data, so the line can never leak
 * anything. Invoked once from the composable's first-composition effect (via the view-model).
 */
fun recordDevToolsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DevToolsPageRegistration.SLUG))
}
