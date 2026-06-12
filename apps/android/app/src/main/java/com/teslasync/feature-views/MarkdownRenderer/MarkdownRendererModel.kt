// Pure, framework-free model for the MarkdownRenderer feature view — the native analogue of everything
// web/src/features/system/components/chatbot/MarkdownRenderer.tsx delegates to react-markdown + remark-gfm
// before handing JSX back. No Compose, no Android, no HTTP: every type here is unit-tested off-device in
// the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is a pure presentational leaf — `({ children: string }) => rendered markdown`. It binds
// NO data hook and performs NO fetch (its parent ChatMessageItem owns the message text), so the cache-then-
// network lifecycle the data-bound surfaces carry (error / stale / offline) does not exist here; modelling
// those would invent behaviour the source lacks (drift) — the same reasoning the sibling JwtDecoder surface
// documents. The states the source actually defines are reproduced faithfully at the render boundary:
//   • blank input            → a friendly empty surface (never a blank box)
//   • lazy chunk still loading→ the web `<Suspense fallback>` raw whitespace-preserved text
//   • rendered               → the parsed markdown tree this model produces
//
// What react-markdown + remark-gfm RENDER (and therefore what this parser reproduces): ATX headings (#..######),
// paragraphs, **bold** / *italic* / ~~strikethrough~~ / `inline code`, [links](url) + <autolinks>, fenced code
// blocks (delegated to a CodeBlock surface), unordered + ordered lists, block quotes, thematic breaks, and GFM
// pipe tables. Parsing is delegated to react-markdown on the web; Android ships no react-markdown in the
// dependency set (and this artifact may not touch the build), so the equivalent block + inline parser lives
// here. It is robust by construction (it never throws — every ambiguous run folds back to literal text) and
// safe-by-default exactly like react-markdown without `rehype-raw`: only markdown syntax is recognized, so raw
// HTML such as `<script>alert(1)</script>` is emitted as a literal [MarkdownInline.Text] node, never executed.
// Link targets are restricted to http(s)/mailto ([isSafeMarkdownUrl]); an unsafe target keeps its label text
// but drops the navigation, the native analogue of react-markdown's default URL transform.
//
// Deeply nested lists are flattened to a single level — short assistant replies (this surface's only input)
// do not use them, and the web `ul/ol/li` mapping styles each level identically; this boundary is intentional
// and documented, not a hidden gap.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MarkdownRenderer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.markdownrenderer

import io.teslasync.shared.core.diagnostics.Logger

// ── Inline AST ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A span of inline content — the native analogue of the inline elements react-markdown emits inside a block
 * (`strong`, `em`, `del`, `code`, `a`, plain text). Modelling them as an exhaustive sealed hierarchy makes the
 * render mapping total and lets every span be asserted off-device.
 */
sealed interface MarkdownInline {
    /** Literal text — also the safe sink for anything that is not recognized markdown (e.g. raw HTML tags). */
    data class Text(
        val text: String,
    ) : MarkdownInline

    /** `**strong**` / `__strong__` — web `strong`. */
    data class Bold(
        val children: List<MarkdownInline>,
    ) : MarkdownInline

    /** `*emphasis*` / `_emphasis_` — web `em`. */
    data class Italic(
        val children: List<MarkdownInline>,
    ) : MarkdownInline

    /** `~~struck~~` — remark-gfm `del`. */
    data class Strikethrough(
        val children: List<MarkdownInline>,
    ) : MarkdownInline

    /** `` `code` `` — web inline `code` (no `language-*` class). */
    data class Code(
        val text: String,
    ) : MarkdownInline

    /**
     * `[label](href)` or `<autolink>` — web `a` (opens in a new tab with `rel="noopener noreferrer"`). Only
     * produced for an [isSafeMarkdownUrl] target; an unsafe target keeps its [children] as plain text instead.
     */
    data class Link(
        val href: String,
        val children: List<MarkdownInline>,
    ) : MarkdownInline
}

// ── Block AST ────────────────────────────────────────────────────────────────────────────────────────────

/** Per-column alignment from a GFM table delimiter row (`:--`, `:-:`, `--:`). */
enum class MarkdownColumnAlign { Default, Start, Center, End }

/**
 * A top-level block — the native analogue of the block elements react-markdown emits and the web `components`
 * map customizes (`h1`-`h3`, `p`, `ul`, `ol`, fenced `code`, `blockquote`, `hr`, GFM `table`).
 */
