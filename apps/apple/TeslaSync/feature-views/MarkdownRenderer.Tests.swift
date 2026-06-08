//
//  MarkdownRenderer.Tests.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  Unit coverage for the chatbot markdown renderer's parser + projection — the testable core that ports
//  the web source's react-markdown + remark-gfm pipeline:
//    • Inline parser — `MarkdownInlineParser` (strong / em / del / code / link / autolink), the
//      safe-by-default HTML escaping (web "renders <script> as text, never executes"), `snake_case`
//      protection, and gfm autolink literals.
//    • Block parser — `MarkdownParser` (headings, paragraphs, fenced code, lists + gfm tasks + nesting,
//      blockquotes, gfm tables, thematic breaks).
//    • Projection — the surface slug (P1/S11), the plain-text projection, the document statistics, and the
//      per-phase accessibility summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets; the parser + projection are Foundation-only, so the
//  same assertions are also executed on a plain host during development (no bundle / no rendered view).
//

import XCTest
@testable import TeslaSync

// MARK: - Inline parser

@MainActor
final class MarkdownInlineParserTests: XCTestCase {
    func testStrongEmphasisStrikethrough() {
        XCTAssertEqual(MarkdownInlineParser.parse("a **b** c"), [.text("a "), .strong([.text("b")]), .text(" c")])
        XCTAssertEqual(MarkdownInlineParser.parse("*i*"), [.emphasis([.text("i")])])
        XCTAssertEqual(MarkdownInlineParser.parse("_j_"), [.emphasis([.text("j")])])
        XCTAssertEqual(MarkdownInlineParser.parse("~~x~~"), [.strikethrough([.text("x")])])
    }

    func testNestedEmphasis() {
        XCTAssertEqual(
            MarkdownInlineParser.parse("**bold _and italic_**"),
            [.strong([.text("bold "), .emphasis([.text("and italic")])])]
        )
    }

    func testUnderscoresInsideWordAreLiteral() {
        XCTAssertEqual(MarkdownInlineParser.parse("call foo_bar_baz now"), [.text("call foo_bar_baz now")])
    }

    func testInlineCodeIsLiteral() {
        XCTAssertEqual(
            MarkdownInlineParser.parse("run `npm i -D` now"),
            [.text("run "), .code("npm i -D"), .text(" now")]
        )
    }

    func testInlineCodeKeepsMarkdownPunctuationLiteral() {
        XCTAssertEqual(MarkdownInlineParser.parse("`a*b_c`"), [.code("a*b_c")])
    }

    func testLinkParsesDestinationTitleAndLabel() {
        let nodes = MarkdownInlineParser.parse("see [docs](https://x.io \"Title\") ok")
        guard case let .link(link) = nodes[1] else { return XCTFail("expected link node") }
        XCTAssertEqual(link.destination, "https://x.io")
        XCTAssertEqual(link.title, "Title")
        XCTAssertEqual(link.plainText, "docs")
        XCTAssertTrue(link.isSafeToOpen)
    }

    func testRawHtmlIsSanitizedToLiteralText() {
        // The web source's core security guarantee: a malicious assistant reply never executes.
        let nodes = MarkdownInlineParser.parse("<script>alert(1)</script>")
        XCTAssertEqual(MarkdownInlineText.flatten(nodes), "<script>alert(1)</script>")
        XCTAssertFalse(nodes.contains { if case .link = $0 { true } else { false } })
    }

    func testJavascriptSchemeLinkIsNotSafeToOpen() {
        let nodes = MarkdownInlineParser.parse("[x](javascript:alert(1))")
        guard case let .link(link) = nodes[0] else { return XCTFail("expected link node") }
        XCTAssertFalse(link.isSafeToOpen)
    }

    func testAngleAutolinkAndEmail() {
        guard case let .link(url) = MarkdownInlineParser.parse("<https://a.io>")[0] else {
            return XCTFail("expected url autolink")
        }
        XCTAssertEqual(url.destination, "https://a.io")
        guard case let .link(mail) = MarkdownInlineParser.parse("<me@x.io>")[0] else {
            return XCTFail("expected email autolink")
        }
        XCTAssertEqual(mail.destination, "mailto:me@x.io")
    }

