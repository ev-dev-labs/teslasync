// File named after its primary @Composable; the co-located spec data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.motion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Stagger orchestration shared by a [StaggerContainer] and its [StaggerItem] children: the
 * cadence ([stepMs]), each item's animation length ([itemDurationMs]), and the resolved
 * reduced-motion flag — computed once on the container so every item agrees.
 */
data class StaggerSpec(
    val stepMs: Int,
    val itemDurationMs: Int,
    val reduce: Boolean,
)

/** Provided by [StaggerContainer]; `null` means an item is used outside a container. */
val LocalStaggerSpec = staticCompositionLocalOf<StaggerSpec?> { null }

/**
 * A vertical container that staggers the entrance of its [StaggerItem] children, the Android
 * counterpart of the web `StaggerContainer`. Under reduced motion the cadence collapses to 0
 * so children appear in their final state at once.
 */
@Composable
fun StaggerContainer(
    modifier: Modifier = Modifier,
    stepMs: Int = MotionDefaults.STAGGER_STEP_MS,
    itemDurationMs: Int = MotionDefaults.ITEM_MS,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(Spacing.sm),
    content: @Composable ColumnScope.() -> Unit,
) {
    val reduce = rememberReducedMotion()
    CompositionLocalProvider(
        LocalStaggerSpec provides StaggerSpec(stepMs, itemDurationMs, reduce),
    ) {
        Column(modifier = modifier, verticalArrangement = verticalArrangement, content = content)
    }
}