sealed interface MarkdownBlock {
    /** ATX heading, [level] 1..6 — web `h1`/`h2`/`h3` are styled, deeper levels fall back to bold body. */
    data class Heading(
        val level: Int,
        val content: List<MarkdownInline>,
    ) : MarkdownBlock

    /** A paragraph of inline content — web `p`. */
    data class Paragraph(
        val content: List<MarkdownInline>,
    ) : MarkdownBlock

    /** `-`/`*`/`+` bullet list — web `ul`/`li`. Each item is inline content. */
    data class BulletList(
        val items: List<List<MarkdownInline>>,
    ) : MarkdownBlock

    /** `1.`/`1)` ordered list starting at [start] — web `ol`/`li`. Each item is inline content. */
    data class OrderedList(
        val start: Int,
        val items: List<List<MarkdownInline>>,
    ) : MarkdownBlock

    /** Fenced code block — web fenced `code`, delegated to the CodeBlock surface (language tag + copy). */
    data class CodeBlock(
        val language: String?,
        val code: String,
    ) : MarkdownBlock

    /** `>` block quote — web `blockquote`. */
    data class BlockQuote(
        val content: List<MarkdownInline>,
    ) : MarkdownBlock

    /** `---`/`***`/`___` thematic break — web `hr`. */
    data object ThematicBreak : MarkdownBlock

    /** GFM pipe table — web `table`/`th`/`td`. */
    data class Table(
        val header: List<List<MarkdownInline>>,
        val alignments: List<MarkdownColumnAlign>,
        val rows: List<List<List<MarkdownInline>>>,
    ) : MarkdownBlock
}

// ── URL safety ───────────────────────────────────────────────────────────────────────────────────────────

private val SAFE_URL_SCHEME = Regex("^(?:https?://|mailto:)", RegexOption.IGNORE_CASE)

/**
 * True when [url] is a navigation target the renderer may open — `http(s)://` or `mailto:`. Mirrors
 * react-markdown's default URL transform, which strips `javascript:`/`data:` and other unsafe schemes so a
 * malicious assistant reply can never turn a link into a script or redirect vector.
 */
fun isSafeMarkdownUrl(url: String): Boolean = SAFE_URL_SCHEME.containsMatchIn(url.trim())

// ── Inline parser ────────────────────────────────────────────────────────────────────────────────────────

/** Punctuation a leading backslash may escape into a literal (CommonMark escapable set, trimmed to ASCII). */
private const val ESCAPABLE = "\\`*_{}[]()#+-.!~>|"

/**
 * Pure inline scanner: turns one line of text into [MarkdownInline] spans. Never throws — any delimiter that
 * does not close folds back into literal text, so malformed emphasis or a stray bracket renders verbatim.
 */
object MarkdownInlineParser {
    /** Parses [text] into inline spans (empty list for empty input). */
    fun parse(text: String): List<MarkdownInline> = if (text.isEmpty()) emptyList() else Scanner(text).run()

