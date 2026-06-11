//
//  VehicleConfigSection.Tests.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  Unit coverage for the VehicleConfigSection surface:
//    • Field metadata (`VCSectionField`) — source order + the exact web label keys/fallbacks.
//    • Value resolution (`VCSectionField.value`) — the web `configItems` ternaries: string
//      `?? '—'`, boolean `Yes`/`No`/`—`, and the `software_update_version ?? softwareVersion
//      ?? '—'` chain.
//    • Projector (`VCSectionProjector`) — nil → empty gate, present snapshot → twelve ordered
//      rows, and phase resolution.
//    • State holder (`VehicleConfigSectionModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh (exactly
//      once per episode), and offline keeping the cached rows.
//    • Accessibility — the summary content (labels + values) and the empty sentence.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle:
//  the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Field metadata

final class VCSectionFieldTests: XCTestCase {
    func testOrderedMatchesWebSourceOrder() {
        XCTAssertEqual(VCSectionField.ordered, [
            .carType, .trim, .exteriorColor, .wheelType, .roofColor, .chargePort,
            .rightHandDrive, .europeVehicle, .offroadLightbar, .rearSeatHeaters, .sunroof, .software
        ])
    }

    func testLabelKeysAndFallbacks() {
        XCTAssertEqual(VCSectionField.carType.labelKey, "vehicles.detail.carType")
        XCTAssertEqual(VCSectionField.carType.labelFallback, "Car Type")
        XCTAssertEqual(VCSectionField.exteriorColor.labelKey, "vehicles.detail.color")
        XCTAssertEqual(VCSectionField.exteriorColor.labelFallback, "Exterior Color")
        XCTAssertEqual(VCSectionField.wheelType.labelKey, "vehicles.detail.wheels")
        XCTAssertEqual(VCSectionField.rightHandDrive.labelKey, "vehicles.detail.rhd")
        XCTAssertEqual(VCSectionField.sunroof.labelKey, "vehicles.detail.sunroofInstalled")
        XCTAssertEqual(VCSectionField.sunroof.labelFallback, "Sunroof")
        XCTAssertEqual(VCSectionField.software.labelKey, "vehicles.detail.softwareVersion")
    }
}

// MARK: - Value resolution (web `configItems` ternaries)

final class VCSectionValueTests: XCTestCase {
    private let strings = VCSectionValueStrings(yes: "Yes", no: "No", dash: "—")

    func testStringFieldsNilCoalesceToDash() {
        let present = VCSectionSnapshot(carType: "Model 3", trim: "Performance")
        XCTAssertEqual(VCSectionField.carType.value(in: present, strings: strings), "Model 3")
        XCTAssertEqual(VCSectionField.trim.value(in: present, strings: strings), "Performance")

        let absent = VCSectionSnapshot()
        XCTAssertEqual(VCSectionField.carType.value(in: absent, strings: strings), "—")
        XCTAssertEqual(VCSectionField.exteriorColor.value(in: absent, strings: strings), "—")
        XCTAssertEqual(VCSectionField.rearSeatHeaters.value(in: absent, strings: strings), "—")
    }

    func testBooleanFieldsRenderYesNoOrDash() {
        let yes = VCSectionSnapshot(rightHandDrive: true, europeVehicle: true, offroadLightbarPresent: true)
        XCTAssertEqual(VCSectionField.rightHandDrive.value(in: yes, strings: strings), "Yes")
        XCTAssertEqual(VCSectionField.europeVehicle.value(in: yes, strings: strings), "Yes")
        XCTAssertEqual(VCSectionField.offroadLightbar.value(in: yes, strings: strings), "Yes")

        let no = VCSectionSnapshot(rightHandDrive: false, europeVehicle: false, offroadLightbarPresent: false)
        XCTAssertEqual(VCSectionField.rightHandDrive.value(in: no, strings: strings), "No")
        XCTAssertEqual(VCSectionField.europeVehicle.value(in: no, strings: strings), "No")

        let unknown = VCSectionSnapshot()
        XCTAssertEqual(VCSectionField.rightHandDrive.value(in: unknown, strings: strings), "—")
        XCTAssertEqual(VCSectionField.offroadLightbar.value(in: unknown, strings: strings), "—")
    }

    func testSoftwareFallbackChain() {
        // software_update_version wins when present.
        let primary = VCSectionSnapshot(softwareUpdateVersion: "2024.44.25.2", softwareVersion: "2024.38.6")
        XCTAssertEqual(VCSectionField.software.value(in: primary, strings: strings), "2024.44.25.2")

        // falls back to the softwareVersion prop when the update version is nil.
        let fallback = VCSectionSnapshot(softwareUpdateVersion: nil, softwareVersion: "2024.38.6")
        XCTAssertEqual(VCSectionField.software.value(in: fallback, strings: strings), "2024.38.6")

        // dash when both are nil.
        XCTAssertEqual(VCSectionField.software.value(in: VCSectionSnapshot(), strings: strings), "—")
    }

    func testCustomStringsAreHonored() {
        let localized = VCSectionValueStrings(yes: "Oui", no: "Non", dash: "n/a")
        XCTAssertEqual(VCSectionField.rightHandDrive.value(in: .init(rightHandDrive: true), strings: localized), "Oui")
        XCTAssertEqual(VCSectionField.rightHandDrive.value(in: .init(rightHandDrive: false), strings: localized), "Non")
        XCTAssertEqual(VCSectionField.carType.value(in: .init(), strings: localized), "n/a")
    }
}

