// The native Jetpack Compose + Material 3 ActiveFilterChips shared surface — a parity port of
// web/src/components/forms/ActiveFilterChips.tsx. The web surface is a controlled, presentational summary of the
// active list-page filters: one chip per filter ("Vehicle: Model 3 ×"), an optional "Clear all" affordance, a
// "+N more" overflow popover for long lists, and a polite a11y live region that announces removals. It renders
// nothing when there are no active filters (unless a host opts out via hideWhenEmpty), so a consumer can mount it
// unconditionally beneath a filter bar.
//
// All interaction flows through the shared [ActiveFilterChipsViewModel] (P1/S8): the overflow-open flag, the
// collapse-on-empty effect, and the live-region announcer round-trip live there, never in the view. Every visible
// string resolves through the i18n catalog (P1/S10) and every interactive element carries a TalkBack label. The
// atomic chrome (Surface, Button, IconButton, Popover) is reused from the shared component library; this surface
// only composes them — no web Tailwind classes, platform design tokens only (P1/S9).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content /
// error / stale / offline contract is mapped onto this controlled surface's real behaviour, because it performs
// no data fetch (see ActiveFilterChipsModel.kt). `empty` is the web `hideWhenEmpty && isEmpty` early return
// ([ChipsSurface.Hidden]) or, when a host keeps the slot, an empty labelled group + live region; `content` is the
// chip group; loading / error / stale / offline have no web branch (the parent page owns URL-state + any fetch).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activefilterchips

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * One active-filter chip the surface renders — the native analogue of the web `FilterChipDescriptor`.
 *
 * @property key stable id used as the render key, ideally the URL search-param name (web `key`).
 * @property label the already-translated field name, e.g. "Vehicle" (web `label`).
 * @property value the user-facing value, e.g. "Model 3" (web `value`).
 * @property onRemove deletes the underlying filter (commonly clears the URL param); the page owns URL rewriting
 *   so chips stay a pure presentation surface (web `onRemove`).
 */
data class FilterChipDescriptor(
    val key: String,
    val label: String,
    val value: String,
    val onRemove: () -> Unit,
)

/**
 * Stateful entry point — the faithful port of the web `ActiveFilterChips`. Binds the overflow-popover state + the
 * live-region announcer through an [ActiveFilterChipsViewModel], records the one-shot `view.opened` diagnostic,
 * keeps the popover collapsed once the filters empty, and renders the chip group. The surface performs no
 * business logic; [logger] defaults to the process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param filters the active filters to summarize, in order (web `filters`).
 * @param onClearAll when provided, renders a "Clear all" affordance after the chips (web `onClearAll`).
 * @param hideWhenEmpty when true (default) the surface renders nothing with no active filters (web `hideWhenEmpty`).
 * @param maxVisible inline chip budget before the tail collapses into "+N more" (web `maxVisible`).
 */
