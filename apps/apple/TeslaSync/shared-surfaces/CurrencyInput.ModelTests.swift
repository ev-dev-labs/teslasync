//
//  CurrencyInput.ModelTests.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  State-holder coverage for `CurrencyInputFieldModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state (loading / ready / error),
//  the commit write-back (parse → source.commit → renormalised buffer) on blur and on Enter, the web
//  focus guard (an external value change does NOT clobber the buffer while editing, but DOES re-sync
//  while idle), the connection axis (live / stale / offline) with the one-shot stale auto-refresh
//  (re-armed on return to live) and offline keeping the value, and the stop/restart wiring. Driven
//  through the in-memory seam — no network.
//

import XCTest
@testable import TeslaSync

@MainActor
final class CurrencyInputFieldModelTests: XCTestCase {
    private let usLocale = Locale(identifier: "en_US")

    private func usdInput(
        _ micro: Int?,
        connection: CurrencyInputFieldConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> CurrencyInputFieldInput {
        CurrencyInputFieldInput(
            valueMicro: micro,
            currency: "USD",
            locale: usLocale,
            precision: 2,
            ariaLabel: "Tariff",
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
    }

    private func makeModel(
        _ input: CurrencyInputFieldInput,
        telemetry: CurrencyInputFieldTelemetry = OSLogCurrencyInputFieldTelemetry()
    ) -> (CurrencyInputFieldModel, InMemoryCurrencyInputFieldSource) {
        let source = InMemoryCurrencyInputFieldSource(initial: input)
        let model = CurrencyInputFieldModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    // MARK: Lifecycle + telemetry

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyCurrencyInputFieldTelemetry()
        let (model, source) = makeModel(usdInput(1_500_000), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.editingText, "$1.50")
        XCTAssertEqual(spy.surfaces, [CurrencyInputField.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(usdInput(nil, isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(usdInput(nil, errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyInitialLeavesBufferBlank() {
        let (model, _) = makeModel(usdInput(nil))
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.editingText, "")
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(CurrencyInputField.surfaceSlug, "CurrencyInput")
    }

    // MARK: Commit write-back (web onBlur / onChange)

    func testCommitOnBlurParsesAndRenormalises() {
        let (model, source) = makeModel(usdInput(nil))
        model.start()
        model.beginEditing()
        model.editingText = "2.50"
        model.commitEditing()
        XCTAssertEqual(source.committed, [2_500_000])
        XCTAssertEqual(model.editingText, "$2.50")
    }

    func testCommitBlankCommitsNil() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        model.beginEditing()
        model.editingText = ""
        model.commitEditing()
        XCTAssertEqual(source.committed, [nil])
        XCTAssertEqual(model.editingText, "")
    }

    func testCommitStripsSymbolAndKeepsFullPrecision() {
        let (model, source) = makeModel(usdInput(nil))
        model.start()
        model.beginEditing()
        model.editingText = "$0.12345"
        model.commitEditing()
        XCTAssertEqual(source.committed, [123_450])
        XCTAssertEqual(model.editingText, "$0.12")
    }

    // MARK: Enter (web onKeyDown Enter — commit without losing focus)

    func testSubmitCommitsButKeepsEditing() {
        let (model, source) = makeModel(usdInput(nil))
        model.start()
        model.beginEditing()
        model.editingText = "3"
        model.submit()
        XCTAssertEqual(source.committed, [3_000_000])
        XCTAssertEqual(model.editingText, "$3.00")
        // Still editing: an external value change must NOT clobber the renormalised buffer.
        source.push(usdInput(5_000_000))
        XCTAssertEqual(model.editingText, "$3.00")
    }

    // MARK: Focus guard (web focusedRef)

    func testExternalChangeWhileEditingDoesNotClobberBuffer() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        XCTAssertEqual(model.editingText, "$1.50")
        model.beginEditing()
        model.editingText = "9.99"
        source.push(usdInput(2_500_000))
        XCTAssertEqual(model.editingText, "9.99")
    }

    func testExternalChangeWhileIdleReSyncsBuffer() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        XCTAssertEqual(model.editingText, "$1.50")
        source.push(usdInput(2_500_000))
        XCTAssertEqual(model.editingText, "$2.50")
    }

    func testReSyncResumesAfterCommitEnds() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        model.beginEditing()
        model.editingText = "9.99"
        model.commitEditing()
        // Editing ended; a later external change re-syncs again.
        source.push(usdInput(4_000_000))
        XCTAssertEqual(model.editingText, "$4.00")
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(usdInput(1_500_000, connection: .live))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(usdInput(1_500_000, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(usdInput(1_500_000, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(usdInput(1_500_000, connection: .live))
        model.start()
        source.push(usdInput(1_500_000, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(usdInput(1_500_000, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(usdInput(1_500_000, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsValueAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(usdInput(1_500_000, connection: .live))
        model.start()
        source.push(usdInput(1_500_000, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(usdInput(1_500_000))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyCurrencyInputFieldTelemetry: CurrencyInputFieldTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
