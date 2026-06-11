//
//  PollingEngine.ProjectionTests.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  Coverage for the pure projection + the view signature contract:
//    • Projection — every render branch (disabled / loading / error / ready), the savings tiles +
//      breakdown + legend, the vehicle rows + expanded detail + prediction, the no-vehicles empty
//      case, and the savings-absent / empty-breakdown guards.
//    • Views — every state's subview + the surface compose (signature contract).
//
//  Shared, network-free fixtures live here (`PollingFixtures`) and are reused by the model tests.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

enum PollingFixtures {
    static let now = Date(timeIntervalSince1970: 1_000_000)

    static let cost = PollingCostSnapshot(
        pollsMade: 1284,
        pollsSaved: 942,
        savingsPercent: 42.5,
        estimatedSavings: 12.84,
        remainingCredit: 87.16,
        savingsBreakdown: [
            "fleet_telemetry": 540,
            "idle_detection": 280,
            "prediction": 90,
            "sleep_detection": 32
        ]
    )

    static var vehicleWithDecision: PollingVehicleStatus {
        PollingVehicleStatus(
            vin: "5YJ3E1EA7KF317261",
            activity: .active,
            profile: .driving,
            consecIdle: 3,
            batteryLevel: 78,
            nextPollAfter: now.addingTimeInterval(90),
            lastDecision: PollingDecision(
                nextIntervalMs: 15000,
                reasons: ["Vehicle is driving", "High data-rate window"],
                prediction: PollingPrediction(
                    nextState: "charging",
                    estimatedInNanos: 1_200_000_000_000,
                    confidence: 0.82,
                    basedOn: "recent drive pattern"
                )
            )
        )
    }

    static var vehicleNoDecision: PollingVehicleStatus {
        PollingVehicleStatus(
            vin: "7SAYGDEF9NF512033",
            activity: .sleeping,
            profile: .sleeping,
            consecIdle: 20,
            batteryLevel: 55,
            nextPollAfter: now.addingTimeInterval(3600),
            lastDecision: nil
        )
    }

    static var enabledInput: PollingInput {
        PollingInput(
            status: .loaded(PollingStatusSnapshot(
                enabled: true,
                vehicles: [vehicleWithDecision, vehicleNoDecision]
            )),
            savings: cost,
            connection: .live
        )
    }

    static func enabled(connection: PollingConnection) -> PollingInput {
        PollingInput(
            status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [vehicleWithDecision])),
            savings: cost,
            connection: connection
        )
    }

    static let disabledInput = PollingInput(
        status: .loaded(PollingStatusSnapshot(enabled: false, vehicles: [])),
        connection: .live
    )
}

// MARK: - Projection

final class PollingProjectionTests: XCTestCase {
    func testLoadingPhase() {
        let resolved = PollingProjection.resolve(PollingInput(status: .loading), now: PollingFixtures.now)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertNil(resolved.ready)
    }

    func testFailedPhaseCarriesMessage() {
        let resolved = PollingProjection.resolve(
            PollingInput(status: .failed("boom")),
            now: PollingFixtures.now
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.ready)
    }

    func testDisabledWithdraws() {
        let resolved = PollingProjection.resolve(PollingFixtures.disabledInput, now: PollingFixtures.now)
        XCTAssertEqual(resolved.phase, .disabled)
        XCTAssertNil(resolved.ready)
    }

    func testReadyHeaderAndSavingsMetrics() throws {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        XCTAssertEqual(resolved.phase, .ready)
        let ready = try XCTUnwrap(resolved.ready)
        XCTAssertEqual(ready.title, "Adaptive Polling Engine")
        XCTAssertEqual(ready.activeBadge, "Active")
        XCTAssertEqual(ready.vehiclesTitle, "Vehicle Activity")

        let savings = try XCTUnwrap(ready.savings)
        XCTAssertEqual(savings.metrics.map(\.value), ["42.5%", "$12.84", "1284", "$87.16"])
        XCTAssertEqual(savings.metrics.map(\.label), ["Polls Saved", "$ Saved", "Polls Made", "Credit Left"])
        XCTAssertEqual(savings.metrics[0].tone, .success)
        XCTAssertEqual(savings.metrics[2].tone, .primary)
        XCTAssertEqual(savings.metrics[0].accessibilityLabel, "Polls Saved: 42.5%")
    }

    func testReadyBreakdownSegmentsAndLegend() throws {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        let savings = try XCTUnwrap(resolved.ready?.savings)
        XCTAssertTrue(savings.showBreakdown)
        XCTAssertEqual(savings.segments.map(\.id), ["fleetTelemetry", "idleDetection", "prediction", "sleepDetection"])
        XCTAssertEqual(savings.legend.count, 4)
        // Fractions relative to the full total (942).
        XCTAssertEqual(savings.segments[0].fraction, 540.0 / 942.0, accuracy: 0.0001)
        XCTAssertEqual(savings.segments[0].accessibilityLabel, "Fleet Telemetry: 540")
    }

    func testReadyVehicleRowFields() throws {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        let ready = try XCTUnwrap(resolved.ready)
        XCTAssertEqual(ready.vehicles.count, 2)

        let first = ready.vehicles[0]
        XCTAssertEqual(first.vinShort, "KF317261")
        XCTAssertEqual(first.activityChip, "active · Driving")
        XCTAssertEqual(first.tone, .success)
        XCTAssertEqual(first.symbolName, "bolt.fill")
        XCTAssertTrue(first.pulses)
        XCTAssertEqual(first.nextLabel, "Next: 1m")
        XCTAssertEqual(first.accessibilityLabel, "KF317261, active, Driving, 1m")
    }

