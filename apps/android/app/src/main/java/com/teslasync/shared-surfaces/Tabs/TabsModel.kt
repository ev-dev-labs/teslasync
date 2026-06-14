// Pure, framework-free model + projection + keyboard-navigation logic + diagnostics for the Tabs shared
// surface — the native analogue of every decision the web component makes (web/src/components/ui/Tabs.tsx)
// together with the only hook it reads (React `useId`, bound through the P1/S8 [TabsIdSource] seam in
// TabsSource.kt). No Compose, no Android framework, no HTTP: every declaration here is exercised off-device
// in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): `Tabs` is an
// accessible tab strip implementing the WAI-ARIA Tabs pattern — a `role="tablist"` whose `role="tab"`
// buttons switch a "pick one" selection. The PARENT owns the data: it passes the immutable `tabs`, the
// controlled `activeTab`, and an `onChange` callback; the component itself fetches nothing and does NOT own
// the tab panels (consumers render those with `aria-labelledby` pointing back at each tab's id). Its single
// hook is `useId`, used purely to mint the stable per-tab element ids (`${tablistId}-tab-${key}` and
// `${tablistId}-panel-${key}`). Its real decisions, all reproduced here:
//   * each tab resolves `selected = activeTab === tab.key` and a `disabled` flag — reduced into [TabView];
//   * the keyboard contract — ArrowLeft / ArrowRight move focus + activation between the ENABLED tabs with
//     wrap-around, Home / End jump to the first / last enabled tab, and DISABLED tabs are skipped — is the
//     distinctive logic of the web `handleKeyDown`; it is reproduced verbatim (and unit-tested) by
//     [enabledTabKeys] + [nextTabKey] so the composable's key handler is a thin wiring layer over tested math;
//   * the per-tab / per-panel element ids are `${tablistId}-tab-${key}` / `${tablistId}-panel-${key}` —
//     reproduced by [tabElementId] / [tabPanelId].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface is PURE PRESENTATIONAL — it renders the controlled collection the parent already holds and fetches
// nothing, so it never loads, errors, goes stale or goes offline. Modelling those would fabricate behaviour
// the web spec does not have (Honesty Covenant: no scope narrowing, no silent drift) — the same rationale the
// accepted sibling presentational ports Accordion / PillFilterBar document. Its REAL, fully reproduced states
// are the populated strip ([TabsProjection.Resolved], every per-tab branch: selected / unselected, enabled /
// disabled) and the no-tabs branch ([TabsProjection.Empty]). The web renders an empty `tablist` when `tabs`
// is empty; the native port resolves that to a friendly empty surface so a panel is never a blank box (the P3
// "every state renders" contract).
//
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations; `InvalidPackageDeclaration`
// because the mandated surface directory (com/teslasync/shared-surfaces/Tabs — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package
// identifier), so the package intentionally diverges from the path — exactly as the sibling shared surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the Tabs surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Tabs`); [ID] is the stable
 * `viewModel` key the host binds the strip with.
 */
object TabsRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the tab strip with). */
    const val ID: String = "tabs"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Tabs"
}

/**
 * A keyboard move requested from a focused tab — the native tag for the web `handleKeyDown` branches.
 * [Previous] / [Next] are the wrap-around ArrowLeft / ArrowRight steps among the enabled tabs; [First] /
 * [Last] are the Home / End jumps. Kept framework-free so the resolution is unit-tested without a host.
 */
enum class TabMove {
    /** Web `ArrowLeft` — the previous enabled tab, wrapping past the first to the last. */
    Previous,

    /** Web `ArrowRight` — the next enabled tab, wrapping past the last to the first. */
    Next,

    /** Web `Home` — the first enabled tab. */
    First,

    /** Web `End` — the last enabled tab. */
    Last,
}

/**
 * The framework-free fields of one tab — the native analogue of the web `TabItem`. The Compose-aware public
 * form is [io.teslasync.android.sharedsurfaces.tabs.TabItem]; this is the value the projection consumes.
 *
 * @property key the stable identifier echoed to `onChange` (web `tab.key`).
 * @property label the visible label (web `tab.label`).
 * @property disabled when `true` the tab is non-interactive, dimmed, and skipped by arrow navigation
 *   (web `tab.disabled`).
 */
data class TabItemInput(
    val key: String,
    val label: String,
    val disabled: Boolean = false,
)

/**
 * The caller-supplied inputs the projection consumes — the framework-free analogue of the web `TabsProps`
 * fields that drive the per-tab data. [tabs] is the controlled collection and [activeKey] the controlled
 * selection (web `activeTab`). The presentational flags (`scrollable`, `ariaLabel`) are render-only and stay
 * on the composable, never entering the projection.
 */
data class TabsInput(
    val tabs: List<TabItemInput>,
    val activeKey: String,
)

