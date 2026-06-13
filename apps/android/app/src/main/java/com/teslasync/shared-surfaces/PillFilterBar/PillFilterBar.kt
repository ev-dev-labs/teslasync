// The native Jetpack Compose + Material 3 PillFilterBar shared surface — a parity port of the web
// single-select filter row web/src/components/forms/PillFilterBar.tsx, together with the only hook it reads
// (React `useId`, bound through the P1/S8 [PillFilterBarIdSource] seam) and the integer formatter the count
// delegates to (web/src/lib/numberFormat.ts `fmtInt`).
//
// [PillFilterBar] is the stateful entry: it binds the [PillFilterBarViewModel] over the
// [PillFilterBarIdSource] seam (the `useId` boundary), records the one-shot `view.opened` diagnostic
// (P1/S11), reads the stable [PillFilterBarViewModel.tablistId], builds a [PillFilterBarInput] from its
// render parameters and projects it with the pure [PillFilterBarProjection.project]. [PillFilterBarContent]
// is the stateless renderer (the test / preview entry point) that paints the projected branch.
//
// The faithful mapping of the web behaviour:
//   * the empty-`items` outcome (web renders an empty `tablist`) → [PillFilterBarProjection.Empty], painted
//     as a friendly [EmptyState] so a panel is never a blank box (the P3 "every state renders" contract);
//   * the populated row (web `items.map`) → [PillFilterBarProjection.Resolved], a `selectableGroup` row of
//     pills, each a `Role.Tab` `selectable` carrying its selected / accent / disabled / icon / count branch;
//   * `variant="pills"` → [PillChip] (a rounded chip with an active accent fill + ring, a leading dot when
//     selected — web `ACCENT_PILL`); `variant="tabs"` → [PillTab] (a flat cell underlined by a bottom
//     border on the active item — web `ACCENT_TAB`), the row carrying the faint rail (web `border-b`);
//   * `scrollable` → `Modifier.horizontalScroll` (web `overflow-x-auto`);
//   * the six accents (cyan / green / amber / red / purple / blue) → the generated P1/S9 [TeslaTokens.chart]
//     named series (never a raw hex in the view), resolved by [pillAccentColor];
//   * the muted `({fmtInt(count)})` suffix → the projected [PillView.countText], rendered dimmed.
// The keyboard contract — web Arrow-Left / Right / Home / End moving focus + activation among the enabled
// pills — maps to the Android platform focus system: `selectableGroup` + each enabled pill being a focusable
// `selectable` lets D-pad / hardware-keyboard traversal move between pills and the centre / enter key
// activate the focused one, the Material idiom (so we do not hand-roll key handling the platform already
// owns). Disabled pills are non-focusable (web `disabled` → Compose `enabled = false`). Each pill speaks its
// label (+ count) with the `Tab` role and selected state; the icon + dot are decorative (web `aria-hidden`).
// The row announces the caller's localized `ariaLabel` (web `aria-label`). The bar's required strings are
// caller-supplied (the `ariaLabel`) or resolved from the P1/S10 catalog (the empty-state message); no
// English literal lives in shipped code paths.
//
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers and previews;
// `InvalidPackageDeclaration` because the mandated surface directory (com/teslasync/shared-surfaces/PillFilterBar)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pillfilterbar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Test tag identifying the rendered bar container — used by the instrumented per-state + a11y UI tests. */
const val PILL_FILTER_BAR_TEST_TAG: String = "pill-filter-bar"

/** Gap between pills — the native mirror of the web `gap-1.5` (6 px). */
private val PILL_GAP: Dp = 6.dp

/** Inner gap between a pill's dot / icon / label / count — the web per-item `gap-1.5`. */
private val PILL_INNER_GAP: Dp = 6.dp

/** Comfortable minimum chip height for the compact pills variant (web `py-1 text-xs`). */
private val PILL_MIN_HEIGHT: Dp = 30.dp

/** Horizontal chip padding — the web `px-3` (12 dp). */
private val PILL_H_PADDING: Dp = Spacing.md

/** Vertical chip padding for the pills variant — the web `py-1`. */
private val PILL_V_PADDING: Dp = Spacing.xs

/** Vertical cell padding for the tabs variant — the web `py-2`. */
private val TAB_V_PADDING: Dp = Spacing.sm

/** Active chip ring width — the web `ring-1`. */
private val PILL_RING_WIDTH: Dp = 1.dp

/** Selected-pill dot diameter — the web `h-1.5 w-1.5` (6 px). */
private val PILL_DOT_SIZE: Dp = 6.dp

/** Selected-tab underline + the row's faint rail thickness — the web `border-b-2` / `border-b`. */
private val TAB_INDICATOR_THICKNESS: Dp = 2.dp

