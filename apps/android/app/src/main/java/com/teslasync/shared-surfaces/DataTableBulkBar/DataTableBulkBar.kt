// The native Jetpack Compose + Material 3 DataTableBulkBar shared surface — a parity port of
// web/src/components/ui/DataTableBulkBar.tsx. The web surface is a controlled, presentational selection toolbar
// shown above a data table when at least one row is selected: a cyan-accented bar (web `tableTokens.bulkBar`)
// carrying a polite-live "{{count}} selected" label, a consumer-supplied bulk-action slot (web `children`), and a
// ghost "Clear selection" button with a leading ✕ glyph. It renders nothing when nothing is selected
// (web `if (count <= 0) return null`), so a consumer can mount it unconditionally above a table.
//
// All lifecycle flows through the shared [DataTableBulkBarViewModel] (P1/S8): the one-shot `view.opened`
// diagnostic lives there, never in the view. Every visible string resolves through the i18n catalog (P1/S10) and
// every interactive element carries a TalkBack label. The atomic chrome (GlassPanel, Button) is reused from the
// shared component library; this surface only composes them — no web Tailwind classes, platform design tokens
// only (P1/S9).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content /
// error / stale / offline contract is mapped onto this controlled surface's real behaviour, because it performs
// no data fetch (see DataTableBulkBarModel.kt). `empty` is the web `count <= 0` null render
// ([BulkBarSurface.Hidden]); `content` is the bar; loading / error / stale / offline have no web branch (the
// parent table owns selection + any fetch), and the count label is a declarative polite live region rather than
// an imperative announcer, so there is no interaction seam to abstract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablebulkbar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `DataTableBulkBar`. Binds the surface lifecycle through a
 * [DataTableBulkBarViewModel], records the one-shot `view.opened` diagnostic, threads the host's [count] +
 * [onClear] (web props) and the [actions] slot (web `children`), and renders the bar. The surface performs no
 * business logic; [logger] defaults to the process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param count the number of currently selected rows (web `count`).
 * @param onClear clears the selection, wired to the "Clear selection" button (web `onClear`).
 * @param actions the consumer-supplied bulk actions rendered before the clear button (web `children`).
 */
@Composable
fun DataTableBulkBar(
    count: Int,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DATA_TABLE_BULK_BAR_SLUG,
) {
    val viewModel: DataTableBulkBarViewModel =
        viewModel(key = instanceKey, factory = DataTableBulkBarViewModel.factory(logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    DataTableBulkBarContent(
        count = count,
        onClear = onClear,
        modifier = modifier,
        actions = actions,
    )
}

/**
 * Stateless renderer — the unit/preview entry point. Classifies the selection into a [BulkBarSurface] and renders
 * the bar, or renders nothing when nothing is selected (web `if (count <= 0) return null`). The "{{count}}
 * selected" label is a polite live region so TalkBack announces selection changes; the consumer's [actions] and
 * the clear button wrap together in a flow row (web `flex flex-wrap`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DataTableBulkBarContent(
    count: Int,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable () -> Unit = {},
) {
    val surface = classifyBulkBar(count)
    if (surface !is BulkBarSurface.Visible) return

    val regionLabel = stringResource(R.string.translation_table_bulkActions_region)
    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = regionLabel },
        padding = PanelPadding.Sm,
        accent = PanelAccent.Primary,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SelectionCount(count = surface.count)
            Spacer(Modifier.weight(1f))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                actions()
                Button(
                    label = stringResource(R.string.translation_table_bulkActions_clear),
                    onClick = onClear,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = TeslaGlyphs.Close,
                )
            }
        }
    }
}

/**
 * The live "{{count}} selected" label — a polite live region so TalkBack re-announces the count as the selection
 * changes (web `<span aria-live="polite">`). The medium-weight label style mirrors the web `font-medium`.
 */
@Composable
private fun SelectionCount(count: Int) {
    Text(
        text = stringResource(R.string.translation_table_bulkActions_selected, count),
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

@Preview(name = "Selection — with actions", showBackground = true)
@Composable
private fun DataTableBulkBarActionsPreview() {
    TeslaSyncTheme {
        DataTableBulkBarContent(
            count = 3,
            onClear = {},
            actions = {
                Button(label = "Export CSV", onClick = {}, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                Button(label = "Delete", onClick = {}, variant = ButtonVariant.Danger, size = ButtonSize.Sm)
            },
        )
    }
}

@Preview(name = "Selection — clear only", showBackground = true)
@Composable
private fun DataTableBulkBarClearOnlyPreview() {
    TeslaSyncTheme {
        DataTableBulkBarContent(count = 1, onClear = {})
    }
}