    private class Scanner(
        private val src: String,
    ) {
        private val nodes = mutableListOf<MarkdownInline>()
        private val pending = StringBuilder()
        private var pos = 0

        fun run(): List<MarkdownInline> {
            while (pos < src.length) {
                if (!consumeMarker()) {
                    pending.append(src[pos])
                    pos++
                }
            }
            flushText()
            return nodes
        }

        private fun consumeMarker(): Boolean =
            when (src[pos]) {
                '\\' -> consumeEscape()
                '`' -> consumeCode()
                '[' -> consumeLink()
                '<' -> consumeAutolink()
                '*', '_' -> consumeEmphasis(src[pos])
                '~' -> consumeStrike()
                else -> false
            }

        private fun consumeEscape(): Boolean {
            val next = src.getOrNull(pos + 1)
            if (next == null || next !in ESCAPABLE) return false
            pending.append(next)
            pos += 2
            return true
        }

        private fun consumeCode(): Boolean {
            val open = runLength('`', pos)
            val close = findClosingRun('`', open, pos + open)
            if (close < 0) return false
            flushText()
            nodes += MarkdownInline.Code(trimCodeSpan(src.substring(pos + open, close)))
            pos = close + open
            return true
        }

        private fun consumeEmphasis(marker: Char): Boolean {
            val run = runLength(marker, pos)
            if (run >= 2 && consumeDelimited(marker, 2) { MarkdownInline.Bold(it) }) return true
            return consumeDelimited(marker, 1) { MarkdownInline.Italic(it) }
        }

        private fun consumeStrike(): Boolean {
            val start = pos + 2
            val close = if (runLength('~', pos) >= 2) findClosingRun('~', 2, start) else -1
            if (close < start) return false
            flushText()
            nodes += MarkdownInline.Strikethrough(parse(src.substring(start, close)))
            pos = close + 2
            return true
        }

        private fun consumeDelimited(
            marker: Char,
            width: Int,
            wrap: (List<MarkdownInline>) -> MarkdownInline,
        ): Boolean {
            val start = pos + width
            val close = findClosingRun(marker, width, start)
            if (close <= start) return false
            flushText()
            nodes += wrap(parse(src.substring(start, close)))
            pos = close + width
            return true
        }

        private fun consumeLink(): Boolean {
            val labelEnd = matchBracket(pos)
            val hasTarget = labelEnd >= 0 && src.getOrNull(labelEnd + 1) == '('
            val parenEnd = if (hasTarget) src.indexOf(')', labelEnd + 2) else -1
            if (parenEnd < 0) return false
            flushText()
            appendLink(src.substring(labelEnd + 2, parenEnd).trim(), src.substring(pos + 1, labelEnd))
            pos = parenEnd + 1
            return true
        }

        private fun consumeAutolink(): Boolean {
            val end = src.indexOf('>', pos + 1)
            val url = if (end > 0) src.substring(pos + 1, end) else ""
            if (end < 0 || url.any { it.isWhitespace() } || !isSafeMarkdownUrl(url)) return false
            flushText()
            nodes += MarkdownInline.Link(url, listOf(MarkdownInline.Text(url)))
            pos = end + 1
            return true
        }

        private fun appendLink(
            target: String,
            label: String,
        ) {
            val children = parse(label)
            if (isSafeMarkdownUrl(target)) {
                nodes += MarkdownInline.Link(target, children.ifEmpty { listOf(MarkdownInline.Text(target)) })
            } else {
                nodes += children.ifEmpty { listOf(MarkdownInline.Text(label)) }
            }
        }

        private fun matchBracket(start: Int): Int {
            var depth = 0
            var i = start
            while (i < src.length) {
                val c = src[i]
                if (c == '[') depth++
                if (c == ']' && --depth == 0) return i
                i++
            }
            return -1
        }

        private fun findClosingRun(
            marker: Char,
            width: Int,
            from: Int,
        ): Int {
            var i = from
            while (i < src.length) {
                if (src[i] == marker && runLength(marker, i) >= width) return i
                i++
            }
            return -1
        }

        private fun runLength(
            marker: Char,
            from: Int,
        ): Int {
            var i = from
            while (i < src.length && src[i] == marker) i++
            return i - from
        }

        private fun trimCodeSpan(raw: String): String {
            val surrounded = raw.length > 1 && raw.first() == ' ' && raw.last() == ' ' && raw.isNotBlank()
            return if (surrounded) raw.substring(1, raw.length - 1) else raw
        }

        private fun flushText() {
            if (pending.isNotEmpty()) {
                nodes += MarkdownInline.Text(pending.toString())
                pending.setLength(0)
            }
        }
    }
}

// ── Block parser ─────────────────────────────────────────────────────────────────────────────────────────

private const val MAX_HEADING_LEVEL = 6

/**
 * Pure block parser: turns raw markdown source into an ordered list of [MarkdownBlock]. Never throws. Line-
 * oriented (CommonMark blocks are line-delimited); inline content within each block is delegated to
 * [MarkdownInlineParser].
 */
object MarkdownParser {
    /** Parses [source] into blocks (empty list for blank input). */
    fun parse(source: String): List<MarkdownBlock> {
        val normalized = source.replace("\r\n", "\n").replace('\r', '\n')
        return Reader(normalized.split('\n')).read()
    }

