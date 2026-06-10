//
//  IncidentsCard.Tests.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  Unit coverage for the IncidentsCard surface: the Adapter projections (render-phase
//  resolution, the `relativeFrom` port incl. its boundaries + future clamp, the affects +
//  metadata lines, the severity icon/rank + status badge tone, and the localized option text),
//  the accessibility builders (card + per-row labels, automation ids), and the
//  `IncidentsCardModel` state holder (snapshot application → phase/count/freshness, the inline
//  reload error over cached rows, the one-shot stale auto-refresh, the "Log incident" sheet +
//  post-dismiss refresh, the retry, and the P1/S11 `view.opened` telemetry).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by the in-memory + controllable seams.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: phase, relative time, lines, tones, icons

final class IncidentsCardAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (LocalizedText) -> String = { $0.fallback }

    // Render phase (web list-vs-collapse widened with loading/empty/error)

    func testResolvePhaseWithoutRows() {
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .loading, incidentCount: 0), .loading)
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .loaded, incidentCount: 0), .empty)
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .failed("x"), incidentCount: 0), .error("x"))
    }

    func testResolvePhaseWithRowsAlwaysContent() {
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .loading, incidentCount: 2), .content)
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .loaded, incidentCount: 2), .content)
        XCTAssertEqual(IncidentsCardAdapter.resolvePhase(status: .failed("x"), incidentCount: 2), .content)
    }

    // Relative time (web `relativeFrom` + Math.max(0, …) clamp + unit boundaries)

    func testRelativeTimeBuckets() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        func rel(_ secondsAgo: TimeInterval) -> String {
            IncidentsCardAdapter.relativeTime(now: now, from: now.addingTimeInterval(-secondsAgo), localize: echo)
        }
        XCTAssertEqual(rel(0), "just now")
        XCTAssertEqual(rel(59), "just now")
        XCTAssertEqual(rel(60), "1m ago")
        XCTAssertEqual(rel(90), "1m ago")
        XCTAssertEqual(rel(3599), "59m ago")
        XCTAssertEqual(rel(3600), "1h ago")
        XCTAssertEqual(rel(86399), "23h ago")
        XCTAssertEqual(rel(86400), "1d ago")
        XCTAssertEqual(rel(259_200), "3d ago")
    }

    func testRelativeTimeClampsFutureToJustNow() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let future = now.addingTimeInterval(120)
        XCTAssertEqual(IncidentsCardAdapter.relativeTime(now: now, from: future, localize: echo), "just now")
    }

    // Affects line (web `affected_components.length > 0` + join(', '))

    func testAffectsLine() {
        XCTAssertNil(IncidentsCardAdapter.affectsLine([], localize: echo))
        XCTAssertNil(IncidentsCardAdapter.affectsLine(["   "], localize: echo))
        XCTAssertEqual(IncidentsCardAdapter.affectsLine(["tesla"], localize: echo), "Affects: tesla")
        XCTAssertEqual(
            IncidentsCardAdapter.affectsLine([" tesla ", "", "telemetry"], localize: echo),
            "Affects: tesla, telemetry"
        )
    }

    // Metadata line (web "Started …" + "· N updates" when updates.length > 1)

    func testMetadataLineWithoutUpdatesSuffix() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let started = now.addingTimeInterval(-3600)
        XCTAssertEqual(
            IncidentsCardAdapter.metadataLine(now: now, startedAt: started, updateCount: 1, localize: echo),
            "Started 1h ago"
        )
        // updateCount 0 also omits the suffix (web `> 1` guard).
        XCTAssertEqual(
            IncidentsCardAdapter.metadataLine(now: now, startedAt: started, updateCount: 0, localize: echo),
            "Started 1h ago"
        )
    }

    func testMetadataLineWithUpdatesSuffix() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let started = now.addingTimeInterval(-7200)
        XCTAssertEqual(
            IncidentsCardAdapter.metadataLine(now: now, startedAt: started, updateCount: 4, localize: echo),
            "Started 2h ago · 4 updates"
        )
    }

    // Severity icon + escalation rank (web `SEVERITY_TONE` icon + amber/orange/red ramp)

    func testSeveritySymbolName() {
        XCTAssertEqual(IncidentsCardAdapter.severitySymbolName(.minor), "exclamationmark.circle.fill")
        XCTAssertEqual(IncidentsCardAdapter.severitySymbolName(.major), "exclamationmark.triangle.fill")
        XCTAssertEqual(IncidentsCardAdapter.severitySymbolName(.critical), "exclamationmark.octagon.fill")
    }

    func testSeverityRank() {
        XCTAssertEqual(IncidentsCardAdapter.severityRank(.minor), .caution)
        XCTAssertEqual(IncidentsCardAdapter.severityRank(.major), .elevated)
        XCTAssertEqual(IncidentsCardAdapter.severityRank(.critical), .critical)
    }

    // Status badge tone (web `STATUS_BADGE` map)

    func testStatusTone() {
        XCTAssertEqual(IncidentsCardAdapter.statusTone(.investigating), .danger)
        XCTAssertEqual(IncidentsCardAdapter.statusTone(.identified), .warning)
        XCTAssertEqual(IncidentsCardAdapter.statusTone(.monitoring), .info)
        XCTAssertEqual(IncidentsCardAdapter.statusTone(.resolved), .success)
    }

    // Localized option descriptors (keys + web fallbacks)

    func testSeverityAndStatusDescriptors() {
        XCTAssertEqual(IncidentsCardText.severity(.minor).key, "status.incidents.severity.minor")
        XCTAssertEqual(IncidentsCardText.severity(.critical).fallback, "critical")
        XCTAssertEqual(IncidentsCardText.status(.investigating).key, "status.incidents.status.investigating")
        XCTAssertEqual(IncidentsCardText.status(.resolved).fallback, "resolved")
    }
}

