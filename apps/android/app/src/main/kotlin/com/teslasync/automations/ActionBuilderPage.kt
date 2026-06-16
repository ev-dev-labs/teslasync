// The native Jetpack Compose + Material 3 ActionBuilderPage automations surface — the A7 page promotion of the
// web controlled action-list editor (web/src/features/automations/pages/ActionBuilder.tsx). Faithful to the
// sibling A7 pages (TeslaRegionPage, GasPriceAutoPollPage) it is a thin wrapper that embeds a PRE-EXISTING
// shared feature view verbatim (DRY, ADR-006): the editable list of GlassPanel action cards — each with a
// 1-based index, an action-type Select, the kind-specific field set (command + JSON params, notify channel +
// message, set-setting key/type/value, call-automation target id) and a move-up / move-down / remove control
// column — followed by the ghost "Add Action" button, all come from
// io.teslasync.android.featureviews.actionbuilder.ActionBuilder. It is NOT re-implemented or stubbed here.
//
// Because the web source is an unrouted controlled component, this page seeds the embedded editor with a
// representative action of each kind + two notify channels (ActionBuilderPageModel) so every panel, data state
// and string renders without a parent supplying state — the same role the web AutomationBuilder page plays when
// it embeds <ActionBuilder/>. Composition: [ActionBuilderPage] is the stateful entry (records the one-shot
// page `view.opened` diagnostic and seeds the editor); [ActionBuilderPageContent] is the stateless body laid
// out on the design tokens (no hardcoded color/typography, ADR-005); the embedded feature view owns the action
// state, the JSON validation error/success states, the i18n fold + fallback, and the accessible control names.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located stateless content + previews.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations.actionbuilder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.actionbuilder.ActionBuilder
import io.teslasync.android.featureviews.actionbuilder.ActionBuilderContent
import io.teslasync.android.featureviews.actionbuilder.ActionChannel
import io.teslasync.android.featureviews.actionbuilder.ActionStepInput
import io.teslasync.android.featureviews.actionbuilder.buildActionBuilderStrings
import io.teslasync.android.featureviews.actionbuilder.buildActionTypeOptions
import io.teslasync.android.featureviews.actionbuilder.buildCommandOptions
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry: records the one-shot page `view.opened` diagnostic (P1/S11, distinct from the embedded
 * feature view's own `ActionBuilder` slug) and seeds the embedded editor with the sample action list + channels
 * so every panel, data state and string is reachable. [logger] defaults to the app's redacting logger.
 */
@Composable
fun ActionBuilderPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(logger) { recordActionBuilderPageOpened(logger) }
    ActionBuilderPageContent(
        actions = remember { actionBuilderSampleActions() },
        channels = remember { actionBuilderSampleChannels() },
        modifier = modifier,
        logger = logger,
    )
}

/**
 * The stateless page body: a vertically scrolling, token-padded column that embeds the shared ActionBuilder
 * feature view (web `<div className="space-y-3">{actions.map(…)}<Add/></div>`). The feature view owns the
 * editable action state and reports edits up; this page ignores the upward report because no parent observes a
 * standalone surface. Scrolls so the full action list + Add button stay reachable on short viewports.
 */
@Composable
fun ActionBuilderPageContent(
    actions: List<ActionStepInput>,
    channels: List<ActionChannel>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ActionBuilder(
            initialActions = actions,
            channels = channels,
            onActionsChange = {},
            logger = logger,
            instanceKey = ActionBuilderPageRegistration.SLUG,
        )
    }
}

@Preview(name = "ActionBuilderPage — populated", showBackground = true)
@Composable
private fun ActionBuilderPagePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(
            modifier = Modifier.padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            ActionBuilderContent(
                actions = actionBuilderSampleActions(),
                channels = actionBuilderSampleChannels(),
                strings = buildActionBuilderStrings { null },
                actionTypeOptions = buildActionTypeOptions { null },
                commandOptions = buildCommandOptions { null },
                onActionsChange = {},
            )
        }
    }
}
