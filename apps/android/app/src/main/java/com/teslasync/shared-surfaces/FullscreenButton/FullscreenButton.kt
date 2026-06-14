// The native Jetpack Compose + Material 3 FullscreenButton shared surface — a parity port of
// web/src/components/ui/FullscreenButton.tsx. The web source is a single ghost icon-button that wraps the
// browser Fullscreen API: it hides itself when fullscreen is unsupported (`document.fullscreenEnabled`), syncs
// its icon from the `fullscreenchange` event (NOT the click), and on tap toggles fullscreen on a target ref,
// flipping its `aria-label` / `title` / `aria-pressed` and the Maximize ↔ Minimize icon together.
//
// This surface is the native equivalent. All state flows through the shared [FullscreenButtonViewModel] over
// the [FullscreenController] seam — the view performs NO window I/O:
//   • web `useTranslation` `t('common.fullscreen.{enter,exit}')` → the generated i18n catalog (P1/S10) read
//     here via `stringResource`, overridable by the caller (web `ariaLabelEnter` / `ariaLabelExit` props);
//   • web `document.fullscreenEnabled` → [FullscreenController.isSupported] (the surface hides when false);
//   • web `fullscreenchange` sync → the holder's collection of [FullscreenController.fullscreenChanges];
//   • web `requestFullscreen()` / `exitFullscreen()` → [FullscreenController.enter] / [FullscreenController.exit],
//     backed in production by [rememberSystemFullscreenController] (host-window immersive mode);
//   • web Maximize / Minimize lucide icons → [TeslaGlyphs.Fullscreen] / [TeslaGlyphs.FullscreenExit];
//   • web `aria-label` / `title` flip → the flipping `contentDescription`; web `aria-pressed` /
//     `data-fullscreen-state` → the `stateDescription` token ([fullscreenStateToken]).
//
// On Android "fullscreen" is host-window immersive mode (the system bars), not an element-level request, so the
// surface is window-scoped (a documented divergence from the web `targetRef`): every FullscreenButton on a
// screen reflects the one window's immersive state, which is why the holder is bound with a stable surface key.
// The 48 dp Material touch target is an a11y improvement over the web's 28 px footprint (documented, ADR-002).
//
// States reproduced (the honest set for an imperative capability toggle — see FullscreenButtonModel): hidden
// (unsupported), enter (not fullscreen) and exit (fullscreen). There is no remote read, so no
// loading/empty/stale/offline lifecycle is invented (covenant #9). The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FullscreenButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, controller factory, controllers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.View
import android.view.Window
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf

/**
 * A ghost icon-button that toggles the host's fullscreen (immersive) state — the native `FullscreenButton`. It
 * binds the shared [FullscreenButtonViewModel] over [controller], hides itself when the host cannot toggle
 * fullscreen (web `if (!supported) return null`), and otherwise renders the Enter / Exit affordance whose icon
 * and accessible name flip with the live state.
 *
 * @param controller the fullscreen platform seam; defaults to the host window ([rememberSystemFullscreenController]).
 * @param enterLabel override for the "Enter fullscreen" accessible name (web `ariaLabelEnter`); null resolves
 *   `common.fullscreen.enter` from the catalog (P1/S10).
 * @param exitLabel override for the "Exit fullscreen" accessible name (web `ariaLabelExit`); null resolves
 *   `common.fullscreen.exit` from the catalog (P1/S10).
 * @param size the icon footprint (web `size`, default `sm`); the touch target is always a 48 dp Material target.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun FullscreenButton(
    modifier: Modifier = Modifier,
    controller: FullscreenController = rememberSystemFullscreenController(),
    enterLabel: String? = null,
    exitLabel: String? = null,
    size: IconSize = IconSize.Sm,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: FullscreenButtonViewModel =
        viewModel(
            key = FullscreenButtonRegistration.ID,
            factory = FullscreenButtonViewModel.factory(controller, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    if (isButtonVisible(state.supported)) {
        val resolvedEnter = enterLabel ?: stringResource(R.string.translation_common_fullscreen_enter)
        val resolvedExit = exitLabel ?: stringResource(R.string.translation_common_fullscreen_exit)
        FullscreenButtonContent(
            isFullscreen = state.isFullscreen,
            enterLabel = resolvedEnter,
            exitLabel = resolvedExit,
            onToggle = viewModel::toggle,
            modifier = modifier,
            size = size,
        )
    }
}

/**
 * Stateless renderer for the FullscreenButton — the test / preview entry point. Draws the ghost icon-button
 * with the Maximize / Minimize glyph for [isFullscreen] and the matching enter / exit label as both the
 * `contentDescription` (web `aria-label` / `title`) and the toggle-state `stateDescription` (web `aria-pressed`
 * / `data-fullscreen-state`), so assistive tech and tests get a consistent enter/exit signal.
 */
