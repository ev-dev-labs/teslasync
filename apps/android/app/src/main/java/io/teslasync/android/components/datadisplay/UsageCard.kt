// File named after its primary @Composable; the co-located data classes are supporting types.
@file:Suppress("MatchingDeclarationName")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Visual intent driving accent color for bars / bands / banners. */
enum class UsageIntent { Normal, Warn, Danger }

/** Optional budget progress bar. */
data class UsageBudget(
    val headline: String,
    val pct: Float,
    val ariaLabel: String,
    val rightLabel: String? = null,
    val caption: String? = null,
    val intent: UsageIntent = UsageIntent.Normal,
)

/** One at-a-glance band in the bands row. */
data class UsageBand(
    val label: String,
    val value: String,
    val sub: String? = null,
    val icon: ImageVector? = null,
    val intent: UsageIntent = UsageIntent.Normal,
)

/** One key/value cell in the detail grid. */
data class UsageDetail(
    val label: String,
    val value: String,
    val intent: UsageIntent = UsageIntent.Normal,
)

/** One row in a top-list breakdown. */
data class UsageTopListItem(
    val key: String,
    val label: String,
    val value: String,
)

/** One top-list block. */
data class UsageTopList(
    val key: String,
    val title: String,
    val items: List<UsageTopListItem>,
    val icon: ImageVector? = null,
)

/** Optional callout banner. */
data class UsageBanner(
    val title: String,
    val description: String,
    val intent: UsageIntent = UsageIntent.Danger,
    val icon: ImageVector? = null,
)

/** One footer link/action. */
data class UsageFooterLink(
    val key: String,
    val label: String,
    val onClick: () -> Unit,
    val primary: Boolean = false,
)

/**
 * Shared "spend / volume" card — the Android counterpart of the web `UsageCard`. Purely
 * presentational: every dynamic value arrives via props so the card is trivially previewable.
 * Renders an optional budget bar, at-a-glance bands, a detail grid, top-list breakdowns, a
 * banner, and footer actions; falls back to [emptyMessage] when nothing else is present.
 */
@Composable
fun UsageCard(
    modifier: Modifier = Modifier,
    budget: UsageBudget? = null,
    bands: List<UsageBand> = emptyList(),
    details: List<UsageDetail> = emptyList(),
    topLists: List<UsageTopList> = emptyList(),
    banner: UsageBanner? = null,
    footer: List<UsageFooterLink> = emptyList(),
    emptyMessage: String? = null,
) {
    val isEmpty =
        budget == null && bands.isEmpty() && details.isEmpty() && topLists.isEmpty() && banner == null
    GlassPanel(modifier = modifier) {
        if (isEmpty && emptyMessage != null) {
            DataEmpty(emptyMessage, icon = DataDisplayGlyphs.History)
            return@GlassPanel
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (budget != null) UsageBudgetBar(budget)
            if (bands.isNotEmpty()) UsageBandsRow(bands)
            if (details.isNotEmpty()) UsageDetailGrid(details)
            topLists.forEach { UsageTopListBlock(it) }
            if (banner != null) UsageBannerCallout(banner)
            if (footer.isNotEmpty()) UsageFooterRow(footer)
        }
    }
}

@Composable
private fun UsageBudgetBar(budget: UsageBudget) {
    val color = usageIntentColor(budget.intent)
    Column {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(budget.headline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            if (budget.rightLabel != null) Caption(budget.rightLabel)
        }
        Box(
            modifier =
                Modifier
                    .padding(top = Spacing.xs)
                    .fillMaxWidth()
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .semantics {
                        contentDescription = budget.ariaLabel
                        progressBarRangeInfo = ProgressBarRangeInfo(budget.pct / PERCENT_MAX, 0f..1f)
                    },
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth((budget.pct / PERCENT_MAX).coerceIn(0f, 1f))
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(color),
            )
        }
        if (budget.caption != null) HelperText(budget.caption, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun UsageBandsRow(bands: List<UsageBand>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        bands.forEach { band ->
            Column(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(Radius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(Spacing.sm),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    if (band.icon != null) {
                        Icon(band.icon, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Caption(band.label)
                }
                Text(
                    band.value,
                    style = MaterialTheme.typography.titleMedium,
                    color = usageIntentText(band.intent),
                    modifier = Modifier.padding(top = Spacing.xs),
                )
                if (band.sub != null) HelperText(band.sub)
            }
        }
    }
}

@Composable
private fun UsageDetailGrid(details: List<UsageDetail>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        details.forEach { detail ->
            Column {
                Caption(detail.label)
                Text(detail.value, style = MaterialTheme.typography.bodyMedium, color = usageIntentText(detail.intent))
            }
        }
    }
}

@Composable
private fun UsageTopListBlock(list: UsageTopList) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (list.icon != null) {
                Icon(list.icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            PanelTitle(list.title)
        }
        list.items.forEach { item ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Caption(item.label)
                Caption(item.value)
            }
        }
    }
}

@Composable
private fun UsageBannerCallout(banner: UsageBanner) {
    val color = usageIntentColor(banner.intent)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(color.copy(alpha = BANNER_BG_ALPHA))
                .padding(Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(banner.icon ?: DataDisplayGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Sm, tint = color)
        Column {
            Text(banner.title, style = MaterialTheme.typography.bodyMedium, color = color)
            HelperText(banner.description)
        }
    }
}

@Composable
private fun UsageFooterRow(footer: List<UsageFooterLink>) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        footer.forEach { link ->
            Button(
                link.label,
                onClick = link.onClick,
                variant = if (link.primary) ButtonVariant.Primary else ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun usageIntentColor(intent: UsageIntent): Color =
    when (intent) {
        UsageIntent.Normal -> io.teslasync.android.ui.theme.TeslaTokens.status.info
        UsageIntent.Warn -> io.teslasync.android.ui.theme.TeslaTokens.status.warning
        UsageIntent.Danger -> io.teslasync.android.ui.theme.TeslaTokens.status.danger
    }

@Composable
private fun usageIntentText(intent: UsageIntent): Color =
    when (intent) {
        UsageIntent.Normal -> MaterialTheme.colorScheme.onSurface
        UsageIntent.Warn -> io.teslasync.android.ui.theme.TeslaTokens.status.warning
        UsageIntent.Danger -> io.teslasync.android.ui.theme.TeslaTokens.status.danger
    }

private val BAR_HEIGHT = 8.dp
private const val PERCENT_MAX = 100f
private const val BANNER_BG_ALPHA = 0.12f