// MARK: - Projector

final class VCSectionProjectorTests: XCTestCase {
    func testNilSnapshotIsEmptyGate() {
        let projection = VCSectionProjector.project(snapshot: nil)
        XCTAssertTrue(projection.rows.isEmpty)
        XCTAssertFalse(projection.hasSnapshot)
        XCTAssertFalse(projection.hasContent)
    }

    func testPresentSnapshotProducesTwelveOrderedRows() {
        let snapshot = VCSectionSnapshot(
            carType: "Model 3",
            trim: "Long Range",
            rightHandDrive: false,
            softwareUpdateVersion: "2024.44.25.2"
        )
        let projection = VCSectionProjector.project(snapshot: snapshot, strings: .fallback)
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.rows.count, 12)
        XCTAssertEqual(projection.rows.map(\.field), VCSectionField.ordered)
        XCTAssertEqual(projection.rows.first?.value, "Model 3")
        XCTAssertEqual(projection.rows[6].field, .rightHandDrive)
        XCTAssertEqual(projection.rows[6].value, "No")
        XCTAssertEqual(projection.rows.last?.value, "2024.44.25.2")
    }

    func testEmptySnapshotStillRendersTwelveDashRows() {
        let projection = VCSectionProjector.project(snapshot: VCSectionSnapshot(), strings: .fallback)
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.rows.count, 12)
        XCTAssertTrue(projection.rows.allSatisfy { $0.value == "—" })
    }

    func testResolvePhase() {
        XCTAssertEqual(VCSectionProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(VCSectionProjector.resolvePhase(.loading, hasContent: true), .content)
        XCTAssertEqual(VCSectionProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(VCSectionProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(VCSectionProjector.resolvePhase(.failed("x"), hasContent: false), .error("x"))
        XCTAssertEqual(VCSectionProjector.resolvePhase(.failed("x"), hasContent: true), .content)
    }
}

// MARK: - State holder

/// Counts `view.opened` emissions for the telemetry-once assertion.
private final class SpyVCSectionTelemetry: VCSectionTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

@MainActor
final class VCSectionModelTests: XCTestCase {
    private func makeModel(
        _ update: VCSectionUpdate,
        telemetry: SpyVCSectionTelemetry = SpyVCSectionTelemetry()
    ) -> (VehicleConfigSectionModel, InMemoryVehicleConfigSectionSource) {
        let source = InMemoryVehicleConfigSectionSource(initial: update)
        let model = VehicleConfigSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndProjectsContent() {
        let snapshot = VCSectionSnapshot(carType: "Model 3")
        let telemetry = SpyVCSectionTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 12)
        XCTAssertEqual(telemetry.openedSurfaces, ["VehicleConfigSection"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(VehicleConfigSection.surfaceSlug, "VehicleConfigSection")
    }

    func testLoadingAndEmptyAndErrorPhases() {
        let (loading, _) = makeModel(.init(status: .loading, snapshot: nil))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (empty, _) = makeModel(.init(status: .loaded, snapshot: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (failed, _) = makeModel(.init(status: .failed("boom"), snapshot: nil))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testStaleAutoRefreshFiresExactlyOncePerEpisode() {
        let snapshot = VCSectionSnapshot(carType: "Model 3")
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot, connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale must auto-refresh once per episode")

        source.push(.init(status: .loaded, snapshot: snapshot, connection: .live))
        source.push(.init(status: .loaded, snapshot: snapshot, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a new stale episode re-triggers once")
    }

    func testOfflineKeepsCachedRowsWithoutRefresh() {
        let snapshot = VCSectionSnapshot(carType: "Model 3")
        let (model, source) = makeModel(.init(status: .loaded, snapshot: snapshot, connection: .live))
        model.start()

        source.push(.init(status: .failed("net"), snapshot: snapshot, connection: .offline))
        XCTAssertEqual(model.phase, .content, "cached rows stay visible while offline")
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testStopResetsStartedGuard() {
        let telemetry = SpyVCSectionTelemetry()
        let (model, source) = makeModel(.init(status: .loaded, snapshot: nil), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(telemetry.openedSurfaces.count, 2)
    }
}

// MARK: - Accessibility

final class VCSectionAccessibilityTests: XCTestCase {
    private func localize(_: String, _ fallback: String) -> String {
        fallback
    }

    func testSummaryListsLabelsAndValues() {
        let snapshot = VCSectionSnapshot(
            carType: "Model 3",
            trim: "Long Range",
            rightHandDrive: false,
            softwareVersion: "2024.38.6"
        )
        let projection = VCSectionProjector.project(snapshot: snapshot, strings: .fallback)
        let summary = VCSectionAccessibility.summary(projection: projection, localize: localize)
        XCTAssertTrue(summary.hasPrefix("Vehicle Configuration:"))
        XCTAssertTrue(summary.contains("Car Type Model 3"))
        XCTAssertTrue(summary.contains("Trim Long Range"))
        XCTAssertTrue(summary.contains("Right-Hand Drive No"))
        XCTAssertTrue(summary.contains("Software 2024.38.6"))
    }

    func testSummaryEmptySentence() {
        let projection = VCSectionProjector.project(snapshot: nil)
        let summary = VCSectionAccessibility.summary(projection: projection, localize: localize)
        XCTAssertEqual(summary, "Vehicle Configuration: No configuration data available")
    }
}
