//
//  UnitInput.ModelTests.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  State-holder coverage for `UnitInputFieldModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state (loading / ready / error),
//  the commit write-back (parse → source.commit → renormalised buffer) on blur and on Enter — incl.
//  the km display→canonical conversion round-trip — the web focus guard (an external value change
//  does NOT clobber the buffer while editing, but DOES re-sync while idle), the connection axis
//  (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live) and
//  offline keeping the value, and the stop/restart wiring. Driven through the in-memory seam — no
//  network.
//

import XCTest
@testable import TeslaSync

@MainActor
final class UnitInputFieldModelTests: XCTestCase {
    private let usLocale = Locale(identifier: "en_US")

    private func settings(_ length: UnitInputFieldLengthUnit = .kilometers) -> UnitInputFieldSettings {
        UnitInputFieldSettings(
            lengthUnit: length, tempUnit: .celsius, decimalPrecision: 2,
            currencySymbol: "$", locale: usLocale
        )
    }

    private func energyInput(
        _ value: Double?,
        connection: UnitInputFieldConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> UnitInputFieldInput {
        UnitInputFieldInput(
            value: value,
            kind: .energy,
            settings: settings(),
            label: "Battery Capacity",
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
    }

    private func makeModel(
        _ input: UnitInputFieldInput,
        telemetry: UnitInputFieldTelemetry = OSLogUnitInputFieldTelemetry()
    ) -> (UnitInputFieldModel, InMemoryUnitInputFieldSource) {
        let source = InMemoryUnitInputFieldSource(initial: input)
        let model = UnitInputFieldModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    // MARK: Lifecycle + telemetry

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyUnitInputFieldTelemetry()
        let (model, source) = makeModel(energyInput(75), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.editingText, "75")
        XCTAssertEqual(spy.surfaces, [UnitInputField.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(energyInput(nil, isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(energyInput(nil, errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyInitialLeavesBufferBlank() {
        let (model, _) = makeModel(energyInput(nil))
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.editingText, "")
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(UnitInputField.surfaceSlug, "UnitInput")
    }

    // MARK: Commit write-back (web onBlur / onChange)

    func testCommitOnBlurParsesAndRenormalises() {
        let (model, source) = makeModel(energyInput(nil))
        model.start()
        model.beginEditing()
        model.editingText = "75.50"
        model.commitEditing()
        XCTAssertEqual(source.committed, [75.5])
        // Renormalised to the canonical-rounded form (trailing zero dropped).
        XCTAssertEqual(model.editingText, "75.5")
    }

    func testCommitBlankCommitsNil() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        model.beginEditing()
        model.editingText = ""
        model.commitEditing()
        XCTAssertEqual(source.committed, [nil])
        XCTAssertEqual(model.editingText, "")
    }

    func testCommitConvertsKmDisplayToCanonicalMilesAndRoundTrips() throws {
        // Distance field with a km display preference: typing "100" km commits canonical miles and
        // re-renders the km display, which round-trips back to "100".
        let input = UnitInputFieldInput(value: nil, kind: .distance, settings: settings(.kilometers), label: "Trip")
        let (model, source) = makeModel(input)
        model.start()
        model.beginEditing()
        model.editingText = "100"
        model.commitEditing()
        let committed = try XCTUnwrap(source.committed.first ?? nil)
        XCTAssertEqual(committed, 100 / 1.609344, accuracy: 1e-4)
        XCTAssertEqual(model.editingText, "100")
    }

    // MARK: Enter (web onKeyDown Enter — commit without losing focus)

    func testSubmitCommitsButKeepsEditing() {
        let (model, source) = makeModel(energyInput(nil))
        model.start()
        model.beginEditing()
        model.editingText = "3"
        model.submit()
        XCTAssertEqual(source.committed, [3])
        XCTAssertEqual(model.editingText, "3")
        // Still editing: an external value change must NOT clobber the renormalised buffer.
        source.push(energyInput(5))
        XCTAssertEqual(model.editingText, "3")
    }

    // MARK: Focus guard (web focusedRef)

    func testExternalChangeWhileEditingDoesNotClobberBuffer() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        XCTAssertEqual(model.editingText, "75")
        model.beginEditing()
        model.editingText = "9.99"
        source.push(energyInput(25))
        XCTAssertEqual(model.editingText, "9.99")
    }

    func testExternalChangeWhileIdleReSyncsBuffer() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        XCTAssertEqual(model.editingText, "75")
        source.push(energyInput(25))
        XCTAssertEqual(model.editingText, "25")
    }

    func testReSyncResumesAfterCommitEnds() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        model.beginEditing()
        model.editingText = "9.99"
        model.commitEditing()
        // Editing ended; a later external change re-syncs again.
        source.push(energyInput(40))
        XCTAssertEqual(model.editingText, "40")
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(energyInput(75, connection: .live))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(energyInput(75, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(energyInput(75, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(energyInput(75, connection: .live))
        model.start()
        source.push(energyInput(75, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(energyInput(75, connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(energyInput(75, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsValueAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(energyInput(75, connection: .live))
        model.start()
        source.push(energyInput(75, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(energyInput(75))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyUnitInputFieldTelemetry: UnitInputFieldTelemetry, @unchecked Sendable {
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
