// The native Jetpack Compose + Material 3 PrintButton shared surface — a parity port of
// web/src/components/ui/PrintButton.tsx. The web source is a one-click print affordance: a button
// (ghost / sm by default) carrying a Printer glyph and the "Print" label that opens the browser print
// dialog (`window.print()`) for the current page. It optionally runs a `beforePrint` setup hook first
// (expand collapsed panels, switch to the tab the user wants on paper), giving React one animation frame
// to flush those state changes before the print snapshot is taken, guards against a double-launch with an
// internal `printing` flag, drops its visible label for dense placements when `iconOnly` is set, and
// announces an `aria-label` when there is no visible text.
//
// This surface is the native equivalent. All orchestration flows through the shared [PrintButtonViewModel]
// over the [PrintLauncher] + [FrameSynchronizer] seams — the view performs NO platform print I/O and no
// frame timing:
//   • web `useTranslation` `t('common.printButton.print')` → the generated i18n catalog (P1/S10) read here
//     via `stringResource`;
//   • web `window.print()`                                 → [PrintLauncher] ([rememberSystemPrintLauncher]
//     wraps the Android `PrintManager`);
//   • web `requestAnimationFrame(...)`                     → [FrameSynchronizer] ([rememberFrameSynchronizer]
//     suspends on the Compose `withFrameNanos` clock);
//   • web `aria-label`                                     → an explicit `contentDescription` (icon-only) /
//     state-derived name;
//   • web `icon={<Printer/>}`                              → [TeslaGlyphs.Printer];
//   • web `const [printing, setPrinting]`                  → the holder's re-entry guard.
//
// Because the Android print framework rasterises a caller-supplied document (not the live view tree), the
// host provides WHAT to print through the [PrintLauncher] seam — the native-idiomatic counterpart of the web
// page's implicit DOM, and the same contract the component-library `PrintButton` atom documents. Everything
// the web component itself owns (the printing guard, the `beforePrint` await, the one-frame flush, the
// label / icon-only / variant / size / ariaLabel / disabled handling, the i18n, the diagnostics) is
// reproduced here. The web `data-print-hide` attribute has no native analogue (there is no printed copy of
// the live view to hide from) and is intentionally absent. States reproduced (the honest set for an
// imperative print affordance — see PrintButtonModel): the idle button, the icon-only variant, the disabled
// button, and the `beforePrint`-failed branch. There is no remote read, so no loading / empty / stale /
// offline lifecycle is invented (covenant #9). The one-shot `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PrintButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, production seam factories, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The production [PrintLauncher] backed by the Android system print service — the native analogue of
 * `window.print()`. It hands the caller-supplied [documentAdapter] to the platform `PrintManager` under
 * [documentName] (and optional [attributes]) and returns `false` when the device has no print service or
 * rejects the launch, so the surface can record the native-only failure branch. Remembered against the
 * [android.content.Context] + its inputs so the same launcher survives recomposition.
 *
 * Printing on Android rasterises a document, not the live view tree, so the host owns the
 * [PrintDocumentAdapter] (the same division the component-library `PrintButton` atom documents); this helper
 * is the first-class, real way to build a launcher from one.
 */
@Composable
fun rememberSystemPrintLauncher(
    documentName: String,
    documentAdapter: PrintDocumentAdapter,
    attributes: PrintAttributes? = null,
): PrintLauncher {
    val context = LocalContext.current
    return remember(context, documentName, documentAdapter, attributes) {
        PrintLauncher {
            runCatching {
                val manager = context.getSystemService(PrintManager::class.java)
                manager?.print(documentName, documentAdapter, attributes)
                manager != null
            }.getOrDefault(false)
        }
    }
}

/**
 * The production [FrameSynchronizer] backed by the Compose frame clock — the native analogue of
 * `requestAnimationFrame`. [FrameSynchronizer.awaitFrame] suspends on `withFrameNanos` for exactly one paint
 * cycle so a caller's pre-print Compose state (expanded panels, switched tabs) has committed before the
 * dialog snapshots the document.
 */
@Composable
fun rememberFrameSynchronizer(): FrameSynchronizer =
    remember {
        FrameSynchronizer {
            // Await a single compositor frame so any pre-print Compose state has committed (web rAF).
            withFrameNanos {}
        }
    }

