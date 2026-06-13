// The native Jetpack Compose + Material 3 CopyLinkButton shared surface — a parity port of
// web/src/components/layout/CopyLinkButton.tsx. The web source is one ghost-variant, small button that
// copies the current deep-linked URL (`window.location.href`) to the clipboard so a user can share a
// filtered/deep-linked view, flips to a two-second "Copied" confirmation (check icon + "Copied"), raises
// a success toast on copy and an error toast on failure (`useToast`), and overrides its accessible name
// with `t('common.copyLink.label')` while keeping the visible label "Copy link" / "Copied".
//
// This surface is the native equivalent. All state flows through the shared [CopyLinkButtonViewModel]
// over the [ClipboardWriter] + [ToastController] seams — the view performs NO clipboard I/O and no timing:
//   • web `useToast` → [requireToastController] / [LocalToastController] (the shared toast holder, P1/S8);
//   • web `useTranslation` `t('common.copyLink.*')` → the generated i18n catalog (P1/S10) read here via
//     `stringResource`, then handed to the holder as already-localized [CopyLinkToastCopy];
//   • web `window.location.href` → the caller-supplied [link] provider (a shared leaf must not reach into
//     the NavController, so the host hands in the canonical deep link for the current view — the same
//     caller-supplied-action pattern the GuardedLink port uses for `onNavigate`);
//   • web `navigator.clipboard.writeText(url)` (+ textarea fallback) → [rememberSystemClipboardWriter];
//   • web `aria-label` → an explicit `contentDescription` overriding the visible label for assistive tech;
//   • web `icon={copied ? <Check/> : <Link2/>}` → [TeslaGlyphs.Check] / the local [CopyLinkLinkGlyph];
//   • web `setTimeout(() => setCopied(false), 2000)` → the holder's [COPIED_RESET_MILLIS] revert.
//
// States reproduced (the honest set for an imperative share affordance — see CopyLinkButtonModel): the
// idle button and the copied confirmation, plus the copy-failed branch (error toast, button stays idle).
// There is no remote read, so no loading/empty/stale/offline lifecycle is invented (covenant #9). The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CopyLinkButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, clipboard factory, glyph, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.android.sharedsurfaces.toast.requireToastController
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** 24×24 icon canvas + stroke, matching the shared [TeslaGlyphs] line-style set the button draws beside. */
private const val ICON_CANVAS: Float = 24f
private const val ICON_STROKE: Float = 2f

/**
 * A chain-link glyph mirroring the web `Link2` (lucide) idle icon, authored as a 24×24 stroked vector in
 * the [TeslaGlyphs] house style (opaque black, recolored at render by the [Button] icon slot's tint). The
 * shared glyph set carries no link icon, so it is drawn here rather than reaching for the unrelated copy
 * glyph — keeping the surface visually faithful to the web source while staying self-contained.
 */
private val CopyLinkLinkGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "CopyLinkLink",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = ICON_CANVAS,
            viewportHeight = ICON_CANVAS,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = ICON_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                // Left half-loop (web Link2 path 1) — a left-bulging hook opening toward the centre bar.
                moveTo(9f, 17f)
                lineTo(7f, 17f)
                arcTo(5f, 5f, 0f, isMoreThanHalf = false, isPositiveArc = true, 7f, 7f)
                lineTo(9f, 7f)
                // Right half-loop (web Link2 path 2) — the mirrored right-bulging hook.
                moveTo(15f, 7f)
                lineTo(17f, 7f)
                arcTo(5f, 5f, 0f, isMoreThanHalf = true, isPositiveArc = true, 17f, 17f)
                lineTo(15f, 17f)
                // The connecting bar (web Link2 line).
                moveTo(8f, 12f)
                lineTo(16f, 12f)
            }
        }.build()

