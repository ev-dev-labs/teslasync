//
//  FSMStateDiagram.Tests.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  Unit coverage for the pure layers of the FSMStateDiagram surface:
//    • Registry — known types, ordered states, derived edges, getStateColor (case-
//      insensitive lookup + the vehicle / neutral fallbacks), and deriveEdges dedup.
//    • Projection — the web `useMemo` counts + latest-state scan (with fsmType filter),
//      the resolve branches (error / loading / empty / data), node assembly (arrow +
//      current flags), and the edge-summary sort / cap / tie-break.
//    • Timestamp parsing — web `new Date(ts).getTime()` equivalence.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Registry

@MainActor final class FSMStateDiagramRegistryTests: XCTestCase {
    func testKnownTypesAreResolvable() {
        XCTAssertEqual(FSMRegistry.knownTypes.count, 8)
        for type in FSMRegistry.knownTypes {
            XCTAssertTrue(FSMRegistry.isKnown(type), "expected \(type) to be known")
            XCTAssertNotNil(FSMRegistry.states(for: type))
            XCTAssertNotNil(FSMRegistry.edges(for: type))
        }
    }

    func testUnknownTypesResolveNil() {
        XCTAssertFalse(FSMRegistry.isKnown("all"))
        XCTAssertNil(FSMRegistry.states(for: "all"))
        XCTAssertNil(FSMRegistry.edges(for: "nonexistent"))
    }

    func testVehicleStatesPreserveOrder() {
        XCTAssertEqual(
            FSMRegistry.states(for: "vehicle"),
            ["online", "driving", "charging", "parked", "updating", "asleep", "offline"]
        )
    }

    func testGetStateColorMirrorsWebOverrides() {
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "online"), .success)
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "charging"), .cyan)
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "parked"), .purple)
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "updating"), .indigo)
        XCTAssertEqual(FSMRegistry.color(for: "drive_session", state: "ending"), .orange)
        XCTAssertEqual(FSMRegistry.color(for: "command", state: "gave_up"), .strongDanger)
        XCTAssertEqual(FSMRegistry.color(for: "automation", state: "disabled"), .faded)
    }

    func testGetStateColorIsCaseInsensitive() {
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "CHARGING"), .cyan)
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "Driving"), .success)
    }

    func testGetStateColorFallbacks() {
        // Unknown state → neutral (web DEFAULT_STATE).
        XCTAssertEqual(FSMRegistry.color(for: "vehicle", state: "bogus"), .neutral)
        // Unknown FSM type → vehicle colour map (web `FSM_REGISTRY[type] ?? vehicle`).
        XCTAssertEqual(FSMRegistry.color(for: "mystery", state: "driving"), .success)
    }

    func testDeriveEdgesDedupsPreservingOrder() {
        let input = [FSMEdge("a", "b"), FSMEdge("a", "b"), FSMEdge("b", "c"), FSMEdge("a", "b")]
        XCTAssertEqual(FSMEdgeDerivation.derive(input), [FSMEdge("a", "b"), FSMEdge("b", "c")])
    }

    func testVehicleEdgesAreUniqueAndContainKnownPairs() throws {
        let edges = try XCTUnwrap(FSMRegistry.edges(for: "vehicle"))
        XCTAssertTrue(edges.contains(FSMEdge("online", "driving")))
        XCTAssertTrue(edges.contains(FSMEdge("charging", "asleep")))
        let keys = edges.map { "\($0.from)->\($0.to)" }
        XCTAssertEqual(keys.count, Set(keys).count, "edges must be deduplicated")
    }
}

// MARK: - Projection

@MainActor final class FSMStateDiagramProjectionTests: XCTestCase {
    private func transition(
        _ id: Int,
        _ ts: String,
        _ from: String,
        _ to: String,
        fsm: String = "vehicle"
    ) -> FSMTransition {
        FSMTransition(id: id, vehicleID: 1, ts: ts, fsmName: fsm, fromState: from, toState: to)
    }