// MARK: - Accessibility builders

final class IncidentsCardAccessibilityTests: XCTestCase {
    private let echo: (LocalizedText) -> String = { $0.fallback }

    func testIdentifiers() {
        XCTAssertEqual(IncidentsCardAccessibility.logCtaID, "incidents-log-cta")
        XCTAssertEqual(IncidentsCardAccessibility.rowID(42), "incidents-row-42")
    }

    func testCardLabel() {
        XCTAssertEqual(
            IncidentsCardAccessibility.cardLabel(count: 3, localize: echo),
            "Active incidents, 3 active"
        )
    }

    func testRowLabelComposesEveryPart() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let incident = ActiveIncident(
            id: 7,
            title: "Telemetry lag",
            severity: .major,
            status: .identified,
            affectedComponents: ["telemetry", "mqtt"],
            updateCount: 2,
            startedAt: now.addingTimeInterval(-3600)
        )
        let label = IncidentsCardAccessibility.rowLabel(incident, now: now, localize: echo)
        XCTAssertEqual(
            label,
            "major, Telemetry lag, status identified, Started 1h ago · 2 updates, Affects: telemetry, mqtt"
        )
    }

    func testRowLabelOmitsAffectsWhenEmpty() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let incident = ActiveIncident(
            id: 8,
            title: "DB failover",
            severity: .critical,
            status: .investigating,
            affectedComponents: [],
            updateCount: 1,
            startedAt: now.addingTimeInterval(-120)
        )
        let label = IncidentsCardAccessibility.rowLabel(incident, now: now, localize: echo)
        XCTAssertEqual(label, "critical, DB failover, status investigating, Started 2m ago")
    }
}

// MARK: - State holder: snapshot application, freshness, sheet, telemetry

@MainActor
final class IncidentsCardModelTests: XCTestCase {
    private let echo: (LocalizedText) -> String = { $0.fallback }

    private func incident(id: Int64 = 1, severity: IncidentSeverity = .major) -> ActiveIncident {
        ActiveIncident(
            id: id,
            title: "Incident \(id)",
            severity: severity,
            status: .investigating,
            affectedComponents: [],
            updateCount: 1,
            startedAt: Date(timeIntervalSince1970: 1_000_000)
        )
    }

    private func makeModel(
        source: ControllableIncidentsSource,
        telemetry: any IncidentsCardTelemetry = OSLogIncidentsCardTelemetry()
    ) -> IncidentsCardModel {
        IncidentsCardModel(
            source: source,
            incidentCreator: InMemoryIncidentCreator(),
            telemetry: telemetry,
            localize: echo
        )
    }

    func testInitialPhaseIsLoading() {
        let model = makeModel(source: ControllableIncidentsSource())
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.count, 0)
        XCTAssertEqual(model.connection, .live)
        XCTAssertNil(model.inlineErrorMessage)
        XCTAssertFalse(model.isPresentingLogForm)
    }

    func testStartEmitsViewOpenedOnceAndStartsSource() {
        let spy = SpyIncidentsTelemetry()
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [IncidentsCardSurface.slug])
        XCTAssertEqual(IncidentsCardSurface.slug, "IncidentsCard")
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedWithIncidentsResolvesContent() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .loaded, incidents: [incident(id: 1), incident(id: 2)]))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.count, 2)
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .loaded, incidents: []))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.count, 0)
    }

    func testFailedWithoutRowsResolvesError() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .failed("timeout"), incidents: []))
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage) // not content → no inline error
    }

    func testFailedWithCachedRowsKeepsContentAndSurfacesInlineError() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .failed("reload failed"), incidents: [incident(id: 1)]))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLiveAgain() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .loaded, connection: .stale, incidents: [incident()]))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        // A second stale snapshot must NOT re-trigger the auto-refresh.
        source.emit(IncidentsUpdate(status: .loaded, connection: .stale, incidents: [incident()]))
        XCTAssertEqual(source.refreshCount, 1)
        // Going live resets the guard; a later stale episode refreshes once more.
        source.emit(IncidentsUpdate(status: .loaded, connection: .live, incidents: [incident()]))
        source.emit(IncidentsUpdate(status: .loaded, connection: .stale, incidents: [incident()]))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedRowsWithoutRefetching() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .loaded, connection: .offline, incidents: [incident()]))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDelegatesToSource() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLogFormPresentationAndPostDismissRefresh() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.presentLogForm()
        XCTAssertTrue(model.isPresentingLogForm)
        model.dismissLogForm()
        XCTAssertFalse(model.isPresentingLogForm)
        model.handleLogFormDismissed()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopAllowsViewOpenedToEmitAgainOnRestart() {
        let spy = SpyIncidentsTelemetry()
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [IncidentsCardSurface.slug, IncidentsCardSurface.slug])
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testInMemorySourcePushesOnStartAndRefresh() {
        let source = InMemoryIncidentsSource(
            update: IncidentsUpdate(status: .loaded, incidents: [incident()])
        )
        let model = IncidentsCardModel(
            source: source,
            incidentCreator: InMemoryIncidentCreator(),
            localize: echo
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.startCount, 1)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testAccessibilityLabelUsesCount() {
        let source = ControllableIncidentsSource()
        let model = makeModel(source: source)
        model.start()
        source.emit(IncidentsUpdate(status: .loaded, incidents: [incident(id: 1), incident(id: 2)]))
        XCTAssertEqual(model.accessibilityLabel, "Active incidents, 2 active")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyIncidentsTelemetry: IncidentsCardTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
