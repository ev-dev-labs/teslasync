//
//  AISuggestNewGeofences.Tests.swift
//  TeslaSync — P4 shared surface · 0051 · AISuggestNewGeofences (Apple)
//
//  Unit coverage for the AISuggestNewGeofences surface:
//    • Adapter — the nested `tool_result` → `SuggestGeofenceDraft` decode (the web
//      `handleEvent` guard chain unwrapping `data.draft`), the stream-lifecycle button
//      logic (isBusy / canStart / buttonDisabled / output visibility), the rounded-radius
//      formatter, and the spoken summary.
//    • State holder — `SuggestGeofenceModel` wiring lives in `…ModelTests.swift`.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification
//  harness. They have no network and no real store. Per-state view rendering is covered by
//  the #Preview blocks (compiled by the app targets) and the dual-SDK typecheck; the
//  per-state *behaviour* is asserted through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - JSON value accessors

@MainActor final class SuggestGeofenceJSONValueTests: XCTestCase {
    func testStringValueOnlyForStrings() {
        XCTAssertEqual(SuggestGeofenceJSONValue.string("hi").stringValue, "hi")
        XCTAssertNil(SuggestGeofenceJSONValue.number(3).stringValue)
        XCTAssertNil(SuggestGeofenceJSONValue.bool(true).stringValue)
        XCTAssertNil(SuggestGeofenceJSONValue.null.stringValue)
    }

    func testNumberValueOnlyForNumbers() {
        XCTAssertEqual(SuggestGeofenceJSONValue.number(42).numberValue, 42)
        XCTAssertNil(SuggestGeofenceJSONValue.string("42").numberValue)
        XCTAssertNil(SuggestGeofenceJSONValue.bool(false).numberValue)
    }

    func testObjectValueOnlyForObjects() {
        let nested = SuggestGeofenceJSONValue.object(["k": .string("v")])
        XCTAssertEqual(nested.objectValue?["k"]?.stringValue, "v")
        XCTAssertNil(SuggestGeofenceJSONValue.string("x").objectValue)
        XCTAssertNil(SuggestGeofenceJSONValue.number(1).objectValue)
    }
}

// MARK: - Draft decode (web `handleEvent` guard chain, nested `data.draft`)

@MainActor final class SuggestGeofenceDraftDecodeTests: XCTestCase {
    private func inner(
        locationID: SuggestGeofenceJSONValue = .number(42),
        vehicleID: SuggestGeofenceJSONValue = .number(7),
        proposedName: SuggestGeofenceJSONValue = .string("Ocean Beach Parking"),
        radiusM: SuggestGeofenceJSONValue = .number(85),
        centroidLat: SuggestGeofenceJSONValue = .number(37.7594),
        centroidLon: SuggestGeofenceJSONValue = .number(-122.5107)
    ) -> SuggestGeofenceJSONValue {
        .object([
            "location_id": locationID,
            "vehicle_id": vehicleID,
            "proposed_name": proposedName,
            "radius_m": radiusM,
            "centroid_lat": centroidLat,
            "centroid_lon": centroidLon
        ])
    }

