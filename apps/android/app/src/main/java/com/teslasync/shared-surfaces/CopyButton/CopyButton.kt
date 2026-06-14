// The native Jetpack Compose + Material 3 CopyButton shared surface — a parity port of
// web/src/components/ui/CopyButton.tsx. The web source is a one-click clipboard primitive: a button
// (ghost / sm by default) that copies its `text` prop to the clipboard, flips to a two-second "Copied"
// confirmation (check icon + "Copied"), optionally raises a success toast on copy and an error toast on
// failure (only when `withToast` is set, through the gracefully-degrading `useOptionalToast`), drops its
// label for dense lists when `iconOnly` is set, and announces the Copy → Copied transition politely
// (`aria-live="polite"`) with an `aria-label` that mirrors the current state when icon-only.
//
// This surface is the native equivalent. All state flows through the shared [CopyButtonViewModel] over
// the [ClipboardWriter] + (optional) [ToastController] seams — the view performs NO clipboard I/O and no
// timing:
//   • web `useOptionalToast` → [LocalToastController] (nullable; the shared toast holder, P1/S8) so the
//     button still works with no host mounted, exactly like the web optional hook returning `null`;
//   • web `useTranslation` `t('common.copyButton.*')` → the generated i18n catalog (P1/S10) read here via
//     `stringResource`, then handed to the holder as already-localized [CopyButtonToastCopy];
//   • web `navigator.clipboard.writeText(text)` → [rememberSystemClipboardWriter];
//   • web `aria-label` → an explicit `contentDescription` (icon-only) / state-derived name;
//   • web `aria-live="polite"` → a `LiveRegionMode.Polite` semantics region;
//   • web `icon={copied ? <CheckCircle/> : <Copy/>}` → [TeslaGlyphs.Check] / [TeslaGlyphs.Copy];
//   • web `title` (native hover tooltip) → the shared [Tooltip] (Material 3 long-press / hover);
//   • web `setTimeout(() => setCopied(false), 2000)` → the holder's [COPIED_RESET_MILLIS] revert.
//
// Because the web component is built for dense rows / table cells (`iconOnly`), each placement binds its
// own state holder under a per-instance key (the same pattern the GuardedLink port uses) so two copy
// buttons never share one confirmation window. States reproduced (the honest set for an imperative copy
// affordance — see CopyButtonModel): the idle button, the copied confirmation, and the copy-failed branch
// (error toast when `withToast`, button stays idle). There is no remote read, so no loading/empty/stale/
// offline lifecycle is invented (covenant #9). The one-shot `view.opened` diagnostic (P1/S11) is emitted
// on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CopyButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, clipboard factory, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.toast.LocalToastController
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The production [ClipboardWriter] backed by the Android system clipboard — the native analogue of
 * `navigator.clipboard.writeText`. Writes the text as a labelled `ClipData` and returns `false` if the
 * platform has no clipboard service or rejects the write, so the surface can render the web `catch`
 * branch. Remembered against the [android.content.Context] so the same writer survives recomposition.
 */
@Composable
fun rememberSystemClipboardWriter(): ClipboardWriter {
    val context = LocalContext.current
    return remember(context) {
        ClipboardWriter { label, text ->
            runCatching {
                val manager = context.getSystemService(ClipboardManager::class.java)
                manager?.setPrimaryClip(ClipData.newPlainText(label, text))
                manager != null
            }.getOrDefault(false)
        }
    }
}

