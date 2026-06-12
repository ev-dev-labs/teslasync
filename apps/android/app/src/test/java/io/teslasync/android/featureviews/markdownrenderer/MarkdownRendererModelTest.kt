package io.teslasync.android.featureviews.markdownrenderer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MarkdownRenderer's pure parser — the native mirror of what react-markdown +
 * remark-gfm render in web/src/features/system/components/chatbot/MarkdownRenderer.tsx. Because the surface is
 * computational (parse markdown → AST, then a thin Compose layer renders each node 1:1), this is also the
 * per-state "snapshot": every [MarkdownBlock]/[MarkdownInline] the parser emits is exactly what the composable
 * renders. The safe-by-default contract (raw HTML → literal text, like react-markdown without `rehype-raw`), the
 * safe-link transform, the i18n key contract, and the PII-safe diagnostic are pinned here too. Runs in the
 * :app:testReleaseUnitTest gate; the on-device render + accessibility are covered by MarkdownRendererUiTest.
 */
class MarkdownRendererModelTest {
    private fun inline(md: String): List<MarkdownInline> = MarkdownInlineParser.parse(md)

    private fun blocks(md: String): List<MarkdownBlock> = MarkdownParser.parse(md)

    private fun flatten(inlines: List<MarkdownInline>): String =
        buildString {
            inlines.forEach { node ->
                when (node) {
                    is MarkdownInline.Text -> append(node.text)
                    is MarkdownInline.Code -> append(node.text)
                    is MarkdownInline.Bold -> append(flatten(node.children))
                    is MarkdownInline.Italic -> append(flatten(node.children))
                    is MarkdownInline.Strikethrough -> append(flatten(node.children))
                    is MarkdownInline.Link -> append(flatten(node.children))
                }
            }
        }

    // ── Inline spans (web strong / em / del / code / a) ───────────────────────────

    @Test
    fun parsesBoldItalicStrikethroughAndCode() {
        assertEquals(listOf(MarkdownInline.Bold(listOf(MarkdownInline.Text("b")))), inline("**b**"))
        assertEquals(listOf(MarkdownInline.Italic(listOf(MarkdownInline.Text("i")))), inline("*i*"))
        assertEquals(listOf(MarkdownInline.Italic(listOf(MarkdownInline.Text("u")))), inline("_u_"))
        assertEquals(listOf(MarkdownInline.Strikethrough(listOf(MarkdownInline.Text("s")))), inline("~~s~~"))
        assertEquals(listOf(MarkdownInline.Code("x = 1")), inline("`x = 1`"))
    }

    @Test
    fun interleavesTextAndEmphasis() {
        val expected =
            listOf(
                MarkdownInline.Text("a "),
                MarkdownInline.Bold(listOf(MarkdownInline.Text("b"))),
                MarkdownInline.Text(" c"),
            )
        assertEquals(expected, inline("a **b** c"))
    }

    @Test
    fun parsesNestedEmphasis() {
        val inner = listOf(MarkdownInline.Italic(listOf(MarkdownInline.Text("x"))))
        assertEquals(listOf(MarkdownInline.Bold(inner)), inline("**_x_**"))
    }

    @Test
    fun parsesSafeLinkAndAutolink() {
        assertEquals(
            listOf(MarkdownInline.Link("https://tesla.com", listOf(MarkdownInline.Text("Tesla")))),
            inline("[Tesla](https://tesla.com)"),
        )
        assertEquals(
            listOf(MarkdownInline.Link("https://a.io", listOf(MarkdownInline.Text("https://a.io")))),
            inline("<https://a.io>"),
        )
    }

    @Test
    fun unsafeLinkDropsNavigationButKeepsLabel() {
        // react-markdown's default URL transform strips javascript:/data: — the label stays, the link does not.
        val result = inline("[click](data:text/html)")
        assertTrue("expected no Link node, was $result", result.none { it is MarkdownInline.Link })
        assertEquals("click", flatten(result))
    }

