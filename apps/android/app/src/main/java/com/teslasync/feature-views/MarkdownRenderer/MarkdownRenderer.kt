// The native Jetpack Compose + Material 3 MarkdownRenderer feature view — a parity port of
// web/src/features/system/components/chatbot/MarkdownRenderer.tsx. The web component renders one assistant chat
// message as sanitized markdown: react-markdown + remark-gfm are lazy-loaded behind `React.lazy()`, with a
// `<Suspense fallback>` that shows the raw text (whitespace preserved) until the chunk arrives; once loaded a
// `components` map styles each element (inline + fenced `code`, `a`, `ul`/`ol`, `h1`-`h3`, `table`/`th`/`td`)
// and fenced code is delegated to a CodeBlock (language tag + copy button). It is safe-by-default — no
// `rehype-raw`, so embedded HTML renders as escaped text and links open in a new tab with
// `rel="noopener noreferrer"`.
//
// This surface keeps that contract end to end. Parsing + the safe-by-default + safe-link behaviour live in the
// framework-free [MarkdownParser]/[MarkdownInlineParser] (unit-tested off-device); this file is the thin render
// layer. The web's two render branches are reproduced as explicit, testable states — the `<Suspense fallback>`
// raw-text view ([loading]) and the parsed markdown tree — plus a friendly empty surface for blank input so the
// bubble is never a blank box. The web binds no data hook and performs no fetch, so there is no error / stale /
// offline lifecycle to render here (modelling those would invent behaviour the source lacks — the same anti-
// drift stance the sibling JwtDecoder surface documents). `view.opened` is emitted once via the sanctioned
// redacting logger (P1/S11).
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes: web `--text-primary`→onSurface, `--text-secondary`→onSurfaceVariant, `--surface-2`/`--surface-overlay`
// →surfaceVariant, `--border-subtle`→outlineVariant, the purple link → the Material `primary` accent. Links are
// rendered as `LinkAnnotation.Url` spans, which open through the platform URI handler (the native "new tab")
// and only for http(s)/mailto targets — the native analogue of react-markdown's default URL transform.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MarkdownRenderer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.markdownrenderer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Test tag on the parsed-markdown container (the web `prose-chat` div). */
const val MARKDOWN_CONTENT_TAG: String = "markdown.content"

/** Test tag on the raw-text fallback (the web `<Suspense fallback>`). */
const val MARKDOWN_FALLBACK_TAG: String = "markdown.fallback"

private val QUOTE_BAR_WIDTH = 3.dp
private const val QUOTE_BAR_ALPHA = 0.5f
private val CELL_BORDER_WIDTH = 1.dp

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders the
 * presentational [MarkdownRendererContent] for the assistant [children] markdown. Parsing is memoized by the
 * content layer, so recomposition does not re-parse unchanged text.
 *
 * @param children raw markdown source — web `MarkdownRendererProps.children`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MarkdownRenderer(
    children: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MarkdownRendererDiagnostics.recordViewOpened(logger) }
    MarkdownRendererContent(markdown = children, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web composition: a blank input
 * shows a friendly empty surface (where the web would render nothing — a blank box is forbidden), [loading]
 * shows the web `<Suspense fallback>` raw whitespace-preserved text, and otherwise the parsed markdown tree is
 * rendered in a vertically-spaced column (web `prose-chat space-y-1`).
 *
 * @param markdown raw markdown source (web `children`).
 * @param loading true to render the raw-text fallback instead of the parsed tree (web's lazy-load state).
 */
@Composable
fun MarkdownRendererContent(
    markdown: String,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
) {
    val blocks = remember(markdown) { if (markdown.isBlank()) emptyList() else MarkdownParser.parse(markdown) }
    when {
        markdown.isBlank() -> EmptyState(message = stringResource(R.string.translation_common_noData), modifier = modifier)
        loading -> MarkdownFallback(markdown, modifier)
        else ->
            Column(
                modifier = modifier.fillMaxWidth().testTag(MARKDOWN_CONTENT_TAG),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                blocks.forEach { RenderBlock(it) }
            }
    }
}

/** The web `<Suspense fallback>`: the raw text with line breaks preserved (Compose `Text` keeps `\n`). */
@Composable
private fun MarkdownFallback(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier.fillMaxWidth().testTag(MARKDOWN_FALLBACK_TAG),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun RenderBlock(block: MarkdownBlock) {
    when (block) {
        is MarkdownBlock.Heading -> MarkdownHeading(block.level, block.content)
        is MarkdownBlock.Paragraph -> MarkdownParagraph(block.content)
        is MarkdownBlock.BulletList -> MarkdownBulletList(block.items)
        is MarkdownBlock.OrderedList -> MarkdownOrderedList(block.start, block.items)
        is MarkdownBlock.CodeBlock -> MarkdownCodeBlock(block.language, block.code)
        is MarkdownBlock.BlockQuote -> MarkdownBlockQuote(block.content)
        MarkdownBlock.ThematicBreak -> HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        is MarkdownBlock.Table -> MarkdownTable(block.header, block.alignments, block.rows)
    }
}

@Composable
private fun MarkdownParagraph(content: List<MarkdownInline>) {
    MarkdownText(content, MaterialTheme.typography.bodyMedium, Modifier.fillMaxWidth())
}

@Composable
private fun MarkdownHeading(
    level: Int,
    content: List<MarkdownInline>,
) {
    val typography = MaterialTheme.typography
    val base =
        when (level) {
            1 -> typography.titleMedium
            2, 3 -> typography.titleSmall
            else -> typography.bodyMedium
        }
    MarkdownText(
        content,
        base.copy(fontWeight = FontWeight.SemiBold),
        Modifier.fillMaxWidth().padding(top = Spacing.xs),
    )
}

@Composable
private fun MarkdownBulletList(items: List<List<MarkdownInline>>) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        items.forEach { item -> MarkdownListItem(marker = "\u2022", content = item) }
    }
}

@Composable
private fun MarkdownOrderedList(
    start: Int,
    items: List<List<MarkdownInline>>,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        items.forEachIndexed { index, item -> MarkdownListItem(marker = "${start + index}.", content = item) }
    }
}

