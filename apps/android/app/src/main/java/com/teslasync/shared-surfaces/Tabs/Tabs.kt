// The native Jetpack Compose + Material 3 Tabs shared surface — a parity port of the accessible tab strip
// web/src/components/ui/Tabs.tsx, together with the only hook it reads (React `useId`, bound through the P1/S8
// [TabsIdSource] seam).
//
// [Tabs] is the stateful entry: it binds the [TabsViewModel] over the [TabsIdSource] seam (the `useId`
// boundary), records the one-shot `view.opened` diagnostic (P1/S11), reads the stable
// [TabsViewModel.tablistId], builds a [TabsInput] from its render parameters and projects it with the pure
// [TabsProjection.project]. [TabsContent] is the stateless renderer (the test / preview entry point) that
// paints the projected branch.
//
// The faithful mapping of the web behaviour:
//   * the empty-`tabs` outcome (web renders an empty `tablist`) → [TabsProjection.Empty], painted as a
//     friendly [EmptyState] so a panel is never a blank box (the P3 "every state renders" contract);
//   * the populated strip (web `tabs.map`) → [TabsProjection.Resolved], a `selectableGroup` row of tabs, each
//     a `Role.Tab` `selectable` carrying its selected / disabled branch and underlined by a bottom border on
//     the active item (web `border-b-2 border-blue-600`); the row carries the faint rail (web `border-b`);
//   * `scrollable` → `Modifier.horizontalScroll` so a long strip overflows gracefully on small screens;
//   * the accent (web `blue-600` / dark `blue-400`) → the Material `primary` scheme colour, so the active tab
//     and indicator stay correct across light / dark / high-contrast themes (never a raw hex in the view);
//   * a disabled tab (web `opacity-50 cursor-not-allowed`) → `enabled = false` (non-interactive,
//     non-focusable) + a dimmed `alpha`.
// The keyboard contract — web ArrowLeft / ArrowRight moving focus + activation among the ENABLED tabs with
// wrap-around, Home / End jumping to the first / last enabled tab, disabled tabs skipped — is reproduced
// faithfully: each tab is a focusable `selectable` (so D-pad / hardware-keyboard traversal + centre/Enter
// activation work via the platform focus system, the Material idiom) AND carries an [onKeyEvent] roving layer
// that, on an arrow / Home / End key, resolves the next key through the unit-tested [nextTabKey] and moves
// activation (`onChange`) + focus there — the web `moveFocus`. Disabled tabs are non-focusable (web `disabled`
// → Compose `enabled = false`), so navigation skips them. Each tab speaks its label with the `Tab` role and
// selected state; the row announces the caller's localized `ariaLabel` (web `aria-label`) when one is given.
// The only string the surface itself renders is the empty-state message, resolved from the P1/S10 catalog; no
// English literal lives in shipped code paths.
//
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers and previews;
// `InvalidPackageDeclaration` because the mandated surface directory (com/teslasync/shared-surfaces/Tabs)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered strip container — used by the instrumented per-state + a11y UI tests. */
const val TABS_TEST_TAG: String = "tabs"

/** Fallback tablist id for the stateless [TabsContent] (previews / tests); production passes the minted id. */
private const val DEFAULT_TABLIST_ID: String = "tabs"

/** Gap between tabs — the native mirror of the web `gap-1` (4 dp). */
private val TAB_GAP: Dp = Spacing.xs

/** Horizontal tab padding — the web `px-4` (16 dp). */
private val TAB_H_PADDING: Dp = Spacing.lg

/** Vertical tab padding — the web `py-2` (8 dp). */
private val TAB_V_PADDING: Dp = Spacing.sm

/** Selected-tab underline thickness — the web `border-b-2`. */
private val TAB_INDICATOR_THICKNESS: Dp = 2.dp

/** The strip's faint full-width rail thickness — the web `border-b` on the tablist container. */
private val TAB_RAIL_THICKNESS: Dp = 1.dp

/** Dimming applied to a disabled tab — the web `opacity-50`. */
private const val DISABLED_ALPHA: Float = 0.5f

/**
 * One tab descriptor — the public, Compose-aware analogue of the web `TabItem`. The framework-free fields are
 * projected through [TabItemInput] / [TabView].
 *
 * @param key the stable identifier echoed to `onChange` (web `tab.key`).
 * @param label the visible label (web `tab.label`); already localized by the caller.
 * @param disabled when `true` the tab is non-interactive, dimmed, and skipped by arrow navigation
 *   (web `tab.disabled`).
 */