    func testReadyVehicleDetailAndPrediction() throws {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        let ready = try XCTUnwrap(resolved.ready)
        let detail = try XCTUnwrap(ready.vehicles[0].detail)
        XCTAssertEqual(detail.interval, "Interval: 15s")
        XCTAssertEqual(detail.consecIdle, "Consecutive idle: 3")
        XCTAssertEqual(detail.battery, "Battery: 78%")
        XCTAssertEqual(detail.reasons.map(\.text), ["Vehicle is driving", "High data-rate window"])

        let prediction = try XCTUnwrap(detail.prediction)
        XCTAssertEqual(prediction.summary, "Prediction: charging in 20m (82% conf)")
        XCTAssertEqual(prediction.basedOn, "Based on: recent drive pattern")
    }

    func testVehicleWithoutDecisionHasNoDetail() throws {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        let ready = try XCTUnwrap(resolved.ready)
        let second = ready.vehicles[1]
        XCTAssertNil(second.detail)
        XCTAssertEqual(second.nextLabel, "Next: 1h 0m")
    }

    func testReadyEmptyShowsMessageAndKeepsSavings() throws {
        let input = PollingInput(
            status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [])),
            savings: PollingFixtures.cost,
            connection: .live
        )
        let ready = try XCTUnwrap(PollingProjection.resolve(input, now: PollingFixtures.now).ready)
        XCTAssertTrue(ready.isEmpty)
        XCTAssertEqual(
            ready.emptyMessage,
            "No vehicles tracked yet. Polling engine will activate on first poll."
        )
        XCTAssertNotNil(ready.savings)
    }

    func testSavingsAbsent() throws {
        let input = PollingInput(
            status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [PollingFixtures.vehicleNoDecision])),
            savings: nil,
            connection: .live
        )
        let ready = try XCTUnwrap(PollingProjection.resolve(input, now: PollingFixtures.now).ready)
        XCTAssertNil(ready.savings)
    }

    func testEmptyBreakdownHidesBar() throws {
        let cost = PollingCostSnapshot(
            pollsMade: 10,
            pollsSaved: 4,
            savingsPercent: 28.5,
            estimatedSavings: 1.2,
            remainingCredit: 50,
            savingsBreakdown: [:]
        )
        let input = PollingInput(
            status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [])),
            savings: cost,
            connection: .live
        )
        let savings = try XCTUnwrap(PollingProjection.resolve(input, now: PollingFixtures.now).ready?.savings)
        XCTAssertFalse(savings.showBreakdown)
        XCTAssertTrue(savings.segments.isEmpty)
        XCTAssertTrue(savings.legend.isEmpty)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class PollingEngineViewTests: XCTestCase {
    private func readyFixture() throws -> PollingReady {
        let resolved = PollingProjection.resolve(PollingFixtures.enabledInput, now: PollingFixtures.now)
        return try XCTUnwrap(resolved.ready)
    }

    func testEveryStateSubviewComposes() throws {
        let ready = try readyFixture()
        let savings = try XCTUnwrap(ready.savings)
        let vehicle = ready.vehicles[0]
        let detail = try XCTUnwrap(vehicle.detail)
        let prediction = try XCTUnwrap(detail.prediction)

        _ = PollingHeaderView(activeBadge: "Active", connection: .live, onRefresh: {})
        _ = PollingHeaderView(activeBadge: nil, connection: .stale, onRefresh: {})
        _ = PollingFreshnessChip(connection: .offline)
        _ = PollingRefreshButton(action: {})
        _ = PollingConnectivityBanner(connection: .stale)
        _ = PollingLoadingView()
        _ = PollingErrorView(message: "x", onRetry: {})
        _ = PollingMetricTile(metric: savings.metrics[0])
        _ = PollingBreakdownBar(segments: savings.segments)
        _ = PollingLegendView(items: savings.legend)
        _ = PollingActivityIcon(symbolName: vehicle.symbolName, tone: vehicle.tone, pulses: vehicle.pulses)
        _ = PollingActivityChip(text: vehicle.activityChip, tone: vehicle.tone)
        _ = PollingVehicleActivityRow(vehicle: vehicle)
        _ = PollingVehicleActivityRow(vehicle: ready.vehicles[1])
        _ = PollingVehicleDetailView(detail: detail)
        _ = PollingPredictionView(prediction: prediction)
        _ = PollingEmptyVehiclesView(message: ready.emptyMessage)
        _ = PollingReadyView(ready: ready)
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [PollingInput] = [
            PollingInput(status: .loading),
            PollingInput(status: .failed("x")),
            PollingFixtures.disabledInput,
            PollingFixtures.enabledInput,
            PollingInput(
                status: .loaded(PollingStatusSnapshot(enabled: true, vehicles: [])),
                savings: PollingFixtures.cost
            ),
            PollingFixtures.enabled(connection: .stale),
            PollingFixtures.enabled(connection: .offline)
        ]
        for input in inputs {
            _ = PollingEngine(input: input)
        }
    }
}
