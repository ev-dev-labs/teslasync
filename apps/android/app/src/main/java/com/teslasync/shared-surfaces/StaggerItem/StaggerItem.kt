// The native Jetpack Compose + Material 3 StaggerItem shared surface — a parity port of the web motion wrapper
// web/src/components/motion/StaggerItem.tsx. The web surface is a single child of a StaggerContainer: it reads the
// device motion preference (useMotionPreference(350)) and animates its arbitrary `children` into place — fading up
// from 15 px below over 350 ms (variants `hidden` = { opacity: 0, y: 15 } → `show` = { opacity: 1, y: 0 }). When
// the user has requested reduced motion `hidden` collapses to the final frame so the child appears in place with
// no fade or slide. It fetches nothing and has no chrome of its own.
//
// This native surface keeps that contract end to end. It binds the one input the web hook exposes — the device
// motion preference (P1/S8) — through the component-library motion atom's reduced-motion plumbing (ADR-005), and
// composes the atom's tested StaggerItem primitive so the surface and the atom can never drift on what the fade +
// slide + per-index delay mean. Over that primitive it reproduces every state the source plays: the animated
// entrance (motion enabled — fade + slide up from the offset), the collapsed immediate frame (reduced motion, the
// web `hidden = show` branch), the first item's zero-delay entrance, and the transparent pass-through when the
// child renders nothing. The entrance math + the honesty rationale for why the generic loading / error / stale /
// offline states do not apply to a motion wrapper live in StaggerItemModel.kt.
//
// The surface adds what a shared surface owes over the bare atom: a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) carrying only the surface slug, and a stable test tag so on-device UI tests can locate the item in any
// state. It performs NO HTTP, renders no text of its own (so it carries no i18n strings — the web source has none
// either), and never swallows its child's semantics, so the child stays reachable to TalkBack and honours the
// system font scale.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StaggerItem) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located test tag + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.staggeritem

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import io.teslasync.android.components.motion.StaggerItem as MotionStaggerItem

/** Test tag on the surface root so on-device UI tests can locate the item in any state (animated or reduced). */
const val STAGGER_ITEM_TEST_TAG: String = "stagger-item"

/**
 * A single staggered child — the faithful port of the web `StaggerItem`. Animates its [content] into place by
 * fading it up from a short offset (web `hidden` { opacity: 0, y: 15 } → `show` { opacity: 1, y: 0 }), delayed by
 * its ordinal [index] so siblings enter in sequence; under reduced motion the child renders in its final frame at
 * once with no fade or slide. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first
 * composition. Adds no chrome of its own and stays transparent when [content] renders nothing, mirroring the web
 * wrapper. Use inside a [io.teslasync.android.components.motion.StaggerContainer]; a lone item (the default
 * [index] of 0) simply fades in on its own, exactly as a single web child does.
 *
 * @param index the child's position among its siblings (e.g. the `forEachIndexed` index); drives the entry delay.
 * @param modifier optional layout modifier applied to the item root.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer] logger.
 * @param content the child to animate in; placed verbatim so its semantics stay reachable to TalkBack.
 */
@Composable
fun StaggerItem(
    index: Int = 0,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { StaggerItemDiagnostics.recordViewOpened(logger) }
    MotionStaggerItem(
        index = index,
        modifier = modifier.testTag(STAGGER_ITEM_TEST_TAG),
        content = content,
    )
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

@Preview(name = "StaggerItem · animated entrance", showBackground = true)
@Composable
private fun StaggerItemAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides false) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                PREVIEW_ROWS.forEachIndexed { index, row ->
                    StaggerItem(index = index, logger = PreviewLogger) { BodyText(row) }
                }
            }
        }
    }
}

@Preview(name = "StaggerItem · reduced motion (immediate)", showBackground = true)
@Composable
private fun StaggerItemReducedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                PREVIEW_ROWS.forEachIndexed { index, row ->
                    StaggerItem(index = index, logger = PreviewLogger) { BodyText(row) }
                }
            }
        }
    }
}
