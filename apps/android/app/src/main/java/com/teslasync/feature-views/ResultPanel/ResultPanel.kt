// The native Jetpack Compose + Material 3 ResultPanel feature view — a parity port of
// web/src/features/admin/components/devtools/ResultPanel.tsx. It reproduces the web component's three render
// branches: an error line, the pretty-printed result inside a scrollable monospace block with a copy
// affordance, or an italic idle message. The web container tint
// (error → red / data → green / otherwise neutral) maps onto the shared [GlassPanel] border accent — the
// sanctioned native expression of the web "glow"/tint affordance. All derivations flow through the pure
// [ResultPanelProjection]; the composable is a thin render layer. Every interactive element (the copy
// button) carries a TalkBack label, and the copy button's own strings resolve through the i18n catalog
// (P1/S10) common.copyButton keys.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResultPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.resultpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

/** Web `<pre className="max-h-64 …">`: the result block scrolls past sixteen rem (256 dp) of content. */
private val CODE_BLOCK_MAX_HEIGHT = 256.dp

/**
 * Stateful entry point. Records the one-shot `view.opened` diagnostic, then renders the surface for the
 * given inputs. Mirrors the web `ResultPanel` props: [title] is the localized heading, [data] the optional
 * result payload, [error] the optional error message, and [idleMessage] the localized text shown when there
 * is neither error nor data (caller-supplied — see [ResultPanelProjection.project]).
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ResultPanel(
    title: String,
    idleMessage: String,
    modifier: Modifier = Modifier,
    data: JsonElement? = null,
    error: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ResultPanelDiagnostics.recordViewOpened(logger) }
    ResultPanelContent(
        title = title,
        idleMessage = idleMessage,
        modifier = modifier,
        data = data,
        error = error,
    )
}

/**
 * Stateless renderer for every branch — the unit/UI-test entry point. Reproduces the web component's tint +
 * three-way body: the [GlassPanel] accent carries the tone, the header shows the title plus the copy button
 * whenever there is data, and the body renders the error line, the pretty-printed result, or the idle
 * message.
 */
@Composable
fun ResultPanelContent(
    title: String,
    idleMessage: String,
    modifier: Modifier = Modifier,
    data: JsonElement? = null,
    error: String? = null,
) {
    val display =
        remember(title, data, error, idleMessage) {
            ResultPanelProjection.project(title, data, error, idleMessage)
        }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = display.tone.toAccent()) {
        ResultPanelHeader(display)
        ResultPanelBody(display)
    }
}

/** Web header row: the secondary-toned title (a heading for TalkBack) and, when there is data, the copy button. */
@Composable
private fun ResultPanelHeader(display: ResultPanelDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(display.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (display.showCopy) {
            CopyButton(
                text = display.copyText,
                copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
            )
        }
    }
}

@Composable
private fun ResultPanelBody(display: ResultPanelDisplay) {
    when (display.mode) {
        ResultPanelMode.Error -> ErrorText(display.bodyText, modifier = Modifier.fillMaxWidth())
        ResultPanelMode.Result -> ResultCodeBlock(display.bodyText)
        ResultPanelMode.Idle -> IdleMessage(display.bodyText)
    }
}

/**
 * Web `<pre>` block: the pretty-printed result on an overlay surface, monospaced, scrollable past
 * [CODE_BLOCK_MAX_HEIGHT]. The whole block is collapsed to a single accessible node so TalkBack reads the
 * payload as one utterance instead of line-by-line.
 */
@Composable
private fun ResultCodeBlock(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        CodeText(
            text = text,
            modifier =
                Modifier
                    .heightIn(max = CODE_BLOCK_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.sm)
                    .clearAndSetSemantics { contentDescription = text },
        )
    }
}

/** Web idle `<p className="… italic text-[var(--text-muted)]">`: the muted, italic idle message. */
@Composable
private fun IdleMessage(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun ResultPanelTone.toAccent(): PanelAccent =
    when (this) {
        ResultPanelTone.Neutral -> PanelAccent.None
        ResultPanelTone.Success -> PanelAccent.Success
        ResultPanelTone.Danger -> PanelAccent.Danger
    }
