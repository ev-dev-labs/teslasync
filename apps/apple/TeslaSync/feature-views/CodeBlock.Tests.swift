//
//  CodeBlock.Tests.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  Adapter + accessibility coverage for the chatbot fenced-code block surface:
//    • Snapshot — the `hasContent` blank/whitespace guard and the `resolvedLanguageLabel` rule (port of
//      the web `language?.trim() || 'text'`).
//    • Projector — the cached-snapshot → projection mapping (language tag, verbatim code body, clipboard
//      payload, line count incl. trailing-newline handling, and the VoiceOver label).
//    • Surface identity — the P1/S11 `view.opened` diagnostics slug.
//
//  Pure Foundation core, so these run without a bundle or a rendered view (the i18n facade returns its
//  English fallback). Executed in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Snapshot (web `text` props + langLabel rule)

final class CodeBlockSnapshotTests: XCTestCase {
    func testHasContentTrueForRealCode() {
        XCTAssertTrue(CodeBlockSnapshot(text: "let x = 1").hasContent)
        XCTAssertTrue(CodeBlockSnapshot(text: "  spaced  ").hasContent)
    }

    func testHasContentFalseForBlankOrWhitespace() {
        XCTAssertFalse(CodeBlockSnapshot(text: "").hasContent)
        XCTAssertFalse(CodeBlockSnapshot(text: "   \n\t").hasContent)
    }

    func testResolvedLanguageLabelTrimsAndDefaultsToText() {
        XCTAssertEqual(CodeBlockSnapshot(language: "swift", text: "x").resolvedLanguageLabel, "swift")
        XCTAssertEqual(CodeBlockSnapshot(language: "  go  ", text: "x").resolvedLanguageLabel, "go")
        XCTAssertEqual(CodeBlockSnapshot(language: nil, text: "x").resolvedLanguageLabel, "text")
        XCTAssertEqual(CodeBlockSnapshot(language: "   ", text: "x").resolvedLanguageLabel, "text")
    }
}

// MARK: - Projector (cached snapshot → projection)

final class CodeBlockProjectorTests: XCTestCase {
    func testProjectsLanguageCodeAndCopyPayload() {
        let projection = CodeBlockProjector.project(
            CodeBlockSnapshot(language: "ts", text: "const x = 1;\nconst y = 2;")
        )
        XCTAssertEqual(projection.languageLabel, "ts")
        XCTAssertEqual(projection.code, "const x = 1;\nconst y = 2;")
        // Web copies the raw `text` prop verbatim — the clipboard payload equals the rendered body.
        XCTAssertEqual(projection.copyPayload, "const x = 1;\nconst y = 2;")
        XCTAssertEqual(projection.lineCount, 2)
    }

    func testProjectsDefaultLanguageWhenBlank() {
        let projection = CodeBlockProjector.project(CodeBlockSnapshot(language: nil, text: "echo hi"))
        XCTAssertEqual(projection.languageLabel, "text")
    }

    func testAccessibilityLabelInterpolatesLanguage() {
        XCTAssertEqual(
            CodeBlockProjector.project(CodeBlockSnapshot(language: "swift", text: "x")).accessibilityLabel,
            "Code block, swift"
        )
        XCTAssertEqual(
            CodeBlockProjector.project(CodeBlockSnapshot(language: nil, text: "x")).accessibilityLabel,
            "Code block, text"
        )
    }

    func testLineCountHandlesEmptySingleAndTrailingNewline() {
        XCTAssertEqual(CodeBlockProjector.lineCount(of: ""), 0)
        XCTAssertEqual(CodeBlockProjector.lineCount(of: "one line"), 1)
        XCTAssertEqual(CodeBlockProjector.lineCount(of: "a\nb\nc"), 3)
        // A single trailing newline must not inflate the count (web `<pre>` shows the same N lines).
        XCTAssertEqual(CodeBlockProjector.lineCount(of: "a\nb\n"), 2)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

final class CodeBlockSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(CodeBlockSurface.slug, "CodeBlock")
        XCTAssertEqual(CodeBlock.surfaceSlug, "CodeBlock")
    }
}