    func testGfmBareUrlAutolink() {
        let nodes = MarkdownInlineParser.parse("visit https://teslasync.io now")
        XCTAssertEqual(nodes.count, 3)
        guard case let .link(link) = nodes[1] else { return XCTFail("expected autolink") }
        XCTAssertEqual(link.destination, "https://teslasync.io")
    }

    func testAutolinkTrimsTrailingPunctuationAndParen() {
        guard case let .link(link) = MarkdownInlineParser.parse("(see https://a.com).")[1] else {
            return XCTFail("expected autolink")
        }
        XCTAssertEqual(link.destination, "https://a.com")
    }

    func testHardLineBreakFromBackslash() {
        XCTAssertEqual(MarkdownInlineParser.parse("a\\\nb"), [.text("a"), .lineBreak, .text("b")])
    }

    func testBackslashEscapeKeepsPunctuationLiteral() {
        XCTAssertEqual(MarkdownInlineParser.parse("\\*not italic\\*"), [.text("*not italic*")])
    }
}

// MARK: - Block parser

@MainActor
final class MarkdownParserTests: XCTestCase {
    private func blocks(_ source: String) -> [MarkdownBlock] {
        MarkdownParser.parse(source).blocks
    }

    func testHeadings() {
        XCTAssertEqual(blocks("# Title"), [.heading(level: 1, inlines: [.text("Title")])])
        XCTAssertEqual(blocks("### Three ###"), [.heading(level: 3, inlines: [.text("Three")])])
    }

    func testParagraphSoftBreakJoinsLines() {
        XCTAssertEqual(blocks("hello\nworld"), [.paragraph([.text("hello world")])])
    }

    func testThematicBreak() {
        XCTAssertEqual(blocks("---"), [.thematicBreak])
        XCTAssertEqual(blocks("***"), [.thematicBreak])
    }

    func testFencedCodeCapturesLanguageAndBodyVerbatim() {
        guard case let .codeBlock(code) = blocks("```swift\nlet x = 1\nfoo()\n```")[0] else {
            return XCTFail("expected code block")
        }
        XCTAssertEqual(code.languageLabel, "swift")
        XCTAssertEqual(code.code, "let x = 1\nfoo()")
    }

    func testFencedCodeDefaultsLanguageLabelToText() {
        guard case let .codeBlock(code) = blocks("~~~\nplain\n~~~")[0] else {
            return XCTFail("expected code block")
        }
        XCTAssertEqual(code.languageLabel, "text")
        XCTAssertNil(code.language)
    }

    func testFencedCodeDoesNotParseInlineMarkup() {
        guard case let .codeBlock(code) = blocks("```\n**not bold** <script>\n```")[0] else {
            return XCTFail("expected code block")
        }
        XCTAssertEqual(code.code, "**not bold** <script>")
    }

    func testUnorderedAndOrderedLists() {
        guard case let .unorderedList(bullets) = blocks("- a\n- b\n- c")[0] else {
            return XCTFail("expected unordered list")
        }
        XCTAssertEqual(bullets.count, 3)
        guard case let .orderedList(start, items) = blocks("3. x\n4. y")[0] else {
            return XCTFail("expected ordered list")
        }
        XCTAssertEqual(start, 3)
        XCTAssertEqual(items.count, 2)
    }

    func testTaskListItems() {
        guard case let .unorderedList(items) = blocks("- [ ] alpha\n- [x] beta")[0] else {
            return XCTFail("expected task list")
        }
        XCTAssertEqual(items[0].task, .unchecked)
        XCTAssertEqual(items[1].task, .checked)
        XCTAssertEqual(MarkdownInlineText.flatten(items[0].inlines), "alpha")
        XCTAssertEqual(MarkdownInlineText.flatten(items[1].inlines), "beta")
    }

    func testNestedList() {
        guard case let .unorderedList(items) = blocks("- parent\n  - child\n  - child2")[0],
              case let .unorderedList(children)? = items.first?.children.first
        else {
            return XCTFail("expected nested list")
        }
        XCTAssertEqual(children.count, 2)
    }

    func testBlockquoteParsesInnerBlocks() {
        guard case let .blockquote(inner) = blocks("> quoted\n> more")[0],
              case let .paragraph(text)? = inner.first
        else {
            return XCTFail("expected blockquote")
        }
        XCTAssertEqual(MarkdownInlineText.flatten(text), "quoted more")
    }