    func testCountsAndLatestState() {
        let transitions = [
            transition(1, "2026-01-01T00:00:00Z", "online", "driving"),
            transition(2, "2026-01-01T01:00:00Z", "driving", "parked"),
            transition(3, "2026-01-01T02:00:00Z", "parked", "charging")
        ]
        let counts = FSMStateDiagramProjection.counts(fsmType: "vehicle", transitions: transitions)
        XCTAssertEqual(counts.latestState, "charging")
        XCTAssertEqual(counts.stateCounts["driving"], 2)
        XCTAssertEqual(counts.stateCounts["online"], 1)
        XCTAssertEqual(counts.edgeCounts["online->driving"], 1)
        XCTAssertEqual(counts.edgeCounts["parked->charging"], 1)
    }

    func testCountsFilterByFsmType() {
        let transitions = [
            transition(1, "2026-01-01T00:00:00Z", "online", "driving", fsm: "vehicle"),
            transition(2, "2026-01-01T05:00:00Z", "armed", "fired", fsm: "alert_cooldown")
        ]
        let counts = FSMStateDiagramProjection.counts(fsmType: "vehicle", transitions: transitions)
        XCTAssertNil(counts.stateCounts["fired"])
        XCTAssertEqual(counts.latestState, "driving")
    }

    func testResolveErrorBeatsEverything() {
        let input = FSMStateDiagramInput(fsmType: "vehicle", isLoading: true, errorMessage: "boom")
        XCTAssertEqual(FSMStateDiagramProjection.resolve(input).phase, .error("boom"))
    }

    func testResolveLoading() {
        let input = FSMStateDiagramInput(fsmType: "vehicle", isLoading: true)
        XCTAssertEqual(FSMStateDiagramProjection.resolve(input).phase, .loading)
    }

    func testResolveEmptyForUnknownType() {
        XCTAssertEqual(FSMStateDiagramProjection.resolve(FSMStateDiagramInput(fsmType: "all")).phase, .empty)
    }

    func testResolveDataAssemblesNodes() {
        let transitions = [
            transition(1, "2026-01-01T00:00:00Z", "online", "driving"),
            transition(2, "2026-01-01T01:00:00Z", "driving", "charging")
        ]
        let resolved = FSMStateDiagramProjection.resolve(
            FSMStateDiagramInput(fsmType: "vehicle", transitions: transitions)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.nodes.count, 7)
        XCTAssertEqual(resolved.latestState, "charging")
        XCTAssertEqual(resolved.nodes.first?.state, "online")
        XCTAssertEqual(resolved.nodes.first?.hasArrow, true)
        XCTAssertEqual(resolved.nodes.first?.arrowCount, 1)
        XCTAssertEqual(resolved.nodes.last?.hasArrow, false)
        XCTAssertEqual(resolved.nodes.first { $0.state == "charging" }?.isCurrent, true)
        XCTAssertEqual(resolved.nodes.first { $0.state == "updating" }?.count, 0)
    }

    func testEdgeSummarySortsByCountAndCapsAtTen() {
        var edgeCounts: [String: Int] = [:]
        for index in 1 ... 12 {
            edgeCounts["s\(index)->t\(index)"] = index
        }
        let summary = FSMStateDiagramProjection.edgeSummary(fsmType: "vehicle", edgeCounts: edgeCounts)
        XCTAssertEqual(summary.count, 10)
        XCTAssertEqual(summary.first?.count, 12)
        XCTAssertEqual(summary.last?.count, 3)
    }

    func testEdgeSummaryTieBreaksByKey() {
        let summary = FSMStateDiagramProjection.edgeSummary(
            fsmType: "vehicle",
            edgeCounts: ["b->c": 5, "a->b": 5]
        )
        XCTAssertEqual(summary.map(\.id), ["a->b", "b->c"])
        XCTAssertEqual(summary.first?.fromColor, .neutral)
    }

    func testTimestampParsing() {
        XCTAssertNotNil(FSMStateDiagramProjection.parseTimestamp("2026-01-01T00:00:00Z"))
        XCTAssertNotNil(FSMStateDiagramProjection.parseTimestamp("2026-01-01T00:00:00.500Z"))
        XCTAssertNil(FSMStateDiagramProjection.parseTimestamp("not-a-date"))
    }
}
