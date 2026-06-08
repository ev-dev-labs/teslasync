//
//  MarkdownRenderer.ModelTests.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  Unit coverage for the `MarkdownRendererModel` state holder (P1/S8): the content-status → render-phase
//  resolution (loading / ready / empty / error), the parsed-document binding, the P1/S11 `view.opened`
//  telemetry firing once, the clipboard seam, the error retry, and the stale auto-refresh / offline
//  wiring. Driven by `InMemoryMarkdownRendererSource` + an in-memory pasteboard + a recording telemetry
//  spy — no network, no rendered view. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

@MainActor final class MarkdownRendererModelTests: XCTestCase {
    private func makeModel(
        initial: MarkdownRendererUpdate?,
        telemetry: any MarkdownRendererTelemetry = OSLogMarkdownRendererTelemetry(),
        pasteboard: any MarkdownRendererPasteboard = InMemoryMarkdownPasteboard()
    ) -> (MarkdownRendererModel, InMemoryMarkdownRendererSource) {
        let source = InMemoryMarkdownRendererSource(initial: initial)
        let model = MarkdownRendererModel(
            source: source,
            telemetry: telemetry,
            pasteboard: pasteboard,
            copy: .fallback
        )
        return (model, source)
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyMarkdownRendererTelemetry()
        let (model, source) = makeModel(initial: MarkdownRendererUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MarkdownRenderer.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testReadyContentParsesDocumentAndEntersReadyPhase() {
        let (model, _) = makeModel(
            initial: MarkdownRendererUpdate(content: .ready("# Hi\n\nHello **world**."))
        )
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.documentStats.headings, 1)
        XCTAssertEqual(model.documentStats.paragraphs, 1)
    }

    func testReadyButBlankContentEntersEmptyPhase() {
        let (model, _) = makeModel(initial: MarkdownRendererUpdate(content: .ready("   \n")))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.document.isEmpty)
    }

    func testPreparingContentShowsRawTextLoadingFallback() {
        let (model, _) = makeModel(initial: MarkdownRendererUpdate(content: .preparing("raw **text**")))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.rawText, "raw **text**")
    }

    func testIdleContentIsLoadingWithoutRawText() {
        let (model, _) = makeModel(initial: MarkdownRendererUpdate(content: .idle))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.rawText.isEmpty)
    }

    func testFailedContentEntersErrorPhase() {
        let (model, _) = makeModel(initial: MarkdownRendererUpdate(content: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testLateReadyContentTransitionsFromLoadingToReady() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(MarkdownRendererUpdate(content: .ready("done")))
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(MarkdownPlainText.render(model.document), "done")
    }

    func testCopyCodeRoutesToPasteboard() {
        let pasteboard = InMemoryMarkdownPasteboard()
        let (model, _) = makeModel(
            initial: MarkdownRendererUpdate(content: .ready("```\nx\n```")),
            pasteboard: pasteboard
        )
        model.start()
        model.copyCode("let x = 1")
        XCTAssertEqual(pasteboard.copied, ["let x = 1"])
    }

    func testRetryDelegatesToSource() {
        let (model, source) = makeModel(initial: MarkdownRendererUpdate(content: .failed("x")))
        model.start()
        model.retry()
        model.retry()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let live = MarkdownRendererUpdate(content: .ready("hi"), connection: .live)
        let (model, source) = makeModel(initial: live)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(MarkdownRendererUpdate(content: .ready("hi"), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(MarkdownRendererUpdate(content: .ready("hi"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        source.push(live)
        source.push(MarkdownRendererUpdate(content: .ready("hi"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsDocumentWithoutRefresh() {
        let (model, source) = makeModel(
            initial: MarkdownRendererUpdate(content: .ready("cached"), connection: .live)
        )
        model.start()
        source.push(MarkdownRendererUpdate(content: .ready("cached"), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopStopsSourceAndAllowsRestart() {
        let (model, source) = makeModel(initial: MarkdownRendererUpdate(content: .ready("hi")))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testAccessibilitySummaryResolvesEnglishForReady() {
        let (model, _) = makeModel(initial: MarkdownRendererUpdate(content: .ready("# Hi")))
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Formatted message")
    }

    func testConvenienceMarkdownInitializerIsReadyAndLive() {
        let model = MarkdownRendererModel(markdown: "# Hi", pasteboard: InMemoryMarkdownPasteboard(), copy: .fallback)
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.connection, .live)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMarkdownRendererTelemetry: MarkdownRendererTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