data class TabItem(
    val key: String,
    val label: String,
    val disabled: Boolean = false,
)

private fun TabItem.toInput(): TabItemInput = TabItemInput(key = key, label = label, disabled = disabled)

/**
 * Builds (and remembers) the production [TabsIdSource] — the `useId` seam. Remembered so the same source (and
 * therefore the same minted id) is reused across recompositions of one strip.
 */
@Composable
fun rememberTabsIdSource(): TabsIdSource = remember { ProcessTabsIdSource() }

/**
 * Stateful entry point bound to the shared id state holder — the faithful port of the web `Tabs`. Binds the
 * [TabsViewModel], records the one-shot `view.opened` diagnostic (P1/S11), reads the stable
 * [TabsViewModel.tablistId] (web `useId`), and projects the caller's collection into the branch [TabsContent]
 * paints.
 *
 * @param tabs the controlled tab collection (web `tabs`).
 * @param activeTab the controlled selection (web `activeTab`).
 * @param onChange invoked with a tab's key when it is activated (web `onChange`).
 * @param modifier optional layout modifier for the strip.
 * @param ariaLabel the localized label announced for the tablist (web `ariaLabel`); resolved by the caller.
 * @param scrollable allow horizontal overflow on small screens (default `true`).
 * @param testTag the container test tag; defaults to [TABS_TEST_TAG].
 * @param idSource the `useId` seam; defaults to the process-backed production source.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun Tabs(
    tabs: List<TabItem>,
    activeTab: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    ariaLabel: String? = null,
    scrollable: Boolean = true,
    testTag: String = TABS_TEST_TAG,
    idSource: TabsIdSource = rememberTabsIdSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TabsViewModel =
        viewModel(
            key = TabsRegistration.ID,
            factory = TabsViewModel.factory(idSource, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val projection =
        remember(tabs, activeTab) {
            TabsProjection.project(TabsInput(tabs = tabs.map { it.toInput() }, activeKey = activeTab))
        }
    TabsContent(
        projection = projection,
        onChange = onChange,
        modifier = modifier,
        ariaLabel = ariaLabel,
        scrollable = scrollable,
        tablistId = viewModel.tablistId,
        testTag = testTag,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected branch: the friendly
 * empty surface, or the populated `selectableGroup` strip. Every branch renders a non-blank surface (never a
 * hidden one) so the P3 "every state renders" contract holds.
 */
@Composable
fun TabsContent(
    projection: TabsProjection,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    ariaLabel: String? = null,
    scrollable: Boolean = true,
    tablistId: String = DEFAULT_TABLIST_ID,
    testTag: String = TABS_TEST_TAG,
) {
    when (projection) {
        is TabsProjection.Empty ->
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                modifier = modifier.testTag(testTag),
            )

        is TabsProjection.Resolved ->
            TabsRow(
                tabs = projection.tabs,
                onChange = onChange,
                ariaLabel = ariaLabel,
                scrollable = scrollable,
                tablistId = tablistId,
                modifier = modifier.testTag(testTag),
            )
    }
}

/** The populated strip — a `selectableGroup` of tabs, scrollable on overflow, announcing [ariaLabel]. */
@Composable
private fun TabsRow(
    tabs: List<TabView>,
    onChange: (String) -> Unit,
    ariaLabel: String?,
    scrollable: Boolean,
    tablistId: String,
    modifier: Modifier = Modifier,
) {
    val railColor = MaterialTheme.colorScheme.outlineVariant
    val tabKeys = remember(tabs) { tabs.map { it.key } }
    val enabledKeys = remember(tabs) { enabledTabKeys(tabs.map { TabItemInput(it.key, it.label, it.disabled) }) }
    // One FocusRequester per tab key for the roving-focus contract (web `refs` map); keyed on the stable keys
    // so a selection change (which rebuilds the TabView list) never churns the requesters.
    val focusRequesters = remember(tabKeys) { tabKeys.associateWith { FocusRequester() } }

    val rowModifier =
        modifier
            .then(if (ariaLabel != null) Modifier.semantics { contentDescription = ariaLabel } else Modifier)
            .selectableGroup()
            .bottomBorder(railColor, TAB_RAIL_THICKNESS)
            .then(if (scrollable) Modifier.horizontalScroll(rememberScrollState()) else Modifier)
    Row(
        modifier = rowModifier,
        horizontalArrangement = Arrangement.spacedBy(TAB_GAP),
        verticalAlignment = Alignment.Bottom,
    ) {
        tabs.forEach { tab ->
            TabButton(
                tab = tab,
                tablistId = tablistId,
                focusRequester = focusRequesters.getValue(tab.key),
                onChange = onChange,
                onMove = { move ->
                    val nextKey = nextTabKey(enabledKeys, tab.key, move)
                    if (nextKey != null) {
                        onChange(nextKey)
                        focusRequesters[nextKey]?.requestFocus()
                    }
                },
            )
        }
    }
}

