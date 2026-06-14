// The native Jetpack Compose + Material 3 Label shared surface — a parity port of web/src/components/ui/Label.tsx.
// The web surface is the form `<label>` accessibility primitive: it renders the caller's `children` and, when
// `required` is set, appends a decorative red `*` (marked `aria-hidden="true"` so a screen reader never voices the
// glyph as "asterisk") plus a `<VisuallyHidden>` span carrying the localized `t('form.required', 'required')`
// string, so the control's accessible name becomes "<label> required" (WCAG 3.3.2). It is pure presentational —
// the parent owns the content and the required flag, and the component's only hook is useTranslation.
//
// This native surface keeps that contract end to end. Every derivation flows through the pure [projectLabel] in
// LabelModel.kt; this composable is a thin render layer that lays out the label content in a single merged
// semantics node (the native analogue of the one `<label>` element and its one accessible name), draws the
// aria-hidden required glyph (its semantics cleared so assistive tech skips it, exactly like the web `*`), and
// appends the native [VisuallyHidden] surface carrying the localized required suffix from the P1/S10 catalog
// (`R.string.translation_form_required`) — the faithful map of the web `@/components/a11y` VisuallyHidden. A
// one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition. It performs NO HTTP and binds
// NO state holder (see LabelModel.kt for why the generic loading/empty/error/stale/offline states do not apply to
// a presentational primitive). The `text` overload is sugar for the common form-label case; both overloads share
// the one [LabelContent] render path so the VisuallyHidden required announcement is identical everywhere.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces/Label)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless content
// + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.label

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.visuallyhidden.VisuallyHidden
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of `<Label required={…}>{children}</Label>` for arbitrary content.
 * Records the one-shot `view.opened` diagnostic (P1/S11) on first composition, then renders the [content] with the
 * optional required marker. Performs no HTTP and binds no state holder (the web component is controlled; its
 * content and required flag are owned by the parent). [logger] defaults to the process logger.
 *
 * @param required whether the aria-hidden `*` and the screen-reader "required" suffix are shown (web `required`).
 * @param content the label content — the faithful port of the web `children`.
 */
@Composable
fun Label(
    modifier: Modifier = Modifier,
    required: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { LabelDiagnostics.recordViewOpened(logger) }
    LabelContent(modifier = modifier, required = required, content = content)
}

/**
 * Stateful convenience overload for the common case — a plain-text form label. Sugar for [Label] with the [text]
 * rendered through the shared [FieldLabelText] typography atom (so it tracks light / dark / high-contrast), going
 * through the very same required-marker + VisuallyHidden path as the slot overload.
 *
 * @param text the visible label text (the web `children` when they are a plain string).
 * @param required whether the aria-hidden `*` and the screen-reader "required" suffix are shown (web `required`).
 */
@Composable
fun Label(
    text: String,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    Label(modifier = modifier, required = required, logger = logger) {
        FieldLabelText(text)
    }
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Lays out the [content] and, when [required] (web
 * `{required && …}`), the aria-hidden required glyph and the localized screen-reader "required" suffix. The whole
 * row is one merged semantics node — the native analogue of the single `<label>` element with one accessible name
 * ("<content> required"): the visible `*` has its semantics cleared so assistive tech never voices it (web
 * `aria-hidden="true"`), and the appended [VisuallyHidden] contributes the localized requirement that a screen
 * reader reads in its place. Carries no diagnostics, so a parent rendering many labels never emits per-item events.
 */
@Composable
fun LabelContent(
    modifier: Modifier = Modifier,
    required: Boolean = false,
    content: @Composable () -> Unit,
) {
    val projection = projectLabel(required)
    val requiredText = stringResource(R.string.translation_form_required)
    Row(
        modifier = modifier.semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
        if (projection.showRequiredMarker) {
            Text(
                text = LABEL_REQUIRED_MARKER,
                modifier = Modifier.clearAndSetSemantics {},
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.error,
            )
            VisuallyHidden(text = requiredText)
        }
    }
}

// ── Previews (tooling-only; sample labels are never shipped UI) ──────────────────────────────────────────────

@Preview(name = "Label · optional", showBackground = true)
@Composable
private fun LabelOptionalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LabelContent { FieldLabelText("Display name") }
    }
}

@Preview(name = "Label · required", showBackground = true)
@Composable
private fun LabelRequiredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LabelContent(required = true) { FieldLabelText("Email") }
    }
}

@Preview(name = "Label · required (dark)", showBackground = true)
@Composable
private fun LabelRequiredDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        LabelContent(required = true) { FieldLabelText("Vehicle name") }
    }
}