/**
 * The production [ClipboardWriter] backed by the Android system clipboard — the native analogue of
 * `navigator.clipboard.writeText`. Writes the link as a labelled `ClipData` and returns `false` if the
 * platform has no clipboard service or rejects the write, so the surface can render the web `catch` branch.
 * Remembered against the [android.content.Context] so the same writer survives recomposition.
 */
@Composable
fun rememberSystemClipboardWriter(): ClipboardWriter {
    val context = LocalContext.current
    return remember(context) {
        ClipboardWriter { label, link ->
            runCatching {
                val manager = context.getSystemService(ClipboardManager::class.java)
                manager?.setPrimaryClip(ClipData.newPlainText(label, link))
                manager != null
            }.getOrDefault(false)
        }
    }
}

/**
 * A ghost button that copies a shareable deep link to the clipboard — the native `CopyLinkButton`. On tap
 * it copies [link]`()` through [clipboard], raises the success/error toast on [toast], and flips to a
 * two-second "Copied" confirmation. Use sparingly, only where sharing a filtered/deep-linked view makes
 * sense (the same guidance the web component documents).
 *
 * @param link the canonical deep link for the current view, evaluated at tap time so it reflects the live
 *   filter state (the native analogue of reading `window.location.href` fresh on each click). Supplied by
 *   the host because a shared leaf must not reach into the NavController.
 * @param clipboard the clipboard seam; defaults to the system clipboard ([rememberSystemClipboardWriter]).
 * @param toast the shared toast holder; defaults to the mounted host's controller (web throwing `useToast`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun CopyLinkButton(
    link: () -> String,
    modifier: Modifier = Modifier,
    clipboard: ClipboardWriter = rememberSystemClipboardWriter(),
    toast: ToastController = requireToastController(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: CopyLinkButtonViewModel =
        viewModel(
            key = CopyLinkButtonRegistration.ID,
            factory = CopyLinkButtonViewModel.factory(clipboard, toast, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    val copyLabel = stringResource(R.string.translation_common_copyLink_action)
    val copiedLabel = stringResource(R.string.translation_common_copyLink_copied)
    val accessibleLabel = stringResource(R.string.translation_common_copyLink_label)
    val toastCopy =
        CopyLinkToastCopy(
            success = stringResource(R.string.translation_common_copyLink_success),
            error = stringResource(R.string.translation_common_copyLink_error),
        )

    CopyLinkButtonContent(
        copied = state.copied,
        copyLabel = copyLabel,
        copiedLabel = copiedLabel,
        accessibleLabel = accessibleLabel,
        onCopy = { viewModel.copyLink(link = link(), label = accessibleLabel, copy = toastCopy) },
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the CopyLinkButton — the test / preview entry point. Draws the ghost button with
 * the link or check glyph and the "Copy link" / "Copied" label for [copied], and exposes [accessibleLabel]
 * as the button's accessible name (web `aria-label`), so assistive tech announces "Copy link to this view"
 * regardless of the visible label.
 */
@Composable
fun CopyLinkButtonContent(
    copied: Boolean,
    copyLabel: String,
    copiedLabel: String,
    accessibleLabel: String,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        label = visibleCopyLabel(copied, copyLabel, copiedLabel),
        onClick = onCopy,
        modifier =
            modifier
                .testTag(CopyLinkButtonRegistration.ROOT_TEST_TAG)
                .semantics { contentDescription = accessibleLabel },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = if (copied) TeslaGlyphs.Check else CopyLinkLinkGlyph,
    )
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

@Preview(name = "CopyLinkButton — idle", showBackground = true)
@Composable
private fun CopyLinkButtonIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CopyLinkButtonContent(
            copied = false,
            copyLabel = "Copy link",
            copiedLabel = "Copied",
            accessibleLabel = "Copy link to this view",
            onCopy = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "CopyLinkButton — copied", showBackground = true)
@Composable
private fun CopyLinkButtonCopiedPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        CopyLinkButtonContent(
            copied = true,
            copyLabel = "Copy link",
            copiedLabel = "Copied",
            accessibleLabel = "Copy link to this view",
            onCopy = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