/**
 * One tab cell — a flat `selectable` (`Role.Tab`) underlined by a bottom border on the active item (web
 * `border-b-2 border-blue-600`). The merged node speaks the label with the tab role + selected state; the
 * [onKeyEvent] layer turns arrow / Home / End into a roving [onMove] (web `handleKeyDown`). A disabled tab is
 * non-interactive (`enabled = false`) and dimmed.
 */
@Composable
private fun TabButton(
    tab: TabView,
    tablistId: String,
    focusRequester: FocusRequester,
    onChange: (String) -> Unit,
    onMove: (TabMove) -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    val contentColor = if (tab.selected) accent else MaterialTheme.colorScheme.onSurfaceVariant
    val indicator = if (tab.selected) accent else Color.Transparent
    Row(
        modifier =
            Modifier
                .minimumInteractiveComponentSize()
                .alpha(if (tab.disabled) DISABLED_ALPHA else 1f)
                .focusRequester(focusRequester)
                .onKeyEvent { event -> handleTabKeyEvent(event, onMove) }
                .selectable(selected = tab.selected, enabled = !tab.disabled, role = Role.Tab) { onChange(tab.key) }
                .semantics(mergeDescendants = true) {}
                .bottomBorder(indicator, TAB_INDICATOR_THICKNESS)
                .padding(horizontal = TAB_H_PADDING, vertical = TAB_V_PADDING)
                .testTag(tabElementId(tablistId, tab.key)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = tab.label,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
            color = contentColor,
        )
    }
}

/**
 * Turns a hardware-key / D-pad event into a roving [onMove], reproducing the web `handleKeyDown`. Only key-down
 * events for the four navigation keys are consumed (returns `true`); everything else falls through to the
 * platform (returns `false`). Activation on the focused tab is owned by `selectable` (centre / Enter).
 */
private fun handleTabKeyEvent(
    event: KeyEvent,
    onMove: (TabMove) -> Unit,
): Boolean {
    val move = if (event.type == KeyEventType.KeyDown) keyToMove(event.key) else null
    return if (move != null) {
        onMove(move)
        true
    } else {
        false
    }
}

/** Maps a navigation [key] to its [TabMove] — web ArrowLeft/Right + Home/End; any other key yields `null`. */
private fun keyToMove(key: Key): TabMove? =
    when (key) {
        Key.DirectionLeft -> TabMove.Previous
        Key.DirectionRight -> TabMove.Next
        Key.MoveHome -> TabMove.First
        Key.MoveEnd -> TabMove.Last
        else -> null
    }

/** Draws a [thickness] line along the node's bottom edge in [color] — the web `border-b` / `border-b-2`. */
private fun Modifier.bottomBorder(
    color: Color,
    thickness: Dp,
): Modifier =
    drawBehind {
        val stroke = thickness.toPx()
        val y = size.height - stroke / 2f
        drawLine(color = color, start = Offset(0f, y), end = Offset(size.width, y), strokeWidth = stroke)
    }

// ── Previews (tooling-only; sample tabs are never shipped UI) ─────────────────────────────────────────

private val PREVIEW_TABS: List<TabView> =
    listOf(
        TabView(key = "overview", label = "Overview", selected = true, disabled = false),
        TabView(key = "battery", label = "Battery", selected = false, disabled = false),
        TabView(key = "charging", label = "Charging", selected = false, disabled = false),
        TabView(key = "history", label = "History", selected = false, disabled = true),
    )

@Composable
private fun previewStrip(projection: TabsProjection) {
    TabsContent(
        projection = projection,
        onChange = {},
        ariaLabel = "Vehicle sections",
        scrollable = true,
        tablistId = "preview",
    )
}

@Preview(name = "Tabs · resolved", showBackground = true)
@Composable
private fun TabsResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewStrip(TabsProjection.Resolved(PREVIEW_TABS))
    }
}

@Preview(name = "Tabs · resolved (dark)", showBackground = true)
@Composable
private fun TabsResolvedDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        previewStrip(TabsProjection.Resolved(PREVIEW_TABS))
    }
}

@Preview(name = "Tabs · empty", showBackground = true)
@Composable
private fun TabsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewStrip(TabsProjection.Empty)
    }
}
