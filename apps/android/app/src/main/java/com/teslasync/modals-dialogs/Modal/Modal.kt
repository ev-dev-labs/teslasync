// Compose render layer for the Modal modal/dialog surface — the native analogue of the JSX the web component returns
// (web/src/components/ui/Modal.tsx, the shared overlay primitive). It is a thin shell over the pure
// [ModalProjection] derivations (ModalModel.kt): it projects the props, gates composition on `open`, records the
// one-shot `view.opened` diagnostic (P1/S11), and renders the backdrop + titled/anonymous card by delegating to the
// sanctioned atomic `components/ui/Modal` (the native Material 3 `Dialog`-backed primitive), so the surface composes
// the shared overlay rather than re-implementing it.
//
// Parity of the web behaviours:
//   - `open` gate -> host-gated composition: `if (!display.open) return`, mirroring the web `if (!open) return null`.
//   - title header + close button -> the atomic Modal renders the heading + a >=48 dp close `IconButton` whenever a
//     non-blank `title` is passed; the close affordance's accessible name is the localized `common.close` copy
//     (P1/S10) — there is no English literal in this file.
//   - `aria-labelledby` / `aria-label` -> the projected [ModalDisplay.accessibleName] is fed to the dialog's
//     `paneTitle` semantics: the heading names a titled dialog, the caller's `ariaLabel` names an anonymous one.
//   - `size` -> the projected max-width ceiling ([ModalProjection.maxWidthDp]) is applied as a `widthIn(max=…)`
//     constraint on the card (P1/S9 tokens; the design-system `--modal-max` ceiling is enforced by the atomic Modal).
//   - backdrop click / Esc / focus trap -> handled by the platform `Dialog` the atomic Modal renders into (which is
//     also why the web `useImperativeHandle` ref has no native analogue — the platform moves + traps focus itself).
//   - scrollable body -> the caller's `content` is hosted in the atomic Modal's scrollable column (web `children`).
//
// The view performs NO HTTP and owns no store: the web component binds no data hook (its only inputs are presentation
// props plus the presentational `useId` / `useImperativeHandle` utilities; see ModalModel.kt), so the owning surface
// that fills the modal carries any data lifecycle.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/modals-dialogs/Modal)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations (the test tags + the tooling-only previews).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.modal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.ui.Modal as UiModal

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object ModalTestTags {
    const val ROOT: String = "modal-surface"
}

/**
 * Stateful entry point — the faithful 1:1 port of the web `Modal({ open, onClose, title, size, children, ariaLabel })`.
 * Projects the props via the pure [ModalProjection], gates composition on `open` (web `if (!open) return null`),
 * records the one-shot PII-safe `view.opened` diagnostic (P1/S11) when it opens, and renders the backdrop + card by
 * delegating to the atomic `components/ui/Modal`. The owning surface controls `open` and supplies the [content].
 *
 * @param open whether the overlay is shown (web `open`).
 * @param onClose dismiss handler invoked by the close button, a backdrop tap, and the system back / Esc (web
 *   `onClose`).
 * @param title optional visible heading; when present the dialog renders a header and is labelled by it. A blank value
 *   is treated as absent (web `title &&`).
 * @param ariaLabel accessible name used when no [title] is shown — required by ARIA for a dialog with no visible
 *   heading (web `ariaLabel`).
 * @param size width preset capping the card at the `>= sm` breakpoint (web `size`, default `md`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer` (P1/S11).
 * @param content the modal body, hosted in the atomic Modal's scrollable column (web `children`).
 */
@Composable
fun Modal(
    open: Boolean,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    ariaLabel: String? = null,
    size: ModalSize = ModalSize.Md,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable ColumnScope.() -> Unit,
) {
    val display =
        remember(open, title, ariaLabel, size) {
            ModalProjection.project(open = open, title = title, ariaLabel = ariaLabel, size = size)
        }
    if (!display.open) return

    LaunchedEffect(Unit) { recordModalOpened(logger) }

    UiModal(
        onDismissRequest = onClose,
        modifier =
            modifier
                .testTag(ModalTestTags.ROOT)
                .widthIn(max = ModalProjection.maxWidthDp(display.size).dp),
        title = display.title,
        accessibleName = display.accessibleName,
        closeLabel = stringResource(R.string.translation_common_close),
        dismissOnBackdrop = true,
        content = content,
    )
}

// ── Previews (tooling-only; the @Preview entry points exercise the render branches the web source defines) ──────────

/** A no-op logger so the previews render without an ambient `LocalDataContainer` provider. */
private val PreviewLogger: Logger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

/** Representative body content a modal hosts — a short summary line plus a primary acknowledgement action. */
@Composable
private fun ModalDemoBody() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BodyText(text = "Your vehicle's latest battery-health snapshot is shown here once it finishes syncing.")
        Button(label = "Got it", onClick = {}, variant = ButtonVariant.Primary)
    }
}

@Preview(name = "Titled modal — md", showBackground = true, widthDp = 420, heightDp = 640)
@Composable
private fun ModalTitledMdPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Modal(open = true, onClose = {}, title = "Battery health", size = ModalSize.Md, logger = PreviewLogger) {
            ModalDemoBody()
        }
    }
}

@Preview(name = "Anonymous modal — ariaLabel, full", showBackground = true, widthDp = 600, heightDp = 640)
@Composable
private fun ModalAnonymousFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Modal(open = true, onClose = {}, ariaLabel = "Battery details", size = ModalSize.Full, logger = PreviewLogger) {
            ModalDemoBody()
        }
    }
}

@Preview(name = "Compact modal — sm", showBackground = true, widthDp = 360, heightDp = 560)
@Composable
private fun ModalCompactSmPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Modal(open = true, onClose = {}, title = "Confirm action", size = ModalSize.Sm, logger = PreviewLogger) {
            ModalDemoBody()
        }
    }
}
