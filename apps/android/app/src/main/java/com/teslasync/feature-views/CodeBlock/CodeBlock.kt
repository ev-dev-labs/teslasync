// The native Jetpack Compose + Material 3 CodeBlock feature view — a parity port of
// web/src/features/system/components/chatbot/CodeBlock.tsx. The web component wraps a fenced code snippet
// (handed to it by MarkdownRenderer) in a rounded, bordered overlay card: a slim header carries the fence
// language tag (monospace, uppercase, secondary text) on the left and an icon-only CopyButton — which
// copies the RAW text to the clipboard — on the right, above a horizontally-scrollable monospace
// `<pre><code>` body.
//
// This surface keeps that contract exactly. It is PURELY presentational: the web component binds no data
// hook (its only collaborators are the shared CopyButton and the cn() class helper), so there is no fetch
// and therefore no loading / error / stale / offline lifecycle to render — modelling one would be invented
// state the web source never has. The genuine, reachable states are the two reproduced here: a Content
// block (header + scrollable code) and — because a caller may hand an empty body — a friendly Empty state
// (the shared feedback EmptyState, never a blank box). The web ships no syntax highlighter (its own comment
// notes react-syntax-highlighter is outside the bundle budget), so the rendered code IS the raw text,
// exactly as the web `children ?? text` is the already-escaped plain text; that raw text is also the
// clipboard payload.
//
// Built from native primitives + design tokens (P1/S9), never ported Tailwind classes. The copy affordance
// labels come from the shared i18n catalog (P1/S10); the native-only empty hint resolves through the same
// facade with a by-name fallback (no new catalog key — this artifact's allowed-files scope). `view.opened`
// is emitted once through the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CodeBlock — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.codeblock

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// Hairline border around the card + divider under the header (web `border border-[var(--border-subtle)]`).
private val BORDER_WIDTH: Dp = 1.dp

// Local lucide `Code` glyph (the `< >` chevron pair) for the empty state — Android ships no equivalent
// without the frozen material-icons-extended artifact, so the surface authors its own monochrome 24×24
// stroked vector, recolored at render time by the feedback EmptyState's icon tint.
private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f

private val CodeGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Code",
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(16f, 18f)
                lineTo(22f, 12f)
                lineTo(16f, 6f)
                moveTo(8f, 6f)
                lineTo(2f, 12f)
                lineTo(8f, 18f)
            }
        }.build()

/**
 * Stateful entry point for the CodeBlock surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the localized strings, and classifies the props with the pure [CodeBlockModel] before
 * delegating to the stateless content. Performs no HTTP (ADR-002).
 *
 * @param text the raw snippet — the displayed code AND the clipboard payload (web `text`).
 * @param language the markdown fence language hint, e.g. `"ts"` / `"go"` (web `language`); a blank/absent
 *   hint falls back to `text`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CodeBlock(
    text: String,
    language: String? = null,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to CodeBlockRegistration.SLUG))
    }
    val strings = rememberCodeBlockStrings()
    val state = remember(language, text) { CodeBlockModel.stateFor(language, text) }
    CodeBlockContent(state = state, copyText = text, strings = strings, modifier = modifier)
}

/**
 * Resolves the localized strings once at the render boundary: the shared CopyButton copy/copied labels come
 * from the P1/S10 catalog, and the native-only empty hint resolves by-name with the web `t(key, default)`
 * fallback (the key exists in no catalog). Remembered against the resolved strings so a locale change
 * rebuilds the bundle.
 */
@Composable
private fun rememberCodeBlockStrings(): CodeBlockStrings {
    val context = LocalContext.current
    val copyLabel = stringResource(R.string.translation_common_copyButton_copy)
    val copiedLabel = stringResource(R.string.translation_common_copyButton_copied)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, CodeBlockDefaults.EMPTY_HINT)
    return remember(copyLabel, copiedLabel, emptyHint) {
        CodeBlockStrings(copyLabel = copyLabel, copiedLabel = copiedLabel, emptyHint = emptyHint)
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Draws the web card chrome (rounded,
 * bordered overlay) with an always-present header (language tag + CopyButton), a divider, and the body:
 * the verbatim code in a horizontally-scrollable monospace block (web `overflow-x-auto`), or — for an empty
 * body — a friendly [EmptyState]. The copy affordance is disabled in the empty branch (nothing to copy)
 * while staying present and TalkBack-labelled.
 */
@Composable
fun CodeBlockContent(
    state: CodeBlockState,
    copyText: String,
    strings: CodeBlockStrings,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            CodeBlockHeader(
                languageLabel = state.languageLabel,
                copyText = copyText,
                copyEnabled = state is CodeBlockState.Content,
                strings = strings,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            when (state) {
                is CodeBlockState.Content -> CodeBlockBody(code = state.code)
                is CodeBlockState.Empty ->
                    EmptyState(
                        message = strings.emptyHint,
                        icon = CodeGlyph,
                        modifier = Modifier.fillMaxWidth(),
                    )
            }
        }
    }
}

/**
 * The slim card header — the language tag beside the icon-only CopyButton (web `flex items-center
 * justify-between border-b ... px-3 py-1.5`). The button copies [copyText] and is [copyEnabled] only when
 * there is a snippet to copy; its label doubles as its TalkBack name.
 */
@Composable
private fun CodeBlockHeader(
    languageLabel: String,
    copyText: String,
    copyEnabled: Boolean,
    strings: CodeBlockStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LanguageLabel(languageLabel)
        CopyButton(
            text = copyText,
            copyLabel = strings.copyLabel,
            copiedLabel = strings.copiedLabel,
            iconOnly = true,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = copyEnabled,
        )
    }
}

/**
 * The fence language tag — monospace, uppercased, secondary text (web `font-mono uppercase tracking-wider
 * text-[11px] text-[var(--text-secondary)]`). Authored as a small monospace label because the shared
 * typography roles carry no monospace-secondary caption; the style is derived from the theme type ramp so
 * light / dark / high-contrast all stay correct.
 */
@Composable
private fun LanguageLabel(label: String) {
    Text(
        text = label.uppercase(Locale.ROOT),
        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
    )
}

/**
 * The code body — the verbatim snippet in a monospace [CodeText], wrapped in a horizontal scroller so long
 * lines pan instead of wrapping (web `<pre className="overflow-x-auto p-3">`). The padding sits inside the
 * scroller so it tracks the panned content.
 */
@Composable
private fun CodeBlockBody(code: String) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
    ) {
        CodeText(text = code, modifier = Modifier.padding(Spacing.md))
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}