/**
 * A one-click clipboard button — the native `CopyButton`. On tap it copies [text] through [clipboard],
 * flips to a two-second "Copied" confirmation, invokes [onCopy] on success, and (when [withToast] is set
 * and a host is mounted) raises the success/error toast on [toast]. Defaults match the web source
 * (ghost / sm, label toggles "Copy" ↔ "Copied"); the opt-in props mirror the web component exactly.
 *
 * @param text the string to copy to the clipboard.
 * @param label overrides the default "Copy" / "Copied" label with a fixed string (web `label`).
 * @param iconOnly drop the visible label for dense lists / table cells (web `iconOnly`).
 * @param variant button emphasis; defaults to [ButtonVariant.Ghost] (web `variant`).
 * @param size button size; defaults to [ButtonSize.Sm] (web `size`).
 * @param withToast also raise a toast on success/failure; defaults to false (web `withToast`).
 * @param ariaLabel an explicit accessible-name override (web `ariaLabel`); auto-derived when [iconOnly].
 * @param enabled when false the button is inert and marked disabled to assistive tech (web `disabled`).
 * @param title a long-press / hover tooltip mirroring the web `title` attribute.
 * @param onCopy invoked once after a successful copy (web `onCopy`).
 * @param key disambiguates this placement's state holder when many copy buttons share a call site (e.g. a
 *   list row); defaults to a stable per-placement id.
 * @param clipboard the clipboard seam; defaults to the system clipboard ([rememberSystemClipboardWriter]).
 * @param toast the shared toast holder, or `null` when no host is mounted (web `useOptionalToast`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun CopyButton(
    text: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    iconOnly: Boolean = false,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    withToast: Boolean = false,
    ariaLabel: String? = null,
    enabled: Boolean = true,
    title: String? = null,
    onCopy: (() -> Unit)? = null,
    key: Any? = null,
    clipboard: ClipboardWriter = rememberSystemClipboardWriter(),
    toast: ToastController? = LocalToastController.current,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val instanceKey = rememberSaveable { randomCopyButtonInstanceId() }
    val viewModel: CopyButtonViewModel =
        viewModel(
            key = "${CopyButtonRegistration.ID}:${key?.toString() ?: instanceKey}",
            factory = CopyButtonViewModel.factory(clipboard, toast, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    val copyLabel = stringResource(R.string.translation_common_copyButton_copy)
    val copiedLabel = stringResource(R.string.translation_common_copyButton_copied)
    val labels = CopyButtonLabels(copy = copyLabel, copied = copiedLabel)
    val toastCopy =
        CopyButtonToastCopy(
            success = stringResource(R.string.translation_common_copyButton_successToast),
            error = stringResource(R.string.translation_common_copyButton_errorToast),
        )

    CopyButtonContent(
        copied = state.copied,
        visibleLabel =
            copyButtonVisibleLabel(
                copied = state.copied,
                iconOnly = iconOnly,
                labelOverride = label,
                labels = labels,
            ),
        accessibleLabel =
            copyButtonAccessibleLabel(
                copied = state.copied,
                iconOnly = iconOnly,
                ariaLabel = ariaLabel,
                labelOverride = label,
                labels = labels,
            ),
        iconOnly = iconOnly,
        onCopy = {
            viewModel.copy(
                text = text,
                clipLabel = copyLabel,
                toastCopy = if (withToast) toastCopy else null,
                onCopied = { onCopy?.invoke() },
            )
        },
        modifier = modifier,
        variant = variant,
        size = size,
        enabled = enabled,
        title = title,
    )
}

/**
 * Stateless renderer for the CopyButton — the test / preview entry point. Draws the labelled button (copy
 * or check glyph + "Copy" / "Copied" / [visibleLabel]) or, for [iconOnly], the bare icon button, exposes
 * [accessibleLabel] as the accessible name when set (web `aria-label`), announces state changes politely
 * (web `aria-live="polite"`), and wraps the affordance in a [Tooltip] when [title] is supplied.
 */
@Composable
fun CopyButtonContent(
    copied: Boolean,
    visibleLabel: String?,
    accessibleLabel: String?,
    iconOnly: Boolean,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    enabled: Boolean = true,
    title: String? = null,
) {
    val glyph = if (copied) TeslaGlyphs.Check else TeslaGlyphs.Copy
    val affordance: @Composable () -> Unit = {
        if (iconOnly) {
            IconButton(
                imageVector = glyph,
                contentDescription = accessibleLabel ?: visibleLabel.orEmpty(),
                onClick = onCopy,
                modifier =
                    modifier
                        .testTag(CopyButtonRegistration.ROOT_TEST_TAG)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                enabled = enabled,
                variant = IconButtonVariant.Standard,
                size = IconSize.Sm,
            )
        } else {
            Button(
                label = visibleLabel.orEmpty(),
                onClick = onCopy,
                modifier =
                    modifier
                        .testTag(CopyButtonRegistration.ROOT_TEST_TAG)
                        .semantics {
                            liveRegion = LiveRegionMode.Polite
                            if (accessibleLabel != null) contentDescription = accessibleLabel
                        },
                variant = variant,
                size = size,
                enabled = enabled,
                leadingIcon = glyph,
            )
        }
    }
    if (title != null) {
        Tooltip(text = title) { affordance() }
    } else {
        affordance()
    }
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

@Preview(name = "CopyButton — idle", showBackground = true)
@Composable
private fun CopyButtonIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CopyButtonContent(
            copied = false,
            visibleLabel = "Copy",
            accessibleLabel = null,
            iconOnly = false,
            onCopy = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "CopyButton — copied", showBackground = true)
@Composable
private fun CopyButtonCopiedPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        CopyButtonContent(
            copied = true,
            visibleLabel = "Copied",
            accessibleLabel = null,
            iconOnly = false,
            onCopy = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "CopyButton — icon only", showBackground = true)
@Composable
private fun CopyButtonIconOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CopyButtonContent(
            copied = false,
            visibleLabel = null,
            accessibleLabel = "Copy",
            iconOnly = true,
            onCopy = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