    @Test
    fun honorsBackslashEscapes() {
        assertEquals(listOf(MarkdownInline.Text("*not bold*")), inline("\\*not bold\\*"))
    }

    @Test
    fun unterminatedEmphasisFoldsBackToLiteralText() {
        assertEquals("**bold", flatten(inline("**bold")))
        assertEquals("`code", flatten(inline("`code")))
        assertTrue(inline("**bold").none { it is MarkdownInline.Bold })
    }

    @Test
    fun emptyInputProducesNothing() {
        assertEquals(emptyList<MarkdownInline>(), inline(""))
        assertEquals(emptyList<MarkdownBlock>(), blocks(""))
        assertEquals(emptyList<MarkdownBlock>(), blocks("   \n  \n"))
    }

    // ── Blocks (web h1-h3 / p / ul / ol / code / blockquote / hr / table) ──────────

    @Test
    fun parsesHeadingLevels() {
        assertEquals(MarkdownBlock.Heading(1, listOf(MarkdownInline.Text("Title"))), blocks("# Title").single())
        assertEquals(MarkdownBlock.Heading(3, listOf(MarkdownInline.Text("Sub"))), blocks("### Sub").single())
    }

    @Test
    fun tooManyHashesIsAParagraphNotAHeading() {
        // Seven `#` exceeds the ATX maximum (6) → react-markdown renders it as a paragraph.
        val block = blocks("####### x").single()
        assertTrue("expected Paragraph, was $block", block is MarkdownBlock.Paragraph)
    }

    @Test
    fun joinsSoftWrappedParagraphLines() {
        val block = blocks("line one\nline two").single()
        assertEquals(MarkdownBlock.Paragraph(listOf(MarkdownInline.Text("line one line two"))), block)
    }

    @Test
    fun parsesBulletList() {
        val block = blocks("- a\n- b\n- c").single()
        val expected =
            MarkdownBlock.BulletList(
                listOf(
                    listOf(MarkdownInline.Text("a")),
                    listOf(MarkdownInline.Text("b")),
                    listOf(MarkdownInline.Text("c")),
                ),
            )
        assertEquals(expected, block)
    }

    @Test
    fun parsesOrderedListPreservingStart() {
        val block = blocks("3. first\n4. second").single()
        assertTrue(block is MarkdownBlock.OrderedList)
        block as MarkdownBlock.OrderedList
        assertEquals(3, block.start)
        assertEquals(2, block.items.size)
        assertEquals("first", flatten(block.items[0]))
    }

    @Test
    fun parsesFencedCodeBlockWithLanguage() {
        val block = blocks("```go\nfmt.Println()\nx := 1\n```").single()
        assertEquals(MarkdownBlock.CodeBlock("go", "fmt.Println()\nx := 1"), block)
    }

    @Test
    fun parsesFencedCodeBlockWithoutLanguage() {
        assertEquals(MarkdownBlock.CodeBlock(null, "plain"), blocks("```\nplain\n```").single())
    }

    @Test
    fun fencedCodeIsNotInterpretedAsMarkdown() {
        // Asterisks/brackets inside a fence are verbatim payload, never emphasis or links.
        val block = blocks("```\n**not bold** [x](y)\n```").single()
        assertEquals(MarkdownBlock.CodeBlock(null, "**not bold** [x](y)"), block)
    }

    @Test
    fun parsesBlockQuote() {
        assertEquals(MarkdownBlock.BlockQuote(listOf(MarkdownInline.Text("quoted"))), blocks("> quoted").single())
    }

    @Test
    fun parsesThematicBreak() {
        assertEquals(MarkdownBlock.ThematicBreak, blocks("---").single())
        assertEquals(MarkdownBlock.ThematicBreak, blocks("***").single())
    }

