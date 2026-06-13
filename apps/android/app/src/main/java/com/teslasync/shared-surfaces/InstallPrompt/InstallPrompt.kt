// The native Jetpack Compose + Material 3 InstallPrompt shared surface — a parity port of
// web/src/components/feedback/InstallPrompt.tsx. The web surface is a bottom-docked, dismissable PROMOTION inviting
// the user to install the PWA: a glass card with a gradient download-icon box, a localized title + subtitle, an
// "Install" button and a dismiss control, sliding up with a spring entrance and gated on the platform offering an
// install path, the app not already being installed, and no recent dismissal.
//
// This surface is the native equivalent. All state flows through the shared [InstallPromptViewModel] over the
// [InstallPromptSource] seam (P1/S8) — the view performs NO HTTP and reads no `ShortcutManagerCompat`/persistence
// directly. Every derivation flows through the pure [classifyInstallPrompt] / [wasDismissedRecently]; the composable
// is a thin render layer. The faithful mapping of the web behaviour:
//   • the web "add to home screen" PWA install → pinning a TeslaSync launcher shortcut via `ShortcutManagerCompat`,
//     so the web `Download` glyph becomes [TeslaGlyphs.Pin] (the platform's pin-to-home semantics).
//   • `visible === false` → [InstallPromptSurface.Hidden] → nothing is emitted (web `null`).
//   • otherwise → a glass [GlassPanel] card with the [IconBox] accent, the `installPrompt.title` /
//     `installPrompt.subtitle`, an `installPrompt.install` [Button], and a dismiss [IconButton] labelled
//     `installPrompt.dismiss`.
//   • the web `framer-motion` slide-up entrance → the shared [FadeIn] primitive, which honours reduced motion
//     ([rememberReducedMotion]) so the card renders in its final state immediately when animations are disabled.
//   • the card's title + subtitle are merged into a single POLITE live region so the prompt announces itself to
//     TalkBack when it slides in, while the install + dismiss controls stay separately-focusable labelled nodes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/InstallPrompt) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.installprompt

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the whole prompt card — used by the instrumented per-state + a11y UI tests. */
const val INSTALL_PROMPT_TEST_TAG: String = "install-prompt"

/** Test tag identifying the install control. */
const val INSTALL_PROMPT_INSTALL_TAG: String = "install-prompt-install"

/** Test tag identifying the dismiss control. */
const val INSTALL_PROMPT_DISMISS_TAG: String = "install-prompt-dismiss"

/**
 * Stateful entry point — the faithful port of the web `InstallPrompt`. Binds the [InstallPromptViewModel], records the
 * one-shot `view.opened` diagnostic (P1/S11), collects the resolved [InstallPromptSurface], and renders it. Renders
 * nothing while the surface is [InstallPromptSurface.Hidden] (already installed, dismissed within the window, or no
 * install path — web returns `null`). Performs NO HTTP; [source] defaults to the production `ShortcutManagerCompat` +
 * install-preferences binding and [logger] to the app's redacting logger.
 *
 * @param modifier optional layout modifier for the prompt container.
 * @param source the install-path + sticky-dismissal seam; defaults to [bindInstallPromptSource] over the app context.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun InstallPrompt(
    modifier: Modifier = Modifier,
    source: InstallPromptSource = rememberInstallPromptSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: InstallPromptViewModel =
        viewModel(
            key = INSTALL_PROMPT_SLUG,
            factory = InstallPromptViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val surface by viewModel.surface.collectAsStateWithLifecycle()
    InstallPromptContent(
        surface = surface,
        modifier = modifier,
        onInstall = viewModel::install,
        onDismiss = viewModel::dismiss,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Renders the install card for
 * [InstallPromptSurface.Active] (with the shared [FadeIn] slide-up entrance that honours reduced motion) and emits
 * nothing for [InstallPromptSurface.Hidden] (web `null`). Hoisted out of the ViewModel so each state is preview- and
 * screenshot-testable.
 */
@Composable
fun InstallPromptContent(
    surface: InstallPromptSurface,
    modifier: Modifier = Modifier,
    onInstall: () -> Unit = {},
    onDismiss: () -> Unit = {},
) {
    if (surface !is InstallPromptSurface.Active) return
    FadeIn(modifier = modifier) {
        InstallPromptCard(onInstall = onInstall, onDismiss = onDismiss)
    }
}

/**
 * The web install card: a glass [GlassPanel] holding the accent [IconBox] (the web gradient download box, mapped to
 * the pin-to-home [TeslaGlyphs.Pin]), the title + subtitle in a single merged POLITE live region (so the prompt
 * announces itself when it appears), an "Install" [Button], and an independently-labelled dismiss [IconButton] (the
 * web `onClose` X).
 */
@Composable
private fun InstallPromptCard(
    onInstall: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_installPrompt_title)
    val subtitle = stringResource(R.string.translation_installPrompt_subtitle)
    val installLabel = stringResource(R.string.translation_installPrompt_install)
    val dismissLabel = stringResource(R.string.translation_installPrompt_dismiss)
    val announcement = installPromptAccessibilityLabel(title, subtitle)

    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(INSTALL_PROMPT_TEST_TAG),
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Primary, size = IconBoxSize.Md) {
                Icon(
                    TeslaGlyphs.Pin,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = iconColorFor(IconBoxTone.Primary),
                )
            }
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) {
                            liveRegion = LiveRegionMode.Polite
                            contentDescription = announcement
                        },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                PanelTitle(title)
                HelperText(subtitle)
            }
            Button(
                label = installLabel,
                onClick = onInstall,
                modifier = Modifier.testTag(INSTALL_PROMPT_INSTALL_TAG),
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
            IconButton(
                TeslaGlyphs.Close,
                contentDescription = dismissLabel,
                onClick = onDismiss,
                modifier = Modifier.testTag(INSTALL_PROMPT_DISMISS_TAG),
                size = IconSize.Sm,
            )
        }
    }
}

/** The default production source: a `ShortcutManagerCompat` + install-preferences binding over the app context. */
@Composable
private fun rememberInstallPromptSource(): InstallPromptSource {
    val context = LocalContext.current
    return remember(context) { bindInstallPromptSource(context) }
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// The Hidden surface intentionally renders nothing (web `null`), so only the Active surface has a visible preview.
// Reduced motion is forced on so the FadeIn entrance renders in its final state in the static preview image. The
// strings resolve through the P1/S10 catalog (no hardcoded English).

@Preview(name = "InstallPrompt · active", showBackground = true)
@Composable
private fun InstallPromptActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            InstallPromptContent(surface = InstallPromptSurface.Active)
        }
    }
}