/**
 * The fully reduced, render-ready projection of one tab — everything the composable needs to paint a single
 * tab, derived purely so every branch is covered off-device.
 *
 * @property key the tab's stable id (web `tab.key`); echoed to `onChange` on click.
 * @property label the visible label (web `{tab.label}`).
 * @property selected whether this tab is the active one (web `activeTab === tab.key`).
 * @property disabled whether this tab is non-interactive (web `tab.disabled`).
 */
data class TabView(
    val key: String,
    val label: String,
    val selected: Boolean,
    val disabled: Boolean,
)

/**
 * The projected render state the strip paints — the native analogue of the web component's two real render
 * outcomes. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface TabsProjection {
    /**
     * The web empty-`tabs` outcome. The web renders an empty `tablist`; the native port resolves it to a
     * friendly empty surface (the P3 "never a blank box" contract).
     */
    data object Empty : TabsProjection

    /**
     * The populated strip — one [TabView] per tab, in source order, each carrying its selected / disabled
     * branch (web maps `tabs.map(...)`).
     */
    data class Resolved(
        val tabs: List<TabView>,
    ) : TabsProjection

    companion object {
        /**
         * Projects [input] into the branch the composable paints — the native mirror of everything the web
         * `Tabs` decides before its returned JSX. An empty collection renders [Empty]; otherwise every tab is
         * reduced into a [TabView] (web `tabs.map`), preserving source order so arrow navigation and visual
         * order match.
         */
        fun project(input: TabsInput): TabsProjection =
            if (input.tabs.isEmpty()) {
                Empty
            } else {
                Resolved(input.tabs.map { toTabView(it, input.activeKey) })
            }

        private fun toTabView(
            item: TabItemInput,
            activeKey: String,
        ): TabView =
            TabView(
                key = item.key,
                label = item.label,
                selected = activeKey == item.key,
                disabled = item.disabled,
            )
    }
}

/**
 * The keys of the enabled tabs in source order — the native mirror of the web
 * `enabledKeys = tabs.filter(t => !t.disabled).map(t => t.key)`. Arrow navigation walks only these, so a
 * disabled tab is never a focus/activation target.
 */
fun enabledTabKeys(tabs: List<TabItemInput>): List<String> = tabs.filterNot { it.disabled }.map { it.key }

/**
 * Resolves the key a keyboard [move] from [currentKey] should move focus + activation to — the native mirror
 * of the web `handleKeyDown` math over [enabledKeys]. [TabMove.Next] / [TabMove.Previous] step with
 * wrap-around (web `(idx + delta + len) % len`); [TabMove.First] / [TabMove.Last] jump to the ends (web Home /
 * End). Returns `null` when there is nothing to move to: no enabled tabs (web `if (enabledKeys.length === 0)
 * return`) or a [currentKey] that is not itself enabled (web `if (idx === -1) return`). Pure, so the whole
 * keyboard contract is unit-tested without a Compose host.
 */
fun nextTabKey(
    enabledKeys: List<String>,
    currentKey: String,
    move: TabMove,
): String? =
    when {
        enabledKeys.isEmpty() -> null
        move == TabMove.First -> enabledKeys.first()
        move == TabMove.Last -> enabledKeys.last()
        else -> stepEnabledKey(enabledKeys, currentKey, forward = move == TabMove.Next)
    }

/** One wrap-around step among [enabledKeys] from [currentKey] — web `(idx + delta + len) % len`. */
private fun stepEnabledKey(
    enabledKeys: List<String>,
    currentKey: String,
    forward: Boolean,
): String? {
    val idx = enabledKeys.indexOf(currentKey)
    return if (idx == -1) {
        null
    } else {
        val delta = if (forward) 1 else -1
        enabledKeys[(idx + delta + enabledKeys.size) % enabledKeys.size]
    }
}

/**
 * Composes the stable per-tab element id — the native mirror of the web `${tablistId}-tab-${tab.key}`.
 * [tablistId] is the value minted by the `useId` seam (P1/S8); the composable uses the result as each tab's
 * test / semantics tag so assistive tech and instrumented tests can address a single tab.
 */
fun tabElementId(
    tablistId: String,
    key: String,
): String = "$tablistId-tab-$key"

/**
 * Composes the stable per-panel id a consumer's `tabpanel` references — the native mirror of the web
 * `${tablistId}-panel-${tab.key}` (the `aria-controls` target). The surface does not own the panels (web: the
 * consumer renders them), so this is exposed for callers that wire a panel back to its tab.
 */
fun tabPanelId(
    tablistId: String,
    key: String,
): String = "$tablistId-panel-$key"

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [TabsRegistration.SLUG] (P1/S11)
 * — never a tab key or label, so a diagnostics line can never leak what a user is viewing. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordTabsOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TabsRegistration.SLUG))
}
