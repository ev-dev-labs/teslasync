package io.teslasync.android.components.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Information density, mirroring the web `ui_density` setting (`compact`/`comfortable`/
 * `spacious`). On the web this drives CSS custom properties; on Android the same preference
 * resolves to a [DensityMetrics] bundle that the shared primitives (DataTable rows, Button
 * `Auto` size, list paddings) read through [LocalUiDensity].
 */
enum class UiDensity { Compact, Comfortable, Spacious }

/**
 * Resolved spacing for a [UiDensity]. [rowHeight] keeps the comfortable/spacious tiers at or
 * above the 48 dp touch-target minimum; [Compact] intentionally tightens rows for data-dense
 * surfaces (log viewers) where the user opted in.
 */
data class DensityMetrics(
    val rowHeight: Dp,
    val paddingX: Dp,
    val paddingY: Dp,
    val controlHeight: Dp,
)

/** Pure resolution of a density tier to its metrics; unit-tested without the Compose runtime. */
fun UiDensity.metrics(): DensityMetrics =
    when (this) {
        UiDensity.Compact -> DensityMetrics(Spacing.xl3, Spacing.sm, Spacing.xs, Spacing.xl3)
        UiDensity.Comfortable -> DensityMetrics(Spacing.xl4, Spacing.md, Spacing.sm, Spacing.xl4)
        UiDensity.Spacious -> DensityMetrics(SpaciousRow, Spacing.lg, Spacing.md, SpaciousRow)
    }

private val SpaciousRow: Dp = Spacing.xl4 + Spacing.sm

/** Ambient density. Defaults to [UiDensity.Comfortable] so un-provided previews are sensible. */
val LocalUiDensity = staticCompositionLocalOf { UiDensity.Comfortable }

/**
 * Provides [density] to every descendant primitive. Mirrors the web `DensityApplier`, which
 * mounts `useDensitySync()` to publish the preference; here the preference flows through a
 * [CompositionLocal] instead of a DOM data-attribute.
 */
@Composable
fun DensityProvider(
    density: UiDensity,
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalUiDensity provides density, content = content)
}