    private class Reader(
        private val lines: List<String>,
    ) {
        private val blocks = mutableListOf<MarkdownBlock>()
        private var idx = 0

        fun read(): List<MarkdownBlock> {
            while (idx < lines.size) dispatch(lines[idx])
            return blocks
        }

        @Suppress("CyclomaticComplexMethod") // Flat block-type dispatch table, not branching logic.
        private fun dispatch(line: String) {
            when {
                line.isBlank() -> idx++
                isFence(line) -> readFence()
                isThematicBreak(line) -> appendThematicBreak()
                headingLevel(line) > 0 -> appendHeading(line)
                isBlockQuote(line) -> readBlockQuote()
                beginsTableAt(idx) -> readTable()
                bulletMarker(line) != null -> readBulletList()
                orderedMarker(line) != null -> readOrderedList()
                else -> readParagraph()
            }
        }

        private fun appendThematicBreak() {
            blocks += MarkdownBlock.ThematicBreak
            idx++
        }

        private fun appendHeading(line: String) {
            val t = line.trimStart()
            val level = t.takeWhile { it == '#' }.length
            val text =
                t
                    .drop(level)
                    .trim()
                    .trimEnd('#')
                    .trim()
            blocks += MarkdownBlock.Heading(level, MarkdownInlineParser.parse(text))
            idx++
        }

        private fun readFence() {
            val open = lines[idx].trimStart()
            val marker = if (open.startsWith("~~~")) "~~~" else "```"
            val info = open.removePrefix(marker).trim()
            val language = info.split(' ', '\t').firstOrNull()?.takeIf { it.isNotEmpty() }
            idx++
            val body = StringBuilder()
            while (idx < lines.size && !lines[idx].trimStart().startsWith(marker)) {
                if (body.isNotEmpty()) body.append('\n')
                body.append(lines[idx])
                idx++
            }
            if (idx < lines.size) idx++
            blocks += MarkdownBlock.CodeBlock(language, body.toString())
        }

        private fun readBlockQuote() {
            val buf = StringBuilder()
            while (idx < lines.size && isBlockQuote(lines[idx])) {
                val stripped = lines[idx].trimStart().removePrefix(">").removePrefix(" ")
                if (buf.isNotEmpty()) buf.append(' ')
                buf.append(stripped)
                idx++
            }
            blocks += MarkdownBlock.BlockQuote(MarkdownInlineParser.parse(buf.toString()))
        }

        private fun readTable() {
            val header = splitRow(lines[idx]).map { MarkdownInlineParser.parse(it) }
            val alignments = parseAligns(splitRow(lines[idx + 1]))
            idx += 2
            val rows = mutableListOf<List<List<MarkdownInline>>>()
            while (idx < lines.size && lines[idx].contains('|') && lines[idx].isNotBlank()) {
                rows += splitRow(lines[idx]).map { MarkdownInlineParser.parse(it) }
                idx++
            }
            blocks += MarkdownBlock.Table(header, alignments, rows)
        }

        private fun readBulletList() {
            val items = mutableListOf<List<MarkdownInline>>()
            while (idx < lines.size) {
                val content = bulletMarker(lines[idx]) ?: break
                items += MarkdownInlineParser.parse(content.trim())
                idx++
            }
            blocks += MarkdownBlock.BulletList(items)
        }

        private fun readOrderedList() {
            val items = mutableListOf<List<MarkdownInline>>()
            var start = 1
            while (idx < lines.size) {
                val marker = orderedMarker(lines[idx]) ?: break
                if (items.isEmpty()) start = marker.first
                items += MarkdownInlineParser.parse(marker.second.trim())
                idx++
            }
            blocks += MarkdownBlock.OrderedList(start, items)
        }

        private fun readParagraph() {
            val buf = StringBuilder()
            while (idx < lines.size && isParagraphLine(lines[idx]) && !beginsTableAt(idx)) {
                if (buf.isNotEmpty()) buf.append(' ')
                buf.append(lines[idx].trim())
                idx++
            }
            if (buf.isNotEmpty()) blocks += MarkdownBlock.Paragraph(MarkdownInlineParser.parse(buf.toString()))
        }

        private fun beginsTableAt(at: Int): Boolean {
            val sep = lines.getOrNull(at + 1) ?: return false
            return lines[at].contains('|') && isTableDelimiter(sep)
        }

        private fun isParagraphLine(line: String): Boolean =
            line.isNotBlank() &&
                !isFence(line) &&
                !isThematicBreak(line) &&
                headingLevel(line) == 0 &&
                !isBlockQuote(line) &&
                bulletMarker(line) == null &&
                orderedMarker(line) == null
    }
}

