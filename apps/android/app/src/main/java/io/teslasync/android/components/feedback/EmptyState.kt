// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** Optional call-to-action rendered beneath an [EmptyState] message. */
data class EmptyStateAction(
    val label: String,
    val onClick: () -> Unit,
)

/**
 * Centered empty-state mirroring web `components/feedback/EmptyState`. Shows an optional [icon],
 * an optional [title], the [message], and an optional CTA. Use anywhere a data region resolves to
 * "nothing here yet" so a panel never collapses to a blank box.
 */
@Composable
fun EmptyState(
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    title: String? = null,
    action: EmptyStateAction? = null,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xl3, horizontal = Spacing.lg)
                .semantics { contentDescription = title ?: message },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (icon != null) {
            Icon(
                icon,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (title != null) {
            PanelTitle(title)
        }
        BodyText(
            message,
            modifier = Modifier.widthIn(max = EMPTY_TEXT_MAX_WIDTH),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (action != null) {
            Button(action.label, onClick = action.onClick, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
        }
    }
}

/**
 * Threshold empty-state mirroring web `components/feedback/EmptyStateThreshold`. Used for sections
 * that only become useful at scale (e.g. a heatmap needing ≥30 sessions). Renders a healthy green
 * check, the [sectionLabel], an optional [description], and a friendly "need N more" message — the
 * section is intentionally never hidden so operators know it exists and what unlocks it.
 */
@Composable
fun EmptyStateThreshold(
    currentCount: Int,
    threshold: Int,
    sectionLabel: String,
    modifier: Modifier = Modifier,
    itemNoun: String = "items",
    description: String? = null,
    message: String? = null,
    action: EmptyStateAction? = null,
) {
    val resolved =
        message
            ?: "Need at least $threshold $itemNoun to show meaningful patterns. You have $currentCount so far."
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(Spacing.lg)
                .semantics { contentDescription = sectionLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(
            TeslaGlyphs.Check,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.success,
        )
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(sectionLabel)
            if (description != null) {
                Caption(description)
            }
            BodyText(resolved, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (action != null) {
                Button(action.label, onClick = action.onClick, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
    }
}

private val EMPTY_TEXT_MAX_WIDTH = 360.dp