/** Active chip fill opacity — the web `bg-{accent}-500/15`. */
private const val ACTIVE_FILL_ALPHA: Float = 0.15f

/** Active chip ring opacity — the web `ring-{accent}-400/40`. */
private const val ACTIVE_RING_ALPHA: Float = 0.40f

/** Dimming applied to a disabled pill — the web `opacity-40`. */
private const val DISABLED_ALPHA: Float = 0.40f

/** Count opacity on the selected pill — the web `opacity-80`. */
private const val COUNT_SELECTED_ALPHA: Float = 0.80f

/** Count opacity on an unselected pill — the web `opacity-60`. */
private const val COUNT_ALPHA: Float = 0.60f

/**
 * One pill descriptor — the public, Compose-aware analogue of the web `PillItem`. Carries the optional
 * leading [icon] as an [ImageVector] (the native form of the web `icon?: ReactNode`); the framework-free
 * fields are projected through [PillItemInput] / [PillView].
 *
 * @param key the stable identifier echoed to `onChange` (web `item.key`).
 * @param label the visible label (web `item.label`).
 * @param icon an optional decorative leading icon (web `item.icon`).
 * @param count an optional count rendered as the muted `(N)` suffix (web `item.count`).
 * @param accent the accent tint (web `item.accent`); defaults to [PillAccent.DEFAULT].
 * @param disabled when `true` the pill is non-interactive and dimmed (web `item.disabled`).
 */
data class PillFilterBarItem(
    val key: String,
    val label: String,
    val icon: ImageVector? = null,
    val count: Int? = null,
    val accent: PillAccent = PillAccent.DEFAULT,
    val disabled: Boolean = false,
)

private fun PillFilterBarItem.toInput(): PillItemInput =
    PillItemInput(key = key, label = label, count = count, accent = accent, disabled = disabled)

/**
 * Builds (and remembers) the production [PillFilterBarIdSource] — the `useId` seam. Remembered so the same
 * source (and therefore the same minted id) is reused across recompositions of one bar.
 */
@Composable
fun rememberPillFilterBarIdSource(): PillFilterBarIdSource = remember { ProcessPillFilterBarIdSource() }

/**
 * Stateful entry point bound to the shared id state holder — the faithful port of the web `PillFilterBar`.
 * Binds the [PillFilterBarViewModel], records the one-shot `view.opened` diagnostic (P1/S11), reads the
 * stable [PillFilterBarViewModel.tablistId] (web `useId`), and projects the caller's collection into the
 * branch [PillFilterBarContent] paints.
 *
 * @param items the controlled pill collection (web `items`).
 * @param activeKey the controlled selection (web `activeKey`).
 * @param onChange invoked with a pill's key when it is activated (web `onChange`).
 * @param ariaLabel the localized label announced for the row (web `ariaLabel`); resolved by the caller.
 * @param modifier optional layout modifier for the bar.
 * @param variant the pills (default) or tabs chrome (web `variant`).
 * @param scrollable allow horizontal overflow on small screens (web `scrollable`, default `true`).
 * @param testTag the container test tag (web `testId`); defaults to [PILL_FILTER_BAR_TEST_TAG].
 * @param idSource the `useId` seam; defaults to the process-backed production source.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun PillFilterBar(
    items: List<PillFilterBarItem>,
    activeKey: String,
    onChange: (String) -> Unit,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    variant: PillVariant = PillVariant.Pills,
    scrollable: Boolean = true,
    testTag: String = PILL_FILTER_BAR_TEST_TAG,
    idSource: PillFilterBarIdSource = rememberPillFilterBarIdSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: PillFilterBarViewModel =
        viewModel(
            key = PillFilterBarRegistration.ID,
            factory = PillFilterBarViewModel.factory(idSource, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val configuration = LocalConfiguration.current
    val locale = remember(configuration) { Locale.getDefault() }
    val projection =
        remember(items, activeKey, locale) {
            PillFilterBarProjection.project(
                input = PillFilterBarInput(items = items.map { it.toInput() }, activeKey = activeKey),
                locale = locale,
            )
        }
    PillFilterBarContent(
        projection = projection,
        ariaLabel = ariaLabel,
        variant = variant,
        scrollable = scrollable,
        tablistId = viewModel.tablistId,
        onChange = onChange,
        iconFor = { key -> items.firstOrNull { it.key == key }?.icon },
        modifier = modifier,
        testTag = testTag,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected branch: the friendly
 * empty surface, or the populated `selectableGroup` row. Every branch renders a non-blank surface (never a
 * hidden one) so the P3 "every state renders" contract holds.
 *
 * @param iconFor resolves a pill key to its optional leading icon (the [PillFilterBarItem.icon] carried by
 *   the stateful caller); the pure projection holds no Compose icon.
 */