@Composable
fun FullscreenButtonContent(
    isFullscreen: Boolean,
    enterLabel: String,
    exitLabel: String,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    size: IconSize = IconSize.Sm,
) {
    val label = fullscreenLabel(isFullscreen, enterLabel, exitLabel)
    val stateToken = fullscreenStateToken(isFullscreen)
    val glyph = if (isFullscreen) TeslaGlyphs.FullscreenExit else TeslaGlyphs.Fullscreen
    IconButton(
        imageVector = glyph,
        contentDescription = label,
        onClick = onToggle,
        modifier =
            modifier
                .testTag(FullscreenButtonRegistration.ROOT_TEST_TAG)
                .semantics { stateDescription = stateToken },
        variant = IconButtonVariant.Standard,
        size = size,
    )
}

/**
 * The production [FullscreenController] backed by the host Activity window — the native analogue of the browser
 * Fullscreen API. Toggles immersive mode through `WindowInsetsControllerCompat` (hide / show the system bars)
 * and reports the live state from the window insets. When no host Activity window is reachable (e.g. a
 * preview / non-Activity context) it falls back to the unsupported controller, so the surface hides exactly as
 * the web does when `document.fullscreenEnabled` is false. Remembered against the [View] + [Context] so the
 * same controller survives recomposition.
 */
@Composable
fun rememberSystemFullscreenController(): FullscreenController {
    val view = LocalView.current
    val context = LocalContext.current
    return remember(view, context) {
        val window = context.findActivity()?.window
        if (window == null) UnsupportedFullscreenController else WindowFullscreenController(window, view)
    }
}

/** Walks the [Context] wrapper chain to the host [Activity], or null when none is reachable. */
private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

/** The [FullscreenController] used when no host window can toggle fullscreen (web `supported === false`). */
private object UnsupportedFullscreenController : FullscreenController {
    override val isSupported: Boolean = false

    override fun isFullscreen(): Boolean = false

    override fun fullscreenChanges(): Flow<Boolean> = flowOf(false)

    override fun enter() = Unit

    override fun exit() = Unit
}

/** The [FullscreenController] backed by the host window's system-bar (immersive) state. */
private class WindowFullscreenController(
    window: Window,
    private val view: View,
) : FullscreenController {
    override val isSupported: Boolean = true

    private val insetsController: WindowInsetsControllerCompat = WindowCompat.getInsetsController(window, view)

    private val active: MutableStateFlow<Boolean> = MutableStateFlow(currentlyHidden())

    override fun isFullscreen(): Boolean = active.value

    override fun fullscreenChanges(): Flow<Boolean> = active.asStateFlow()

    override fun enter() {
        insetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        active.value = true
    }

    override fun exit() {
        insetsController.show(WindowInsetsCompat.Type.systemBars())
        active.value = false
    }

    /** Whether the system bars are currently hidden — the live immersive state read from the window insets. */
    private fun currentlyHidden(): Boolean {
        val insets = ViewCompat.getRootWindowInsets(view)
        return insets != null && !insets.isVisible(WindowInsetsCompat.Type.systemBars())
    }
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

@Preview(name = "FullscreenButton — enter (not fullscreen)", showBackground = true)
@Composable
private fun FullscreenButtonEnterPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FullscreenButtonContent(
            isFullscreen = false,
            enterLabel = "Enter fullscreen",
            exitLabel = "Exit fullscreen",
            onToggle = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "FullscreenButton — exit (fullscreen)", showBackground = true)
@Composable
private fun FullscreenButtonExitPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        FullscreenButtonContent(
            isFullscreen = true,
            enterLabel = "Enter fullscreen",
            exitLabel = "Exit fullscreen",
            onToggle = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