    func testGfmTable() {
        let source = "| A | B |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |"
        guard case let .table(table) = blocks(source)[0] else { return XCTFail("expected table") }
        XCTAssertEqual(table.columnCount, 2)
        XCTAssertEqual(table.rows.count, 2)
        XCTAssertEqual(table.alignments, [.leading, .trailing])
        XCTAssertEqual(MarkdownInlineText.flatten(table.headers[0]), "A")
        XCTAssertEqual(MarkdownInlineText.flatten(table.rows[1][1]), "4")
    }

    func testTableRaggedRowIsPaddedToColumnWidth() {
        let source = "| A | B | C |\n| - | - | - |\n| 1 | 2 |"
        guard case let .table(table) = blocks(source)[0] else { return XCTFail("expected table") }
        XCTAssertEqual(table.rows[0].count, 3)
        XCTAssertTrue(table.rows[0][2].isEmpty)
    }

    func testBlankSourceYieldsEmptyDocument() {
        XCTAssertTrue(MarkdownParser.parse("   \n\n  ").isEmpty)
        XCTAssertTrue(MarkdownParser.parse("").isEmpty)
    }

    func testMixedDocumentStructure() {
        let source = """
        # Heading

        A paragraph with [a link](https://x.io) and `code`.

        - one
        - two

        ```go
        package main
        ```
        """
        let document = MarkdownParser.parse(source)
        XCTAssertEqual(document.blocks.count, 4)
        guard case .heading = document.blocks[0] else { return XCTFail("block 0 heading") }
        guard case .paragraph = document.blocks[1] else { return XCTFail("block 1 paragraph") }
        guard case .unorderedList = document.blocks[2] else { return XCTFail("block 2 list") }
        guard case .codeBlock = document.blocks[3] else { return XCTFail("block 3 code") }
    }
}

// MARK: - Projection (slug, plain text, stats, accessibility)

@MainActor
final class MarkdownRendererProjectionTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(MarkdownRendererSurface.slug, "MarkdownRenderer")
    }

    func testLinkSchemeHelper() {
        XCTAssertEqual(MarkdownLink.scheme(of: "https://x"), "https")
        XCTAssertEqual(MarkdownLink.scheme(of: "mailto:a@b.c"), "mailto")
        XCTAssertNil(MarkdownLink.scheme(of: "/relative"))
        XCTAssertNil(MarkdownLink.scheme(of: "#anchor"))
    }

    func testDocumentStatsCountsEachElement() {
        let source = """
        # Heading

        Para with [a](https://x.io) and [b](https://y.io).

        - one
        - two

        ```go
        package main
        ```

        > a quote with [c](https://z.io)
        """
        let stats = MarkdownDocumentStats.make(MarkdownParser.parse(source))
        XCTAssertEqual(stats.headings, 1)
        XCTAssertEqual(stats.lists, 1)
        XCTAssertEqual(stats.listItems, 2)
        XCTAssertEqual(stats.codeBlocks, 1)
        XCTAssertEqual(stats.blockquotes, 1)
        XCTAssertEqual(stats.links, 3)
    }

    func testPlainTextProjectionFlattensDocument() {
        let document = MarkdownParser.parse("# Title\n\nHello **world**.\n\n- a\n- b")
        let plain = MarkdownPlainText.render(document)
        XCTAssertTrue(plain.contains("Title"))
        XCTAssertTrue(plain.contains("Hello world."))
        XCTAssertTrue(plain.contains("• a"))
    }

    func testAccessibilitySummaryPerPhase() {
        let copy = MarkdownRendererCopy.fallback
        XCTAssertEqual(MarkdownRendererAccessibility.summary(for: .loading, copy: copy), copy.loadingLabel)
        XCTAssertEqual(MarkdownRendererAccessibility.summary(for: .ready, copy: copy), copy.documentLabel)
        XCTAssertEqual(MarkdownRendererAccessibility.summary(for: .empty, copy: copy), copy.emptyLabel)
        XCTAssertEqual(MarkdownRendererAccessibility.summary(for: .error("x"), copy: copy), copy.errorLabel)
    }
}