@Composable
private fun MarkdownListItem(
    marker: String,
    content: List<MarkdownInline>,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Text(
            text = marker,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        MarkdownText(content, MaterialTheme.typography.bodyMedium, Modifier.weight(1f))
    }
}

@Composable
private fun MarkdownBlockQuote(content: List<MarkdownInline>) {
    Row(
        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .width(QUOTE_BAR_WIDTH)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = QUOTE_BAR_ALPHA)),
        )
        MarkdownText(
            content,
            MaterialTheme.typography.bodyMedium,
            Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Fenced code block — the native CodeBlock the web `MarkdownRenderer` delegates to: a bordered surface with a
 * header (uppercase language tag + a copy-to-clipboard button) and a horizontally-scrollable monospace body. No
 * syntax highlighting, matching the web (which keeps its bundle lean for the short snippets the assistant emits).
 */
@Composable
private fun MarkdownCodeBlock(
    language: String?,
    code: String,
) {
    val label =
        (language?.trim()?.ifEmpty { null } ?: MarkdownRendererI18n.DEFAULT_CODE_LANGUAGE)
            .uppercase(Locale.getDefault())
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CELL_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = Spacing.md, end = Spacing.xs, top = Spacing.xs),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                CopyButton(
                    text = code,
                    copyLabel = stringResource(R.string.translation_common_copyButton_copy),
                    copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                    iconOnly = true,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Text(
                text = code,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(Spacing.md),
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
                softWrap = false,
            )
        }
    }
}

/**
 * GFM pipe table — a bordered grid with a tinted header row, mirroring web `table`/`th`/`td`. Cells share the
 * row width via equal weights (a native adaptation of the web's `overflow-x-auto` for the narrow chat bubble);
 * rows are padded/truncated to the header column count so the grid stays rectangular for ragged input.
 */
@Composable
private fun MarkdownTable(
    header: List<List<MarkdownInline>>,
    alignments: List<MarkdownColumnAlign>,
    rows: List<List<List<MarkdownInline>>>,
) {
    val columns = header.size
    if (columns == 0) return
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = Spacing.xs)
                .border(CELL_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.sm)),
    ) {
        MarkdownTableRow(header, columns, alignments, isHeader = true)
        rows.forEach { row -> MarkdownTableRow(row, columns, alignments, isHeader = false) }
    }
}

@Composable
private fun MarkdownTableRow(
    cells: List<List<MarkdownInline>>,
    columns: Int,
    alignments: List<MarkdownColumnAlign>,
    isHeader: Boolean,
) {
    val background = if (isHeader) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent
    val weight = if (isHeader) FontWeight.SemiBold else FontWeight.Normal
    Row(modifier = Modifier.fillMaxWidth().background(background)) {
        for (column in 0 until columns) {
            val cell = cells.getOrElse(column) { emptyList() }
            val align = alignments.getOrElse(column) { MarkdownColumnAlign.Default }
            MarkdownText(
                inlines = cell,
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = weight),
                modifier =
                    Modifier
                        .weight(1f)
                        .border(CELL_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant)
                        .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                textAlign = toTextAlign(align),
            )
        }
    }
}

/**
 * Renders inline spans as a single styled [Text]. Theme colors (inline-code background, link accent) are
 * resolved here and baked into the [AnnotatedString], which is memoized so emphasis trees are not rebuilt on
 * every recomposition. Links become `LinkAnnotation.Url` spans — exposed to TalkBack as links and opened
 * through the platform URI handler.
 */
@Composable
private fun MarkdownText(
    inlines: List<MarkdownInline>,
    style: TextStyle,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    textAlign: TextAlign? = null,
) {
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val annotated =
        remember(inlines, codeBackground, linkColor) {
            buildAnnotatedString { appendInlines(inlines, codeBackground, linkColor) }
        }
    Text(text = annotated, modifier = modifier, style = style, color = color, textAlign = textAlign ?: TextAlign.Unspecified)
}

private fun AnnotatedString.Builder.appendInlines(
    inlines: List<MarkdownInline>,
    codeBackground: Color,
    linkColor: Color,
) {
    inlines.forEach { node ->
        when (node) {
            is MarkdownInline.Text -> append(node.text)
            is MarkdownInline.Bold ->
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInlines(node.children, codeBackground, linkColor) }
            is MarkdownInline.Italic ->
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInlines(node.children, codeBackground, linkColor) }
            is MarkdownInline.Strikethrough ->
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                    appendInlines(node.children, codeBackground, linkColor)
                }
            is MarkdownInline.Code ->
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground)) { append(node.text) }
            is MarkdownInline.Link -> appendLinkSpan(node, codeBackground, linkColor)
        }
    }
}

private fun AnnotatedString.Builder.appendLinkSpan(
    link: MarkdownInline.Link,
    codeBackground: Color,
    linkColor: Color,
) {
    val styles = TextLinkStyles(style = SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
    withLink(LinkAnnotation.Url(url = link.href, styles = styles)) {
        appendInlines(link.children, codeBackground, linkColor)
    }
}

private fun toTextAlign(align: MarkdownColumnAlign): TextAlign? =
    when (align) {
        MarkdownColumnAlign.Start -> TextAlign.Start
        MarkdownColumnAlign.Center -> TextAlign.Center
        MarkdownColumnAlign.End -> TextAlign.End
        MarkdownColumnAlign.Default -> null
    }
