//
//  AISuggestNewGeofences.ModelTests.swift
//  TeslaSync — P4 shared surface · 0051 · AISuggestNewGeofences (Apple)
//
//  State-holder coverage split out of `…Tests.swift` (one file ≤ 400 lines per the
//  SwiftLint contract): `SuggestGeofenceModel` wiring — the gate render axis, the P1/S11
//  `view.opened` telemetry, the suggest double-submit guard, the nested draft capture, the
//  ok-only apply forwarding (centroid + radius + name), the location-change reset, and the
//  stale auto-refresh. Driven entirely by `InMemorySuggestGeofenceSource`; no network, no
//  real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor final class SuggestGeofenceModelTests: XCTestCase {
    private func makeModel(
        _ input: SuggestGeofenceInput,
        telemetry: SuggestGeofenceTelemetry = OSLogSuggestGeofenceTelemetry(),
        onApply: @escaping @MainActor (SuggestGeofenceApplication) -> Void = { _ in }
    ) -> (SuggestGeofenceModel, InMemorySuggestGeofenceSource) {
        let source = InMemorySuggestGeofenceSource(initial: input)
        let model = SuggestGeofenceModel(source: source, telemetry: telemetry, onApply: onApply)
        return (model, source)
    }

    private var readyInput: SuggestGeofenceInput {
        SuggestGeofenceInput(gate: .on, locationID: 42, currentName: "37.7, -122.4")
    }

    private func pushOKDraft(_ source: InMemorySuggestGeofenceSource, name: String) {
        source.pushDraft(SuggestGeofenceDraft(
            locationID: 42, vehicleID: 7, proposedName: name,
            radiusM: 85, centroidLat: 37.7594, centroidLon: -122.5107, status: "ok"
        ))
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpySuggestGeofenceTelemetry()
        let (model, source) = makeModel(readyInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.renderState, .ready)
        XCTAssertEqual(model.locationID, 42)
        XCTAssertEqual(model.currentName, "37.7, -122.4")
        XCTAssertEqual(spy.surfaces, [SuggestGeofenceSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGateRenderAxis() {
        let (loading, _) = makeModel(SuggestGeofenceInput(gate: .loading, locationID: 1))
        loading.start()
        XCTAssertEqual(loading.renderState, .gateLoading)

        let (off, _) = makeModel(SuggestGeofenceInput(gate: .off, locationID: 1))
        off.start()
        XCTAssertEqual(off.renderState, .gatedOff)

        let (errored, _) = makeModel(SuggestGeofenceInput(gate: .loading, locationID: 1, errorMessage: "boom"))
        errored.start()
        XCTAssertEqual(errored.renderState, .gateError("boom"))

        let (ready, _) = makeModel(readyInput)
        ready.start()
        XCTAssertEqual(ready.renderState, .ready)
    }

    func testGatedOffWinsOverError() {
        // An explicitly disabled feature is not an error surface.
        let (model, _) = makeModel(SuggestGeofenceInput(gate: .off, locationID: 1, errorMessage: "ignored"))
        model.start()
        XCTAssertEqual(model.renderState, .gatedOff)
    }

    func testSuggestStartsStreamAndClearsPriorDraft() {
        let (model, source) = makeModel(readyInput)
        model.start()
        pushOKDraft(source, name: "Old")
        XCTAssertNotNil(model.draft)
        model.suggest()
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(source.startStreamCount, 1)
        XCTAssertEqual(model.phase, .streaming)
    }

    func testSuggestIsNoOpWhileBusy() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        model.suggest()
        XCTAssertEqual(source.startStreamCount, 0)
    }

    func testToolResultCapturesNestedDraft() {
        let (model, source) = makeModel(readyInput)
        model.start()
        pushOKDraft(source, name: "Ferry Terminal")
        XCTAssertEqual(model.draft?.proposedName, "Ferry Terminal")
        XCTAssertEqual(model.draft?.radiusM, 85)
        XCTAssertEqual(model.draft?.vehicleID, 7)
        XCTAssertEqual(model.draft?.isOK, true)
        XCTAssertEqual(model.phase, .done)
    }

    func testApplyForwardsOnlyOKProposal() {
        let recorder = ApplyRecorder()
        let (model, source) = makeModel(readyInput, onApply: { recorder.values.append($0) })
        model.start()

        // Rejected → not forwarded.
        source.pushDraft(SuggestGeofenceDraft(
            locationID: 42, vehicleID: 7, proposedName: "Home",
            radiusM: 12, centroidLat: 37.77, centroidLon: -122.41,
            status: "invalid", validationError: "Radius too small"
        ))
        model.apply()
        XCTAssertTrue(recorder.values.isEmpty)

        // OK → forwarded with the centroid + radius + name.
        source.pushDraft(SuggestGeofenceDraft(
            locationID: 42, vehicleID: 7, proposedName: "Pier 39",
            radiusM: 95, centroidLat: 37.8087, centroidLon: -122.4098, status: "ok"
        ))
        model.apply()
        XCTAssertEqual(recorder.values.count, 1)
        XCTAssertEqual(recorder.values.first, SuggestGeofenceApplication(
            name: "Pier 39", latitude: 37.8087, longitude: -122.4098, radius: 95
        ))
    }

    func testApplyWithoutDraftIsNoOp() {
        let recorder = ApplyRecorder()
        let (model, _) = makeModel(readyInput, onApply: { recorder.values.append($0) })
        model.start()
        model.apply()
        XCTAssertTrue(recorder.values.isEmpty)
    }

    func testLocationChangeCancelsAndResetsDraft() {
        let (model, source) = makeModel(readyInput)
        model.start()
        pushOKDraft(source, name: "Cafe")
        XCTAssertNotNil(model.draft)

        source.pushInput(SuggestGeofenceInput(gate: .on, locationID: 99, currentName: "40.0, -73.0"))
        XCTAssertEqual(source.cancelStreamCount, 1)
        XCTAssertNil(model.draft)
        XCTAssertEqual(model.streamText, "")
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.locationID, 99)
    }

    func testFirstSnapshotDoesNotCancel() {
        // Establishing the initial location must not fire the cleanup cancel.
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(source.cancelStreamCount, 0)
        XCTAssertEqual(model.locationID, 42)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.pushInput(SuggestGeofenceInput(gate: .on, locationID: 42, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.pushInput(SuggestGeofenceInput(gate: .on, locationID: 42, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushInput(SuggestGeofenceInput(gate: .on, locationID: 42, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertTrue(model.buttonDisabled)
    }

    func testDeltaAccumulatesStreamText() {
        let (model, source) = makeModel(readyInput)
        model.start()
        source.pushStreamState(.streaming)
        source.pushEvent(.delta(text: "Pier "))
        source.pushEvent(.delta(text: "39"))
        XCTAssertEqual(model.streamText, "Pier 39")
        XCTAssertTrue(model.outputVisible)
    }

    func testPhaseDrivesBusyAndButtonDisabled() {
        let (model, source) = makeModel(readyInput)
        model.start()
        XCTAssertFalse(model.buttonDisabled)
        source.pushStreamState(.streaming)
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.buttonDisabled)
        XCTAssertTrue(model.thinkingVisible)
    }

    func testCancelDelegatesToSource() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.cancel()
        XCTAssertEqual(source.cancelStreamCount, 1)
    }

    func testRefreshClearsGateErrorAndDelegates() {
        let (model, source) = makeModel(SuggestGeofenceInput(gate: .loading, locationID: 1, errorMessage: "down"))
        model.start()
        XCTAssertEqual(model.renderState, .gateError("down"))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertNotEqual(model.renderState, .gateError("down"))
    }

    func testStopCancelsStreamAndReArms() {
        let (model, source) = makeModel(readyInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.cancelStreamCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceConstants() {
        // The View's public `surfaceSlug` / `featureID` are aliases of these non-UI
        // constants (verified compiling by the dual-SDK typecheck); assert the source of
        // truth here so the check also runs in the SwiftUI-free harness.
        XCTAssertEqual(SuggestGeofenceSurface.slug, "AISuggestNewGeofences")
        XCTAssertEqual(SuggestGeofenceSurface.featureID, "suggest-new-geofences")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySuggestGeofenceTelemetry: SuggestGeofenceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the applications forwarded to the parent `onApply` callback.
@MainActor private final class ApplyRecorder {
    var values: [SuggestGeofenceApplication] = []
}