@Composable
fun PillFilterBarContent(
    projection: PillFilterBarProjection,
    ariaLabel: String,
    variant: PillVariant,
    scrollable: Boolean,
    tablistId: String,
    onChange: (String) -> Unit,
    iconFor: (String) -> ImageVector?,
    modifier: Modifier = Modifier,
    testTag: String = PILL_FILTER_BAR_TEST_TAG,
) {
    when (projection) {
        is PillFilterBarProjection.Empty ->
            EmptyState(
                message = stringResource(R.string.translation_savedViews_emptyQuery),
                modifier = modifier.testTag(testTag),
            )

        is PillFilterBarProjection.Resolved ->
            PillFilterBarRow(
                pills = projection.pills,
                ariaLabel = ariaLabel,
                variant = variant,
                scrollable = scrollable,
                tablistId = tablistId,
                onChange = onChange,
                iconFor = iconFor,
                modifier = modifier.testTag(testTag),
            )
    }
}

/** The populated row — a `selectableGroup` of pills, scrollable on overflow, announcing [ariaLabel]. */
@Composable
private fun PillFilterBarRow(
    pills: List<PillView>,
    ariaLabel: String,
    variant: PillVariant,
    scrollable: Boolean,
    tablistId: String,
    onChange: (String) -> Unit,
    iconFor: (String) -> ImageVector?,
    modifier: Modifier = Modifier,
) {
    val railColor = MaterialTheme.colorScheme.outlineVariant
    val rowModifier =
        modifier
            .semantics { contentDescription = ariaLabel }
            .selectableGroup()
            .then(if (variant == PillVariant.Tabs) Modifier.bottomBorder(railColor, TAB_INDICATOR_THICKNESS) else Modifier)
            .then(if (scrollable) Modifier.horizontalScroll(rememberScrollState()) else Modifier)
    Row(
        modifier = rowModifier,
        horizontalArrangement = Arrangement.spacedBy(PILL_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        pills.forEach { pill ->
            when (variant) {
                PillVariant.Pills -> PillChip(pill = pill, tablistId = tablistId, icon = iconFor(pill.key), onChange = onChange)
                PillVariant.Tabs -> PillTab(pill = pill, tablistId = tablistId, icon = iconFor(pill.key), onChange = onChange)
            }
        }
    }
}

/**
 * The pills-variant chip — a rounded `selectable` (`Role.Tab`) with an active accent fill + ring and a
 * leading dot when selected (web `ACCENT_PILL`). The merged node speaks the label (+ count) with the tab
 * role + selected state; the dot + icon are decorative.
 */
@Composable
private fun PillChip(
    pill: PillView,
    tablistId: String,
    icon: ImageVector?,
    onChange: (String) -> Unit,
) {
    val accentColor = pillAccentColor(pill.accent)
    val contentColor = if (pill.selected) accentColor else MaterialTheme.colorScheme.onSurfaceVariant
    val fill = if (pill.selected) accentColor.copy(alpha = ACTIVE_FILL_ALPHA) else Color.Transparent
    val ring = if (pill.selected) accentColor.copy(alpha = ACTIVE_RING_ALPHA) else Color.Transparent
    Row(
        modifier =
            Modifier
                .minimumInteractiveComponentSize()
                .clip(CircleShape)
                .alpha(if (pill.disabled) DISABLED_ALPHA else 1f)
                .background(fill, CircleShape)
                .border(PILL_RING_WIDTH, ring, CircleShape)
                .selectable(selected = pill.selected, enabled = !pill.disabled, role = Role.Tab) { onChange(pill.key) }
                .semantics(mergeDescendants = true) {}
                .heightIn(min = PILL_MIN_HEIGHT)
                .padding(horizontal = PILL_H_PADDING, vertical = PILL_V_PADDING)
                .testTag(pillTabId(tablistId, pill.key)),
        horizontalArrangement = Arrangement.spacedBy(PILL_INNER_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (pill.selected) {
            PillDot(color = accentColor)
        }
        PillLeadingIcon(icon = icon, tint = contentColor)
        Text(text = pill.label, style = MaterialTheme.typography.labelMedium, color = contentColor)
        PillCount(countText = pill.countText, selected = pill.selected, baseColor = contentColor)
    }
}

/**
 * The tabs-variant cell — a flat `selectable` (`Role.Tab`) underlined by a bottom border on the active item
 * (web `ACCENT_TAB`). No dot (web shows the dot only for pills). The merged node speaks the label (+ count)
 * with the tab role + selected state.
 */
@Composable
private fun PillTab(
    pill: PillView,
    tablistId: String,
    icon: ImageVector?,
    onChange: (String) -> Unit,
) {
    val accentColor = pillAccentColor(pill.accent)
    val contentColor = if (pill.selected) accentColor else MaterialTheme.colorScheme.onSurfaceVariant
    val indicator = if (pill.selected) accentColor else Color.Transparent
    Row(
        modifier =
            Modifier
                .minimumInteractiveComponentSize()
                .alpha(if (pill.disabled) DISABLED_ALPHA else 1f)
                .selectable(selected = pill.selected, enabled = !pill.disabled, role = Role.Tab) { onChange(pill.key) }
                .semantics(mergeDescendants = true) {}
                .bottomBorder(indicator, TAB_INDICATOR_THICKNESS)
                .padding(horizontal = PILL_H_PADDING, vertical = TAB_V_PADDING)
                .testTag(pillTabId(tablistId, pill.key)),
        horizontalArrangement = Arrangement.spacedBy(PILL_INNER_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PillLeadingIcon(icon = icon, tint = contentColor)
        Text(text = pill.label, style = MaterialTheme.typography.labelLarge, color = contentColor)
        PillCount(countText = pill.countText, selected = pill.selected, baseColor = contentColor)
    }
}

/** The decorative leading icon (web `aria-hidden` icon span); nothing when the pill carries none. */
@Composable
private fun PillLeadingIcon(
    icon: ImageVector?,
    tint: Color,
) {
    if (icon != null) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = tint)
    }
}

/** The muted parenthesised count suffix (web `({fmtInt(count)})`); nothing when the pill carries none. */
@Composable
private fun PillCount(
    countText: String?,
    selected: Boolean,
    baseColor: Color,
) {
    if (countText != null) {
        Text(
            text = countText,
            style = MaterialTheme.typography.labelSmall,
            color = baseColor.copy(alpha = if (selected) COUNT_SELECTED_ALPHA else COUNT_ALPHA),
        )
    }
}

/** The selected-pill leading dot (web `ACCENT_PILL[accent].dot`) — a small filled circle, decorative. */
@Composable
private fun PillDot(color: Color) {
    Spacer(modifier = Modifier.size(PILL_DOT_SIZE).clip(CircleShape).background(color))
}

/**
 * Maps a [PillAccent] onto a per-app design token (P1/S9) — the native mirror of the web accent palette,
 * drawn from the generated [TeslaTokens.chart] named series so the view never carries a raw hex and every
 * accent matches the brand spectrum: cyan→regen, green→battery, amber→energy, red→temperature, blue→speed,
 * purple→power.
 */
private fun pillAccentColor(accent: PillAccent): Color =
    when (accent) {
        PillAccent.Cyan -> TeslaTokens.chart.regen
        PillAccent.Green -> TeslaTokens.chart.battery
        PillAccent.Amber -> TeslaTokens.chart.energy
        PillAccent.Red -> TeslaTokens.chart.temperature
        PillAccent.Purple -> TeslaTokens.chart.power
        PillAccent.Blue -> TeslaTokens.chart.speed
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

// ── Previews (tooling-only; sample items are never shipped UI) ───────────────────────────────────────

private val PREVIEW_ITEMS: List<PillView> =
    listOf(
        PillView(key = "all", label = "All", countText = "(128)", accent = PillAccent.Cyan, selected = true, disabled = false),
        PillView(key = "anomalies", label = "Anomalies", countText = "(4)", accent = PillAccent.Red, selected = false, disabled = false),
        PillView(key = "notable", label = "Notable", countText = "(12)", accent = PillAccent.Purple, selected = false, disabled = false),
        PillView(key = "archived", label = "Archived", countText = null, accent = PillAccent.Green, selected = false, disabled = true),
    )

@Composable
private fun previewBar(
    projection: PillFilterBarProjection,
    variant: PillVariant,
) {
    PillFilterBarContent(
        projection = projection,
        ariaLabel = "Filter drives",
        variant = variant,
        scrollable = true,
        tablistId = "preview",
        onChange = {},
        iconFor = { null },
    )
}

@Preview(name = "PillFilterBar — pills", showBackground = true)
@Composable
private fun PillFilterBarPillsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewBar(PillFilterBarProjection.Resolved(PREVIEW_ITEMS), PillVariant.Pills)
    }
}

@Preview(name = "PillFilterBar — tabs (dark)", showBackground = true)
@Composable
private fun PillFilterBarTabsPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        previewBar(PillFilterBarProjection.Resolved(PREVIEW_ITEMS), PillVariant.Tabs)
    }
}

@Preview(name = "PillFilterBar — empty", showBackground = true)
@Composable
private fun PillFilterBarEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        previewBar(PillFilterBarProjection.Empty, PillVariant.Pills)
    }
}
