// The native Jetpack Compose + Material 3 StaggerContainer shared surface — a parity port of the web motion
// wrapper web/src/components/motion/StaggerContainer.tsx. The web surface staggers the entrance of its arbitrary
// `children` (framer-motion `staggerChildren`, 60 ms between siblings) and, when the user has requested reduced
// motion, collapses the cadence to 0 so the children appear in their final state at once. It fetches nothing and
// has no chrome of its own.
//
// This native surface keeps that contract end to end. It binds the one input the web hook exposes — the device
// motion preference (P1/S8) — through the component-library motion atom's reduced-motion plumbing (ADR-005), and
// composes the atom's tested StaggerContainer / StaggerItem primitives so the surface and the atom can never
// drift on what the cadence means. Over those primitives it reproduces every state the source plays: the
// animated stagger (motion enabled), the collapsed immediate state (reduced motion, the web `staggerChildren: 0`
// path), and the transparent empty pass-through when there are no children. The cadence math + the honesty
// rationale for why the generic loading / error / stale / offline states do not apply to a motion wrapper live
// in StaggerContainerModel.kt.
//
// The surface adds what a shared surface owes over the bare atom: a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) carrying only the surface slug, a data-driven list overload for the common "stagger these rows" call,
// and a [staggerPlan] projection callers can consult to know when the entrance has settled. It performs NO HTTP,
// renders no text of its own (so it carries no i18n strings — the web source has none either), and never swallows
// its children's semantics, so each child stays reachable to TalkBack and honours the system font scale.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StaggerContainer) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located overloads + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.staggercontainer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.motion.StaggerContainer as MotionStaggerContainer
import io.teslasync.android.components.motion.StaggerItem as MotionStaggerItem

/** Test tag on the surface root so on-device UI tests can locate the container in any state (even when empty). */
const val STAGGER_CONTAINER_TEST_TAG: String = "stagger-container"

/**
 * Generic entry point — the faithful port of the web `StaggerContainer`. Staggers the entrance of the arbitrary
 * [content] children (each wrapped in a [StaggerItem]) at [stepMs] cadence, collapsing to an immediate appearance
 * under reduced motion exactly as the web `staggerChildren: 0` branch does. Records the one-shot PII-safe
 * `view.opened` diagnostic on first composition. Adds no chrome of its own and renders nothing when [content] is
 * empty, mirroring the web empty `motion.div`.
 *
 * @param stepMs delay added per sibling (web `staggerChildren`, 60 ms); ignored under reduced motion.
 * @param itemDurationMs each child's entrance length (web child fade/slide); collapsed under reduced motion.
 * @param verticalArrangement spacing between the staggered children (the native column layout).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 * @param content the children to stagger, each placed in a [StaggerItem] by the caller.
 */
@Composable
fun StaggerContainer(
    modifier: Modifier = Modifier,
    stepMs: Int = DEFAULT_STAGGER_STEP_MS,
    itemDurationMs: Int = DEFAULT_ITEM_DURATION_MS,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(Spacing.sm),
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable ColumnScope.() -> Unit,
) {
    LaunchedEffect(Unit) { StaggerContainerDiagnostics.recordViewOpened(logger) }
    MotionStaggerContainer(
        modifier = modifier.testTag(STAGGER_CONTAINER_TEST_TAG),
        stepMs = stepMs,
        itemDurationMs = itemDurationMs,
        verticalArrangement = verticalArrangement,
        content = content,
    )
}

/**
 * Data-driven convenience — staggers a list of [items], the common "animate these rows in" call. Each item is
 * placed in a [StaggerItem] by its ordinal so siblings enter in order; an empty [items] list renders a
 * transparent container with no children (never invented chrome). Delegates to the generic [StaggerContainer]
 * overload, so it shares the single `view.opened` emission and the same reduced-motion behaviour.
 *
 * @param items the rows to stagger, in display order.
 * @param itemContent renders one [items] entry; placed in its own [StaggerItem].
 */
@Composable
fun <T> StaggerContainer(
    items: List<T>,
    modifier: Modifier = Modifier,
    stepMs: Int = DEFAULT_STAGGER_STEP_MS,
    itemDurationMs: Int = DEFAULT_ITEM_DURATION_MS,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(Spacing.sm),
    logger: Logger = LocalDataContainer.current.logger,
    itemContent: @Composable (item: T) -> Unit,
) {
    StaggerContainer(
        modifier = modifier,
        stepMs = stepMs,
        itemDurationMs = itemDurationMs,
        verticalArrangement = verticalArrangement,
        logger = logger,
    ) {
        items.forEachIndexed { index, item ->
            StaggerItem(index = index) { itemContent(item) }
        }
    }
}

/**
 * A single staggered child — the cohesive surface re-expose of the motion atom's [MotionStaggerItem]. Its
 * entrance is delayed by its ordinal [index] (under reduced motion every child starts at once). Use inside the
 * generic [StaggerContainer] slot; the data-driven overload wires this for you.
 */
@Composable
fun StaggerItem(
    index: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    MotionStaggerItem(index = index, modifier = modifier, content = content)
}

// ── Previews (tooling-only; the sample rows are never shipped UI) ──────────────────────────────────────────

private val PREVIEW_ROWS = listOf("Range estimate", "Battery health", "Trip efficiency", "Tire pressure")

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Preview(name = "StaggerContainer · animated entrance", showBackground = true)
@Composable
private fun StaggerContainerAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides false) {
            StaggerContainer(items = PREVIEW_ROWS, logger = PreviewLogger) { row -> BodyText(row) }
        }
    }
}

@Preview(name = "StaggerContainer · reduced motion (immediate)", showBackground = true)
@Composable
private fun StaggerContainerReducedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            StaggerContainer(items = PREVIEW_ROWS, logger = PreviewLogger) { row -> BodyText(row) }
        }
    }
}

@Preview(name = "StaggerContainer · empty (transparent pass-through)", showBackground = true)
@Composable
private fun StaggerContainerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StaggerContainer(items = emptyList<String>(), logger = PreviewLogger) { row -> BodyText(row) }
    }
}