// ── Line classifiers (pure, shared by the Reader) ────────────────────────────────────────────────────────

private fun isFence(line: String): Boolean {
    val t = line.trimStart()
    return t.startsWith("```") || t.startsWith("~~~")
}

private fun isThematicBreak(line: String): Boolean {
    val t = line.trim()
    if (t.length < 3) return false
    val c = t.first()
    return (c == '-' || c == '*' || c == '_') && t.all { it == c || it == ' ' }
}

private fun headingLevel(line: String): Int {
    val t = line.trimStart()
    val hashes = t.takeWhile { it == '#' }.length
    val valid = hashes in 1..MAX_HEADING_LEVEL && (t.length == hashes || t[hashes] == ' ')
    return if (valid) hashes else 0
}

private fun isBlockQuote(line: String): Boolean = line.trimStart().startsWith(">")

private fun isTableDelimiter(line: String): Boolean {
    val cells = splitRow(line)
    return cells.isNotEmpty() &&
        cells.all { it.isNotEmpty() && it.contains('-') && it.all { ch -> ch == '-' || ch == ':' } }
}

private fun splitRow(line: String): List<String> =
    line
        .trim()
        .removePrefix("|")
        .removeSuffix("|")
        .split('|')
        .map { it.trim() }

private fun parseAligns(cells: List<String>): List<MarkdownColumnAlign> =
    cells.map { cell ->
        val left = cell.startsWith(':')
        val right = cell.endsWith(':')
        when {
            left && right -> MarkdownColumnAlign.Center
            right -> MarkdownColumnAlign.End
            left -> MarkdownColumnAlign.Start
            else -> MarkdownColumnAlign.Default
        }
    }

private fun bulletMarker(line: String): String? {
    val t = line.trimStart()
    val c = t.firstOrNull()
    val isBullet = (c == '-' || c == '*' || c == '+') && t.length >= 2 && t[1] == ' '
    return if (isBullet) t.substring(2) else null
}

private fun orderedMarker(line: String): Pair<Int, String>? {
    val t = line.trimStart()
    val digits = t.takeWhile { it.isDigit() }
    val after = t.getOrNull(digits.length)
    val noMarker = digits.isEmpty() || digits.length > 9 || (after != '.' && after != ')')
    if (noMarker) return null
    val rest = t.drop(digits.length + 1)
    val ok = rest.isEmpty() || rest.first() == ' '
    return if (ok) (digits.toIntOrNull() ?: 1) to rest.removePrefix(" ") else null
}

// ── i18n contract (web `t(...)` keys, verbatim) ──────────────────────────────────────────────────────────

/**
 * The catalog keys (P1/S10) the rendered surface resolves at the Compose boundary. The web source itself binds
 * no `t(...)` (it is anonymous markdown), but the two affordances it composes do: the fenced-code CopyButton
 * resolves `common.copyButton.copy`/`common.copyButton.copied`, matching web `components/ui/CopyButton`. The
 * empty surface uses the shared `common.noData`. The fenced-code language fallback (`text`) is a literal in the
 * web source (`language?.trim() || 'text'`), NOT translated copy, so it is kept verbatim. Centralized here so
 * no display string is an unrouted literal and the contract is pinned by [MarkdownRendererModelTest].
 */
object MarkdownRendererI18n {
    /** Web `t('common.copyButton.copy', 'Copy')` — the code-block copy affordance. */
    const val COPY_LABEL_KEY: String = "common.copyButton.copy"

    /** Web `t('common.copyButton.copied', 'Copied')` — the post-copy confirmation. */
    const val COPIED_LABEL_KEY: String = "common.copyButton.copied"

    /** Shared `common.noData` — the friendly empty surface for blank input. */
    const val EMPTY_MESSAGE_KEY: String = "common.noData"

    /** Web `language?.trim() || 'text'` — the fenced-code language tag fallback (a literal, not translated). */
    const val DEFAULT_CODE_LANGUAGE: String = "text"
}

// ── Registration + diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object MarkdownRendererRegistration {
    /** Stable surface id. */
    const val ID: String = "markdown-renderer"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MarkdownRenderer"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never the rendered
 * assistant text, link targets, or code-block content — so a diagnostics line can never leak conversation data.
 */
object MarkdownRendererDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to MarkdownRendererRegistration.SLUG))
    }
}