    @Test
    fun parsesGfmTableWithAlignments() {
        val table = blocks("| A | B | C |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |").single()
        assertTrue(table is MarkdownBlock.Table)
        table as MarkdownBlock.Table
        assertEquals(listOf("A", "B", "C"), table.header.map { flatten(it) })
        assertEquals(
            listOf(MarkdownColumnAlign.Start, MarkdownColumnAlign.Center, MarkdownColumnAlign.End),
            table.alignments,
        )
        assertEquals(1, table.rows.size)
        assertEquals(listOf("1", "2", "3"), table.rows.single().map { flatten(it) })
    }

    @Test
    fun parsesMixedDocumentInOrderWithoutLooping() {
        val md = "# Heading\n\nA paragraph.\n\n- item\n\n```\ncode\n```\n\n> quote\n\n---"
        val parsed = blocks(md)
        val kinds = parsed.map { it::class.simpleName }
        assertEquals(listOf("Heading", "Paragraph", "BulletList", "CodeBlock", "BlockQuote"), kinds.take(5))
        assertTrue(parsed.last() is MarkdownBlock.ThematicBreak)
    }

    @Test
    fun listItemRetainsInlineLink() {
        val block = blocks("- see [docs](https://docs.io)").single()
        block as MarkdownBlock.BulletList
        assertEquals(
            listOf(MarkdownInline.Text("see "), MarkdownInline.Link("https://docs.io", listOf(MarkdownInline.Text("docs")))),
            block.items.single(),
        )
    }

    // ── Safety: safe-by-default (web has no rehype-raw) ────────────────────────────

    @Test
    fun rawHtmlIsRenderedAsLiteralTextNeverExecuted() {
        val html = "<script>alert('xss')</script>"
        val block = blocks(html).single()
        assertTrue(block is MarkdownBlock.Paragraph)
        block as MarkdownBlock.Paragraph
        // Every span is literal text — there is no Link/Code/structural node a raw tag could have produced.
        assertTrue(block.content.all { it is MarkdownInline.Text })
        assertEquals(html, flatten(block.content))
    }

    @Test
    fun isSafeMarkdownUrlAllowsOnlyWebAndMailSchemes() {
        assertTrue(isSafeMarkdownUrl("http://x.com"))
        assertTrue(isSafeMarkdownUrl("https://x.com"))
        assertTrue(isSafeMarkdownUrl("HTTPS://X.COM"))
        assertTrue(isSafeMarkdownUrl("mailto:a@b.com"))
        assertFalse(isSafeMarkdownUrl("javascript:alert(1)"))
        assertFalse(isSafeMarkdownUrl("data:text/html;base64,xx"))
        assertFalse(isSafeMarkdownUrl("/relative/path"))
        assertFalse(isSafeMarkdownUrl("ftp://x.com"))
        assertFalse(isSafeMarkdownUrl(""))
    }

    // ── i18n key contract (web `t(...)` keys + literals, verbatim) ─────────────────

    @Test
    fun i18nKeysMatchTheWebSourceVerbatim() {
        assertEquals("common.copyButton.copy", MarkdownRendererI18n.COPY_LABEL_KEY)
        assertEquals("common.copyButton.copied", MarkdownRendererI18n.COPIED_LABEL_KEY)
        assertEquals("common.noData", MarkdownRendererI18n.EMPTY_MESSAGE_KEY)
        assertEquals("text", MarkdownRendererI18n.DEFAULT_CODE_LANGUAGE)
    }

    // ── Registration + PII-safe diagnostics (P1/S11) ──────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("markdown-renderer", MarkdownRendererRegistration.ID)
        assertEquals("MarkdownRenderer", MarkdownRendererRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        MarkdownRendererDiagnostics.recordViewOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "MarkdownRenderer"), opened.single().second)
    }

    @Test
    fun diagnosticNeverCarriesRenderedConversationText() {
        val logger = RecordingLogger()

        MarkdownRendererDiagnostics.recordViewOpened(logger)

        val fields = logger.events.single().second
        // Only the static surface slug is ever logged — never the assistant markdown, links, or code.
        assertEquals(setOf("surface"), fields.keys)
        assertEquals("MarkdownRenderer", fields.getValue("surface"))
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
