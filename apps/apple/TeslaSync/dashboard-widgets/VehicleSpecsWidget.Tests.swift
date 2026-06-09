//
//  VehicleSpecsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  Unit coverage for the VehicleSpecsWidget surface:
//    • Adapter (cached → projection) — `SpecsProjectionBuilder` parity with the
//      web VehicleSpecsWidget.tsx pipeline (asString coercion, the `??` fallback
//      chains for every row, option decode + key fallback + 8-row slice, compact
//      headline, and the `hasAnyData` flag).
//    • State holder — `VehicleSpecsModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `vehicle-specs` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySpecsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached envelopes → projection (parity with the web pipeline)

@MainActor final class SpecsAdapterTests: XCTestCase {
    private let labels = SpecsLabels.default

    func testAsStringCoercion() {
        XCTAssertNil(SpecScalar.absent.asString)
        XCTAssertNil(SpecScalar.text("").asString)
        XCTAssertEqual(SpecScalar.text("Red").asString, "Red")
        XCTAssertEqual(SpecScalar.number(0).asString, "0")
        XCTAssertEqual(SpecScalar.number(2024).asString, "2024")
        XCTAssertEqual(SpecScalar.number(9.99).asString, "9.99")
    }

    func testModelTrimFallbackChains() {
        let entries = SpecsProjectionBuilder.buildEntries(
            specs: RawVehicleSpecs(model: .text("Model 3")),
            config: RawVehicleConfig(carType: .text("ignored"), trim: .text("Long Range")),
            options: nil,
            labels: labels
        )
        // Model: car_type ?? model ?? config.car_type → specs.model wins (car_type absent).
        XCTAssertEqual(entries[0].label, "Model")
        XCTAssertEqual(entries[0].value, "Model 3")
        // Trim: trim_badging ?? trim ?? config.trim → config.trim (specs trim absent).
        XCTAssertEqual(entries[1].value, "Long Range")
        XCTAssertEqual(entries.count, 7)
    }

    func testCarTypeWinsAndConfigFallbacks() {
        let entries = SpecsProjectionBuilder.buildEntries(
            specs: RawVehicleSpecs(carType: .text("Model S"), model: .text("ignored"), interiorColor: .text("Cream")),
            config: RawVehicleConfig(
                exteriorColor: .text("Pearl White"),
                wheelType: .text("Arachnid"),
                version: .text("2024.20.1")
            ),
            options: nil,
            labels: labels
        )
        XCTAssertEqual(entries[0].value, "Model S")
        XCTAssertEqual(entries[2].value, "Pearl White")
        XCTAssertEqual(entries[3].value, "Arachnid")
        XCTAssertEqual(entries[4].value, "Cream")
        XCTAssertEqual(entries[6].value, "2024.20.1")
        XCTAssertTrue(entries[6].mono)
    }

    func testMissingFieldsBecomeDash() {
        let entries = SpecsProjectionBuilder.buildEntries(specs: nil, config: nil, options: nil, labels: labels)
        XCTAssertEqual(entries.count, 7)
        XCTAssertTrue(entries.allSatisfy { $0.value == "—" })
        XCTAssertNil(entries[0].badge)
    }

    func testAuxBatteryComesOnlyFromSpecs() {
        let entries = SpecsProjectionBuilder.buildEntries(
            specs: RawVehicleSpecs(auxBatteryType: .text("Li-ion")),
            config: nil,
            options: nil,
            labels: labels
        )
        XCTAssertEqual(entries[5].label, "Aux Battery")
        XCTAssertEqual(entries[5].value, "Li-ion")
    }

    func testOptionsDecodeKeyFallbackAndSliceToEight() {
        let options = (0 ..< 10).map { index in
            SpecOption(key: "OPT\(index)", value: index == 0 ? .text("Decoded0") : .absent)
        }
        let entries = SpecsProjectionBuilder.buildEntries(specs: nil, config: nil, options: options, labels: labels)
        let optionRows = entries.filter { $0.badge != nil }
        XCTAssertEqual(optionRows.count, 8)
        XCTAssertEqual(optionRows[0].label, "OPT0")
        XCTAssertEqual(optionRows[0].value, "Decoded0")
        // asString(options[key]) ?? key — absent value falls back to the raw key.
        XCTAssertEqual(optionRows[1].value, "OPT1")
        XCTAssertEqual(optionRows[0].badge, "Option")
    }

