// Activity-feed section embedded by AutomationsListPage.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.core.os.ConfigurationCompat
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.automations.AutomationHistory
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationHistoryStats
import java.text.NumberFormat
import java.util.Locale

private const val MAX_HISTORY_ROWS = 8

/** The activity-feed section: the `Recent Activity` header + the [state]-driven history surface. */
@Composable
fun AutomationActivityFeed(
    state: UiState<AutomationHistoryListResponse>,
    modifier: Modifier = Modifier,
) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val integers = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    val percents = remember(locale) { NumberFormat.getPercentInstance(locale) }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(stringResource(R.string.translation_automations_recentActivity))
        GlassPanel(padding = PanelPadding.Md) {
            when {
                state.isLoading ->
                    Spinner(size = SpinnerSize.Sm, modifier = Modifier.padding(Spacing.md))

                state.isError ->
                    Caption(stringResource(R.string.translation_error_loadFailed))

                else -> {
                    val items = state.data?.items ?: emptyList()
                    if (items.isEmpty()) {
                        EmptyState(
                            message = stringResource(R.string.translation_automations_noHistory),
                            icon = AutomationsGlyphs.Zap,
                        )
                    } else {
                        AutomationHistorySummary(
                            summary = state.data?.summary ?: AutomationHistoryStats(),
                            integers = integers,
                            percents = percents,
                        )
                        items.take(MAX_HISTORY_ROWS).forEach { AutomationHistoryRow(it, locale) }
                    }
                }
            }
        }
    }
}

@Composable
private fun AutomationHistorySummary(
    summary: AutomationHistoryStats,
    integers: NumberFormat,
    percents: NumberFormat,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption("${integers.format(summary.totalExecutions)} ${stringResource(R.string.translation_automations_totalRuns)}")
        Caption("${percents.format(summary.successRate)} ${stringResource(R.string.translation_automations_successRate)}")
    }
}

@Composable
private fun AutomationHistoryRow(
    history: AutomationHistory,
    locale: Locale,
) {
    val triggered = formatAutomationTimestamp(history.triggeredAt, locale)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(history.automationName.ifBlank { EM_DASH })
            triggered?.let { HelperText(it) }
        }
        Badge(
            text = history.status.ifBlank { EM_DASH },
            variant = statusBadgeVariant(history.status),
            dot = true,
        )
    }
}

/** Map a backend execution status string to the design-system badge tone. */
private fun statusBadgeVariant(status: String): BadgeVariant =
    when (status.lowercase(Locale.ROOT)) {
        "success", "succeeded", "completed" -> BadgeVariant.Success
        "failed", "failure", "error" -> BadgeVariant.Danger
        "partial" -> BadgeVariant.Warning
        else -> BadgeVariant.Neutral
    }
