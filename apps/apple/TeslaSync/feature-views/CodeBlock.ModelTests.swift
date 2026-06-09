//
//  CodeBlock.ModelTests.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  State-holder + view coverage for the chatbot fenced-code block surface (split from CodeBlock.Tests.swift
//  to keep each file within the SwiftLint file-length budget):
//    • State holder — `CodeBlockModel.resolvePhase` across idle / ready / failed with + without cached
//      content, the model wiring, the P1/S11 `view.opened` telemetry firing once, the clipboard seam, the
//      error retry, and the stale auto-refresh / offline freshness wiring.
//    • View — an `ImageRenderer` render smoke for every state (content / no-language / empty / loading /
//      error / stale / offline).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model is
//  driven by `InMemoryCodeBlockSource` + an in-memory pasteboard + a recording telemetry spy.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private func sampleSnapshot() -> CodeBlockSnapshot {
    CodeBlockSnapshot(language: "swift", text: "let x = 1")
}

private func readyUpdate(
    _ snapshot: CodeBlockSnapshot = sampleSnapshot(),
    connection: CodeBlockConnection = .live
) -> CodeBlockUpdate {
    CodeBlockUpdate(content: .ready(snapshot), connection: connection, updatedAt: Date())
}

// MARK: - State holder: phase, wiring, telemetry, copy, freshness

@MainActor
final class CodeBlockModelTests: XCTestCase {
    private func makeModel(
        _ update: CodeBlockUpdate?,
        telemetry: any CodeBlockTelemetry = OSLogCodeBlockTelemetry(),
        pasteboard: any CodeBlockPasteboard = InMemoryCodeBlockPasteboard()
    ) -> (CodeBlockModel, InMemoryCodeBlockSource) {
        let source = InMemoryCodeBlockSource(initial: update)
        let model = CodeBlockModel(source: source, telemetry: telemetry, pasteboard: pasteboard)
        return (model, source)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(CodeBlockModel.resolvePhase(for: .idle, hasCachedContent: false), .loading)
        XCTAssertEqual(CodeBlockModel.resolvePhase(for: .idle, hasCachedContent: true), .content)
        XCTAssertEqual(CodeBlockModel.resolvePhase(for: .ready(sampleSnapshot()), hasCachedContent: false), .content)
        XCTAssertEqual(
            CodeBlockModel.resolvePhase(for: .ready(CodeBlockSnapshot(text: "  ")), hasCachedContent: true),
            .empty
        )
        XCTAssertEqual(CodeBlockModel.resolvePhase(for: .failed("x"), hasCachedContent: false), .error("x"))
        XCTAssertEqual(CodeBlockModel.resolvePhase(for: .failed("x"), hasCachedContent: true), .content)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyCodeBlockTelemetry()
        let (model, source) = makeModel(readyUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.languageLabel, "swift")
        XCTAssertEqual(spy.surfaces, [CodeBlockSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testIdleInitialProjectsLoading() {
        let (model, _) = makeModel(CodeBlockUpdate(content: .idle))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
        XCTAssertTrue(model.isFetching)
    }

    func testLateReadyTransitionsFromLoadingToContent() {
        let (model, source) = makeModel(nil)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(readyUpdate())
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.code, "let x = 1")
    }

    func testReadyButBlankProjectsEmpty() {
        let (model, source) = makeModel(CodeBlockUpdate(content: .idle))
        model.start()
        source.push(readyUpdate(CodeBlockSnapshot(language: "bash", text: "   \n")))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithCachedSnippetStaysContent() {
        let (model, source) = makeModel(readyUpdate())
        model.start()
        source.push(CodeBlockUpdate(content: .failed("boom")))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.code, "let x = 1")
    }

    func testFailedWithoutCachedSnippetProjectsError() {
        let (model, source) = makeModel(CodeBlockUpdate(content: .idle))
        model.start()
        source.push(CodeBlockUpdate(content: .failed("offline")))
        XCTAssertEqual(model.phase, .error("offline"))
    }

    func testCopyRoutesPayloadToPasteboard() {
        let pasteboard = InMemoryCodeBlockPasteboard()
        let snapshot = CodeBlockSnapshot(language: "go", text: "package main")
        let (model, _) = makeModel(readyUpdate(snapshot), pasteboard: pasteboard)
        model.start()
        model.copy()
        XCTAssertEqual(pasteboard.copied, ["package main"])
    }

    func testCopyIsNoOpWhenNothingToCopy() {
        let pasteboard = InMemoryCodeBlockPasteboard()
        let (model, _) = makeModel(CodeBlockUpdate(content: .idle), pasteboard: pasteboard)
        model.start()
        model.copy()
        XCTAssertTrue(pasteboard.copied.isEmpty)
    }

    func testStaleTransitionAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(readyUpdate())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(readyUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(readyUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(readyUpdate(connection: .live))
        source.push(readyUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedSnippetWithoutAutoRefresh() {
        let (model, source) = makeModel(readyUpdate())
        model.start()
        source.push(readyUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.isFetching)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopRestart() {
        let (model, source) = makeModel(readyUpdate())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testAccessibilitySummaryPerPhase() {
        let (content, _) = makeModel(readyUpdate())
        content.start()
        XCTAssertEqual(content.accessibilitySummary, "Code block, swift")

        let (error, _) = makeModel(CodeBlockUpdate(content: .failed("x")))
        error.start()
        XCTAssertEqual(error.accessibilitySummary, "Couldn't load the code")
    }

    func testConvenienceInitializerIsReadyAndLive() {
        let model = CodeBlockModel(language: "swift", text: "let x = 1", pasteboard: InMemoryCodeBlockPasteboard())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.projection?.languageLabel, "swift")
    }
}

// MARK: - View render smoke (every state builds + renders)

@MainActor
final class CodeBlockViewStateTests: XCTestCase {
    private func renderSmoke(_ update: CodeBlockUpdate, file: StaticString = #filePath, line: UInt = #line) {
        let source = InMemoryCodeBlockSource(initial: update)
        let model = CodeBlockModel(source: source, pasteboard: InMemoryCodeBlockPasteboard())
        model.start()
        let renderer = ImageRenderer(content: CodeBlock(model: model).frame(width: 360, height: 220))
        XCTAssertNotNil(renderer.cgImage, file: file, line: line)
    }

    func testContentRenders() {
        renderSmoke(readyUpdate())
    }

    func testNoLanguageRenders() {
        renderSmoke(readyUpdate(CodeBlockSnapshot(language: nil, text: "echo hi")))
    }

    func testEmptyRenders() {
        renderSmoke(readyUpdate(CodeBlockSnapshot(language: "bash", text: "   \n")))
    }

    func testLoadingRenders() {
        renderSmoke(CodeBlockUpdate(content: .idle))
    }

    func testErrorRenders() {
        renderSmoke(CodeBlockUpdate(content: .failed("Network request timed out")))
    }

    func testStaleRenders() {
        renderSmoke(readyUpdate(connection: .stale))
    }

    func testOfflineRenders() {
        renderSmoke(readyUpdate(connection: .offline))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCodeBlockTelemetry: CodeBlockTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