    func testCompactHeadline() {
        let compact = SpecsProjectionBuilder.buildCompact(
            specs: RawVehicleSpecs(carType: .text("Model X"), trimBadging: .text("Plaid")),
            config: nil
        )
        XCTAssertEqual(compact.model, "Model X")
        XCTAssertEqual(compact.trim, "Plaid")

        let empty = SpecsProjectionBuilder.buildCompact(specs: nil, config: nil)
        XCTAssertEqual(empty.model, "—")
        XCTAssertEqual(empty.trim, "—")
    }

    func testBuildHasDataSemantics() {
        XCTAssertFalse(SpecsProjectionBuilder.build(specs: nil, config: nil, options: nil, labels: labels).hasData)
        // Present-but-empty envelopes still count as data (web `!== null`).
        XCTAssertTrue(SpecsProjectionBuilder.build(specs: nil, config: nil, options: [], labels: labels).hasData)
        XCTAssertTrue(
            SpecsProjectionBuilder.build(specs: RawVehicleSpecs(), config: nil, options: nil, labels: labels).hasData
        )
    }

    func testBuildProducesFullProjection() {
        let options = (0 ..< 10).map { SpecOption(key: "OPT\($0)") }
        let projection = SpecsProjectionBuilder.build(
            specs: RawVehicleSpecs(carType: .text("Model 3")),
            config: nil,
            options: options,
            labels: labels
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertTrue(projection.hasEntries)
        // 7 fixed + 8 sliced option rows.
        XCTAssertEqual(projection.entries.count, 15)
        XCTAssertEqual(projection.compact.model, "Model 3")
    }

    func testEmptyProjectionConstant() {
        XCTAssertFalse(SpecsProjection.empty.hasData)
        XCTAssertTrue(SpecsProjection.empty.entries.isEmpty)
        XCTAssertEqual(SpecsProjection.empty.compact.model, "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class VehicleSpecsModelTests: XCTestCase {
    private func dataUpdate(
        status: SpecsLoadStatus,
        connection: SpecsConnection = .live
    ) -> VehicleSpecsUpdate {
        VehicleSpecsUpdate(
            status: status,
            connection: connection,
            specs: RawVehicleSpecs(carType: .text("Model 3")),
            updatedAt: Date()
        )
    }

    private func makeModel(
        _ update: VehicleSpecsUpdate,
        telemetry: SpecsTelemetry = OSLogSpecsTelemetry()
    ) -> (VehicleSpecsModel, InMemorySpecsSource) {
        let source = InMemorySpecsSource(initial: update)
        let model = VehicleSpecsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(VehicleSpecsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(VehicleSpecsUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(VehicleSpecsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.entries.first?.value, "Model 3")

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testPresentEmptyOptionsCountsAsData() {
        let update = VehicleSpecsUpdate(status: .loaded, options: [])
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySpecsTelemetry()
        let (model, source) = makeModel(VehicleSpecsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleSpecsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(VehicleSpecsUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(VehicleSpecsUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.compact.model, "Model 3")
    }
}

// MARK: - Registry parity

@MainActor final class SpecsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VehicleSpecsWidget.registration
        XCTAssertEqual(registration.id, "vehicle-specs")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VehicleSpecsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 3, rows: 8)), DashboardWidgetSize(cols: 3, rows: 8))
    }
}

// MARK: - Accessibility summary content

@MainActor final class SpecsAccessibilityTests: XCTestCase {
    func testSummaryIncludesPresentSpecsAndOptionCount() {
        let projection = SpecsProjectionBuilder.build(
            specs: RawVehicleSpecs(carType: .text("Model 3"), trimBadging: .text("Performance")),
            config: nil,
            options: [SpecOption(key: "$APBS", value: .text("Acceleration Boost"))],
            labels: .default
        )
        let summary = SpecsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Model: Model 3"))
        XCTAssertTrue(summary.contains("Trim: Performance"))
        XCTAssertTrue(summary.contains("1 options"))
        // Unresolved fixed rows (Paint/Wheels/…) are omitted from the spoken value.
        XCTAssertFalse(summary.contains("Paint Color: —"))
    }

    func testSummaryFallsBackWhenNothingResolved() {
        let projection = SpecsProjectionBuilder.build(
            specs: RawVehicleSpecs(),
            config: nil,
            options: nil,
            labels: .default
        )
        XCTAssertEqual(SpecsAccessibility.summary(for: projection), "No specs available")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySpecsTelemetry: SpecsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