@Composable
fun ActiveFilterChips(
    filters: List<FilterChipDescriptor>,
    modifier: Modifier = Modifier,
    onClearAll: (() -> Unit)? = null,
    hideWhenEmpty: Boolean = DEFAULT_HIDE_WHEN_EMPTY,
    maxVisible: Int = DEFAULT_MAX_VISIBLE,
    announcer: FilterAnnouncer = remember { filterAnnouncer() },
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ACTIVE_FILTER_CHIPS_SLUG,
) {
    val viewModel: ActiveFilterChipsViewModel =
        viewModel(key = instanceKey, factory = ActiveFilterChipsViewModel.factory(announcer, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, filters.size) { viewModel.syncFilterCount(filters.size) }
    val overflowOpen by viewModel.overflowOpen.collectAsStateWithLifecycle()
    val announcement by viewModel.announcement.collectAsStateWithLifecycle()

    val removedPrefix = stringResource(R.string.translation_filters_removed)
    val clearedAllMessage = stringResource(R.string.translation_filters_clearedAll)

    ActiveFilterChipsContent(
        filters = filters,
        hideWhenEmpty = hideWhenEmpty,
        maxVisible = maxVisible,
        overflowOpen = overflowOpen,
        announcement = announcement,
        onRemove = { descriptor ->
            viewModel.announce("$removedPrefix: ${descriptor.label}")
            descriptor.onRemove()
        },
        onClearAll =
            onClearAll?.let { clear ->
                {
                    viewModel.announce(clearedAllMessage)
                    clear()
                }
            },
        onToggleOverflow = viewModel::toggleOverflow,
        onOverflowDismiss = { viewModel.setOverflowOpen(false) },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/preview entry point. Classifies the filters into a [ChipsSurface] and renders the
 * labelled chip group plus the optional overflow popover, "Clear all" affordance, and polite live region, or
 * renders nothing when [hideWhenEmpty] and there are no filters (web `hideWhenEmpty && isEmpty` early return).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ActiveFilterChipsContent(
    filters: List<FilterChipDescriptor>,
    hideWhenEmpty: Boolean,
    maxVisible: Int,
    overflowOpen: Boolean,
    announcement: String,
    onRemove: (FilterChipDescriptor) -> Unit,
    onClearAll: (() -> Unit)?,
    onToggleOverflow: () -> Unit,
    onOverflowDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (chipsSurface(filters.size, hideWhenEmpty) is ChipsSurface.Hidden) return

    val partition = remember(filters, maxVisible) { partitionChips(filters, maxVisible) }
    val groupLabel = stringResource(R.string.translation_filters_activeLabel)

    Box(modifier = modifier) {
        FlowRow(
            modifier = Modifier.semantics { contentDescription = groupLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            partition.visible.forEach { descriptor ->
                FilterChip(descriptor = descriptor, onRemove = onRemove)
            }
            if (partition.overflow.isNotEmpty()) {
                OverflowChips(
                    overflow = partition.overflow,
                    expanded = overflowOpen,
                    onToggle = onToggleOverflow,
                    onDismiss = onOverflowDismiss,
                    onRemove = onRemove,
                )
            }
            if (onClearAll != null && filters.isNotEmpty()) {
                Button(
                    label = stringResource(R.string.translation_filters_clearAll),
                    onClick = onClearAll,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
        Announcer(text = announcement)
    }
}

/**
 * One filter chip — a pill carrying "{label}: {value}" and a remove affordance with a TalkBack "Remove filter
 * {label}" label (web `<Chip>`). [fillWidth] stretches the chip and justifies its content for the overflow
 * popover rows (web `fullWidth`).
 */
@Composable
private fun FilterChip(
    descriptor: FilterChipDescriptor,
    onRemove: (FilterChipDescriptor) -> Unit,
    modifier: Modifier = Modifier,
    fillWidth: Boolean = false,
) {
    val removeLabel = stringResource(R.string.translation_filters_removeAria, descriptor.label)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CHIP_FILL_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(CHIP_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (fillWidth) Arrangement.SpaceBetween else Arrangement.spacedBy(Spacing.xs),
        ) {
            ChipBody(
                label = descriptor.label,
                value = descriptor.value,
                modifier = if (fillWidth) Modifier.weight(1f, fill = false) else Modifier.widthIn(max = CHIP_TEXT_MAX_WIDTH),
            )
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = removeLabel,
                onClick = { onRemove(descriptor) },
                size = IconSize.Sm,
            )
        }
    }
}

/** The chip body: a muted "{label}:" followed by the emphasized value, merged into one TalkBack reading. */
@Composable
private fun ChipBody(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    val description = chipContentDescription(label, value)
    Row(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "$label:",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(Spacing.xs))
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The "+N more" overflow trigger and the popover listing the collapsed chips (web overflow bucket). The popover
 * is a focusable Compose `Popup` (dismisses on Back / outside tap), anchored directly below the trigger via its
 * measured height. Removing the last collapsed chip also dismisses the popover (web `if (overflow.length === 1)`).
 */
@Composable
private fun OverflowChips(
    overflow: List<FilterChipDescriptor>,
    expanded: Boolean,
    onToggle: () -> Unit,
    onDismiss: () -> Unit,
    onRemove: (FilterChipDescriptor) -> Unit,
) {
    val menuLabel = stringResource(R.string.translation_filters_moreLabel)
    val triggerLabel = stringResource(R.string.translation_filters_moreCount, overflow.size)
    Box {
        var anchorHeightPx by remember { mutableIntStateOf(0) }
        Button(
            label = triggerLabel,
            onClick = onToggle,
            modifier = Modifier.onSizeChanged { anchorHeightPx = it.height },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        Popover(
            expanded = expanded,
            onDismissRequest = onDismiss,
            alignment = Alignment.TopStart,
            offset = IntOffset(0, anchorHeightPx),
            accessibleName = menuLabel,
        ) {
            overflow.forEach { descriptor ->
                FilterChip(
                    descriptor = descriptor,
                    onRemove = { removed ->
                        onRemove(removed)
                        if (overflow.size == 1) onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                    fillWidth = true,
                )
            }
        }
    }
}

/**
 * A polite, visually-empty live region that announces filter removals + clear-all to assistive tech — the native
 * analogue of the web `<VisuallyHidden liveRegion>`. The 1 dp footprint keeps it off-screen while TalkBack reads
 * [text] when it changes.
 */
@Composable
private fun Announcer(text: String) {
    Box(
        modifier =
            Modifier
                .size(ANNOUNCER_SIZE)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = text
                },
    )
}

private const val CHIP_FILL_ALPHA = 0.4f
private val CHIP_BORDER_WIDTH = 1.dp
private val CHIP_TEXT_MAX_WIDTH = 220.dp
private val ANNOUNCER_SIZE = 1.dp

@Preview(name = "Active filters — chips", showBackground = true)
@Composable
private fun ActiveFilterChipsPreview() {
    TeslaSyncTheme {
        ActiveFilterChipsContent(
            filters =
                listOf(
                    FilterChipDescriptor(key = "vehicle", label = "Vehicle", value = "Model 3", onRemove = {}),
                    FilterChipDescriptor(key = "status", label = "Status", value = "Charging", onRemove = {}),
                    FilterChipDescriptor(key = "since", label = "Since", value = "Last 7 days", onRemove = {}),
                ),
            hideWhenEmpty = true,
            maxVisible = DEFAULT_MAX_VISIBLE,
            overflowOpen = false,
            announcement = "",
            onRemove = {},
            onClearAll = {},
            onToggleOverflow = {},
            onOverflowDismiss = {},
        )
    }
}

@Preview(name = "Active filters — overflow", showBackground = true)
@Composable
private fun ActiveFilterChipsOverflowPreview() {
    TeslaSyncTheme {
        ActiveFilterChipsContent(
            filters =
                (1..6).map { index ->
                    FilterChipDescriptor(key = "f$index", label = "Field $index", value = "Value $index", onRemove = {})
                },
            hideWhenEmpty = true,
            maxVisible = 4,
            overflowOpen = false,
            announcement = "",
            onRemove = {},
            onClearAll = {},
            onToggleOverflow = {},
            onOverflowDismiss = {},
        )
    }
}