    private func result(
        name: String = SuggestGeofenceDraft.toolName,
        ok: Bool = true,
        data: [String: SuggestGeofenceJSONValue]?
    ) -> SuggestGeofenceToolResult {
        SuggestGeofenceToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    func testDecodesOKDraft() {
        let draft = SuggestGeofenceDraft.from(result(data: ["draft": inner(), "status": .string("ok")]))
        XCTAssertEqual(draft?.locationID, 42)
        XCTAssertEqual(draft?.vehicleID, 7)
        XCTAssertEqual(draft?.proposedName, "Ocean Beach Parking")
        XCTAssertEqual(draft?.radiusM, 85)
        XCTAssertEqual(draft?.centroidLat, 37.7594)
        XCTAssertEqual(draft?.centroidLon, -122.5107)
        XCTAssertEqual(draft?.status, "ok")
        XCTAssertEqual(draft?.isOK, true)
        XCTAssertNil(draft?.validationError)
    }

    func testDecodesInvalidDraftWithValidationError() {
        let draft = SuggestGeofenceDraft.from(result(data: [
            "draft": inner(radiusM: .number(12)),
            "status": .string("invalid"),
            "validation_error": .string("Radius too small")
        ]))
        XCTAssertEqual(draft?.status, "invalid")
        XCTAssertEqual(draft?.isOK, false)
        XCTAssertEqual(draft?.validationError, "Radius too small")
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(SuggestGeofenceDraft.from(result(
            name: "summarize", data: ["draft": inner(), "status": .string("ok")]
        )))
    }

    func testRejectsNotOK() {
        XCTAssertNil(SuggestGeofenceDraft.from(result(
            ok: false, data: ["draft": inner(), "status": .string("ok")]
        )))
    }

    func testRejectsNilData() {
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: nil)))
    }

    func testRejectsMissingDraftWrapper() {
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: ["status": .string("ok")])))
    }

    func testRejectsMissingStatus() {
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: ["draft": inner()])))
    }

    func testRejectsMissingInnerFields() {
        // Missing proposed_name.
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: [
            "draft": .object([
                "location_id": .number(1),
                "vehicle_id": .number(2),
                "radius_m": .number(50),
                "centroid_lat": .number(1),
                "centroid_lon": .number(2)
            ]),
            "status": .string("ok")
        ])))
        // Missing centroid_lon.
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: [
            "draft": .object([
                "location_id": .number(1),
                "vehicle_id": .number(2),
                "proposed_name": .string("X"),
                "radius_m": .number(50),
                "centroid_lat": .number(1)
            ]),
            "status": .string("ok")
        ])))
    }

    func testRejectsTypeMismatches() {
        // radius_m must be a number (web `typeof === 'number'`).
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: [
            "draft": inner(radiusM: .string("85")), "status": .string("ok")
        ])))
        // proposed_name must be a string.
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: [
            "draft": inner(proposedName: .number(2)), "status": .string("ok")
        ])))
        // status must be a string.
        XCTAssertNil(SuggestGeofenceDraft.from(result(data: [
            "draft": inner(), "status": .number(1)
        ])))
    }

    func testIgnoresNonStringValidationError() {
        let draft = SuggestGeofenceDraft.from(result(data: [
            "draft": inner(), "status": .string("ok"), "validation_error": .number(9)
        ]))
        XCTAssertNotNil(draft)
        XCTAssertNil(draft?.validationError)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class SuggestGeofenceLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(SuggestGeofenceLogic.isBusy(.streaming))
        XCTAssertTrue(SuggestGeofenceLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(SuggestGeofenceLogic.isBusy(.idle))
        XCTAssertFalse(SuggestGeofenceLogic.isBusy(.done))
        XCTAssertFalse(SuggestGeofenceLogic.isBusy(.error("x")))
    }

    func testCanStart() {
        XCTAssertTrue(SuggestGeofenceLogic.canStart(locationID: 1, phase: .idle))
        XCTAssertFalse(SuggestGeofenceLogic.canStart(locationID: 0, phase: .idle))
        XCTAssertFalse(SuggestGeofenceLogic.canStart(locationID: -3, phase: .idle))
        XCTAssertFalse(SuggestGeofenceLogic.canStart(locationID: 1, phase: .pausedConfirm))
        XCTAssertTrue(SuggestGeofenceLogic.canStart(locationID: 1, phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(SuggestGeofenceLogic.buttonDisabled(locationID: 1, phase: .idle, connection: .live))
        XCTAssertTrue(SuggestGeofenceLogic.buttonDisabled(locationID: 1, phase: .streaming, connection: .live))
        XCTAssertTrue(SuggestGeofenceLogic.buttonDisabled(locationID: 0, phase: .idle, connection: .live))
        XCTAssertTrue(SuggestGeofenceLogic.buttonDisabled(locationID: 1, phase: .idle, connection: .offline))
        XCTAssertTrue(SuggestGeofenceLogic.buttonDisabled(locationID: 1, phase: .pausedConfirm, connection: .live))
    }

    func testOutputVisible() {
        XCTAssertFalse(SuggestGeofenceLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(SuggestGeofenceLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(SuggestGeofenceLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(SuggestGeofenceLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(SuggestGeofenceLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(SuggestGeofenceLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(SuggestGeofenceLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(SuggestGeofenceLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(SuggestGeofenceLogic.isIdleInvite(phase: .idle, hasDraft: false, hasText: false))
        XCTAssertFalse(SuggestGeofenceLogic.isIdleInvite(phase: .idle, hasDraft: true, hasText: false))
        XCTAssertFalse(SuggestGeofenceLogic.isIdleInvite(phase: .streaming, hasDraft: false, hasText: false))
    }

    func testFormattedRadiusRounds() {
        XCTAssertEqual(SuggestGeofenceLogic.formattedRadius(85), "85 m")
        XCTAssertEqual(SuggestGeofenceLogic.formattedRadius(84.4), "84 m")
        XCTAssertEqual(SuggestGeofenceLogic.formattedRadius(84.6), "85 m")
        XCTAssertEqual(SuggestGeofenceLogic.formattedRadius(0), "0 m")
    }
}

// MARK: - Accessibility summary

@MainActor final class SuggestGeofenceAccessibilityTests: XCTestCase {
    private func draft(status: String, validationError: String? = nil) -> SuggestGeofenceDraft {
        SuggestGeofenceDraft(
            locationID: 1,
            vehicleID: 2,
            proposedName: "Ferry Terminal",
            radiusM: 120,
            centroidLat: 37.79,
            centroidLon: -122.39,
            status: status,
            validationError: validationError
        )
    }

    private func labels(title: String) -> SuggestGeofenceAccessibility.Labels {
        SuggestGeofenceAccessibility.Labels(
            title: title, proposed: "Proposed geofence", radius: "Radius", rejected: "Rejected"
        )
    }

    func testTitleOnly() {
        let summary = SuggestGeofenceAccessibility.summary(
            labels: labels(title: "Suggest a geofence"), currentLabel: nil, draft: nil
        )
        XCTAssertEqual(summary, "Suggest a geofence")
    }

    func testWithCurrentLabel() {
        let summary = SuggestGeofenceAccessibility.summary(
            labels: labels(title: "Suggest a geofence"),
            currentLabel: "Current label: 37.7, -122.4",
            draft: nil
        )
        XCTAssertEqual(summary, "Suggest a geofence. Current label: 37.7, -122.4")
    }

    func testWithOKDraftIncludesRadius() {
        let summary = SuggestGeofenceAccessibility.summary(
            labels: labels(title: "T"), currentLabel: nil, draft: draft(status: "ok")
        )
        XCTAssertEqual(summary, "T. Proposed geofence: Ferry Terminal. Radius: 120 m")
    }

    func testWithRejectedDraftAppendsValidationThenRejected() {
        let summary = SuggestGeofenceAccessibility.summary(
            labels: labels(title: "T"),
            currentLabel: nil,
            draft: draft(status: "invalid", validationError: "Radius too small")
        )
        XCTAssertEqual(summary, "T. Proposed geofence: Ferry Terminal. Radius: 120 m. Radius too small. Rejected")
    }
}

// MARK: - i18n facade

@MainActor final class SuggestGeofenceStringsTests: XCTestCase {
    /// The "AISuggestNewGeofences" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            SuggestGeofenceStrings.string("geofences.aiSuggest.title", "Suggest a geofence for this location"),
            "Suggest a geofence for this location"
        )
        XCTAssertEqual(
            SuggestGeofenceStrings.string("geofences.aiSuggest.proposalLabel", "Proposed geofence"),
            "Proposed geofence"
        )
        XCTAssertEqual(SuggestGeofenceStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }
}
