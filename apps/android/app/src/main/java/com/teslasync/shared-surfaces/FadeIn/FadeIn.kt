// The native Jetpack Compose + Material 3 FadeIn shared surface — a parity port of the web motion wrapper
// web/src/components/motion/FadeIn.tsx. The web surface fades its arbitrary `children` in from `{ opacity: 0,
// y: 12 }` to `{ opacity: 1, y: 0 }` over the resolved duration, honours an optional `delay` for stagger
// orchestration, and — when the user has requested reduced motion — sets `initial={false}` so the element renders
// in its final state with no entry animation. It fetches nothing and has no chrome of its own.
//
// This native surface keeps that contract end to end. It binds the one input the web hook exposes — the device
// motion preference (P1/S8) — through the component-library motion atom's reduced-motion plumbing (ADR-005), and
// composes the atom's tested FadeIn primitive so the surface and the atom can never drift on what the reveal
// means. Over that primitive it reproduces every state the source plays: the animated reveal (motion enabled),
// the immediate final state (reduced motion, the web `initial={false}` path), and the transparent empty wrapper
// when there is no content. The entrance math + the honesty rationale for why the generic loading / error /
// stale / offline states do not apply to a motion wrapper live in FadeInModel.kt.
//
// The surface adds what a shared surface owes over the bare atom: a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) carrying only the surface slug, and a stable test tag so the wrapper root stays locatable in every
// state (even when empty). It performs NO HTTP, renders no text of its own (so it carries no i18n strings — the
// web source has none either), and never swallows its content's semantics, so the wrapped subtree stays reachable
// to TalkBack and honours the system font scale.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FadeIn) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fadein

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
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
import io.teslasync.android.components.motion.FadeIn as MotionFadeIn

/** Test tag on the surface root so on-device UI tests can locate the wrapper in any state (even when empty). */
const val FADE_IN_TEST_TAG: String = "fade-in"

/**
 * The faithful port of the web `FadeIn`. Fades its [content] in with a slide-up over [durationMs], after an
 * optional [delayMs] for hand-stagger orchestration, collapsing to an immediate appearance under reduced motion
 * exactly as the web `initial={false}` branch does (the duration, delay, and slide all collapse — see [fadePlan]).
 * Records the one-shot PII-safe `view.opened` diagnostic on first composition. Adds no chrome of its own; an empty
 * [content] slot renders a transparent wrapper, mirroring the web empty `motion.div`.
 *
 * @param modifier the web `className` equivalent — layout/decoration applied to the wrapper root.
 * @param delayMs entrance delay before the reveal (web `delay`, ms); ignored under reduced motion.
 * @param durationMs the reveal length (web `useMotionPreference(400)` duration); collapsed under reduced motion.
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 * @param content the subtree to fade in.
 */
@Composable
fun FadeIn(
    modifier: Modifier = Modifier,
    delayMs: Int = DEFAULT_FADE_DELAY_MS,
    durationMs: Int = DEFAULT_FADE_DURATION_MS,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { FadeInDiagnostics.recordViewOpened(logger) }
    MotionFadeIn(
        modifier = modifier.testTag(FADE_IN_TEST_TAG),
        delayMs = delayMs.coerceAtLeast(0),
        durationMs = durationMs,
        content = content,
    )
}

// ── Previews (tooling-only; the sample content is never shipped UI) ─────────────────────────────────────────

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Preview(name = "FadeIn · animated reveal (motion enabled)", showBackground = true)
@Composable
private fun FadeInAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides false) {
            FadeIn(modifier = Modifier.padding(Spacing.md), logger = PreviewLogger) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText("Battery health")
                    BodyText("Range estimate")
                }
            }
        }
    }
}

@Preview(name = "FadeIn · reduced motion (immediate)", showBackground = true)
@Composable
private fun FadeInReducedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            FadeIn(modifier = Modifier.padding(Spacing.md), logger = PreviewLogger) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText("Battery health")
                    BodyText("Range estimate")
                }
            }
        }
    }
}
