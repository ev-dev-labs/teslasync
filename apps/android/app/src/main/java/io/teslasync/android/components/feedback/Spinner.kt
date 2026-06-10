// File named after its primary @Composable; the co-located enum is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/** Loading-mark size scale mirroring web `Spinner` (sm / md / lg). */
enum class SpinnerSize(
    val track: Dp,
    val stroke: Dp,
) {
    Sm(24.dp, 2.dp),
    Md(40.dp, 3.dp),
    Lg(64.dp, 4.dp),
}

/**
 * Brand loading mark mirroring web `components/feedback/Spinner`. Implemented as an indeterminate
 * Material 3 [CircularProgressIndicator] (the web bolt-draw animation has no direct Compose
 * equivalent without bespoke vector animation) in the brand primary color, with an optional
 * [label] beneath. The whole control carries a single accessible name so screen readers announce
 * "Loading" rather than each child.
 */
@Composable
fun Spinner(
    modifier: Modifier = Modifier,
    size: SpinnerSize = SpinnerSize.Md,
    label: String? = null,
    accessibleLabel: String = label ?: "Loading",
) {
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = accessibleLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(size.track),
            strokeWidth = size.stroke,
            color = MaterialTheme.colorScheme.primary,
        )
        if (label != null) {
            Caption(label)
        }
    }
}

/**
 * Centered full-region loader mirroring web `components/feedback/PageLoader` — a large [Spinner]
 * with an optional [label], used as the Suspense/route fallback while a page boots.
 */
@Composable
fun PageLoader(
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(size = SpinnerSize.Lg, label = label)
    }
}