/**
 * A one-click print button — the native `PrintButton`. On tap it runs the optional [beforePrint] setup hook,
 * gives the UI one frame to flush the resulting state, and opens the system print dialog through [launcher];
 * a second tap while a print is in flight is ignored (web `if (printing) return`). Defaults match the web
 * source (ghost / sm, "Print" label); the opt-in props mirror the web component.
 *
 * @param launcher the system-print seam — the native `window.print()`. Build one with
 *   [rememberSystemPrintLauncher], or supply a host-specific implementation.
 * @param label overrides the default "Print" label with a fixed string (web `label`).
 * @param iconOnly drop the visible label for dense placements / action bars (web `iconOnly`).
 * @param variant button emphasis; defaults to [ButtonVariant.Ghost] (web `variant`).
 * @param size button size; defaults to [ButtonSize.Sm] (web `size`).
 * @param ariaLabel an explicit accessible-name override (web `ariaLabel`); auto-derived when [iconOnly].
 * @param enabled when false the button is inert and marked disabled to assistive tech (web `disabled`).
 * @param beforePrint optional setup hook awaited before the dialog opens (web `beforePrint`).
 * @param key disambiguates this placement's state holder when several print buttons share a call site;
 *   defaults to a stable per-placement id.
 * @param frame the one-frame flush seam; defaults to the Compose frame clock ([rememberFrameSynchronizer]).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun PrintButton(
    launcher: PrintLauncher,
    modifier: Modifier = Modifier,
    label: String? = null,
    iconOnly: Boolean = false,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    ariaLabel: String? = null,
    enabled: Boolean = true,
    beforePrint: (suspend () -> Unit)? = null,
    key: Any? = null,
    frame: FrameSynchronizer = rememberFrameSynchronizer(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val instanceKey = rememberSaveable { randomPrintButtonInstanceId() }
    val viewModel: PrintButtonViewModel =
        viewModel(
            key = "${PrintButtonRegistration.ID}:${key?.toString() ?: instanceKey}",
            factory = PrintButtonViewModel.factory(launcher, frame, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val printLabel = stringResource(R.string.translation_common_printButton_print)

    PrintButtonContent(
        visibleLabel = printButtonVisibleLabel(iconOnly = iconOnly, labelOverride = label, printLabel = printLabel),
        accessibleLabel =
            printButtonAccessibleLabel(
                iconOnly = iconOnly,
                ariaLabel = ariaLabel,
                labelOverride = label,
                printLabel = printLabel,
            ),
        iconOnly = iconOnly,
        onPrint = { viewModel.print(beforePrint) },
        modifier = modifier,
        variant = variant,
        size = size,
        enabled = enabled,
    )
}

/**
 * Stateless renderer for the PrintButton — the test / preview entry point. Draws the labelled button
 * (Printer glyph + "Print" / [visibleLabel]) or, for [iconOnly], the bare icon button, and exposes
 * [accessibleLabel] as the accessible name when set (web `aria-label`). Carries the same re-entry guard
 * contract as the web source: the rendered button is identical whether a print is in flight or not (the web
 * Button references `disabled`, never `printing`).
 */
@Composable
fun PrintButtonContent(
    visibleLabel: String?,
    accessibleLabel: String?,
    iconOnly: Boolean,
    onPrint: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    enabled: Boolean = true,
) {
    if (iconOnly) {
        IconButton(
            imageVector = TeslaGlyphs.Printer,
            contentDescription = accessibleLabel ?: visibleLabel.orEmpty(),
            onClick = onPrint,
            modifier = modifier.testTag(PrintButtonRegistration.ROOT_TEST_TAG),
            enabled = enabled,
            variant = IconButtonVariant.Standard,
            size = IconSize.Sm,
        )
    } else {
        Button(
            label = visibleLabel.orEmpty(),
            onClick = onPrint,
            modifier =
                modifier
                    .testTag(PrintButtonRegistration.ROOT_TEST_TAG)
                    .semantics { if (accessibleLabel != null) contentDescription = accessibleLabel },
            variant = variant,
            size = size,
            enabled = enabled,
            leadingIcon = TeslaGlyphs.Printer,
        )
    }
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

@Preview(name = "PrintButton — labeled", showBackground = true)
@Composable
private fun PrintButtonLabeledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrintButtonContent(
            visibleLabel = "Print",
            accessibleLabel = null,
            iconOnly = false,
            onPrint = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "PrintButton — labeled (dark)", showBackground = true)
@Composable
private fun PrintButtonLabeledDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PrintButtonContent(
            visibleLabel = "Print",
            accessibleLabel = null,
            iconOnly = false,
            onPrint = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "PrintButton — icon only", showBackground = true)
@Composable
private fun PrintButtonIconOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrintButtonContent(
            visibleLabel = null,
            accessibleLabel = "Print",
            iconOnly = true,
            onPrint = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "PrintButton — disabled", showBackground = true)
@Composable
private fun PrintButtonDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrintButtonContent(
            visibleLabel = "Print",
            accessibleLabel = null,
            iconOnly = false,
            onPrint = {},
            enabled = false,
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
