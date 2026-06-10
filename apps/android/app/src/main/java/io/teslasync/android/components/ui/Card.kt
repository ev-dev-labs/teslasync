// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing

/** Inner padding scale for [Card]. [Auto] follows the ambient [UiDensity]. */
enum class CardPadding { None, Sm, Md, Lg, Auto }

/**
 * Content card mirroring web `components/ui/Card`. A bordered, low-elevation Material 3
 * [Surface]; pair with [CardHeader]/[CardFooter] for the standard title/action/footer layout.
 */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    padding: CardPadding = CardPadding.Md,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(cardPadding(padding)), content = content)
    }
}

/** Title row with optional [subtitle] and a trailing [action] slot. */
@Composable
fun CardHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    action: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(bottom = Spacing.md),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.padding(end = Spacing.sm)) {
            PanelTitle(title)
            if (subtitle != null) {
                Caption(subtitle, modifier = Modifier.padding(top = Spacing.xs))
            }
        }
        if (action != null) action()
    }
}

/** Right-aligned action footer separated from the body by a divider. */
@Composable
fun CardFooter(
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth().padding(top = Spacing.md)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
private fun cardPadding(padding: CardPadding): PaddingValues =
    when (padding) {
        CardPadding.None -> PaddingValues(Spacing.none)
        CardPadding.Sm -> PaddingValues(Spacing.sm)
        CardPadding.Md -> PaddingValues(Spacing.md)
        CardPadding.Lg -> PaddingValues(Spacing.lg)
        CardPadding.Auto -> PaddingValues(LocalUiDensity.current.metrics().paddingX)
    }
