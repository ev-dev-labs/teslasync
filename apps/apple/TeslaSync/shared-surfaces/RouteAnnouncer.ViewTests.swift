//
//  RouteAnnouncer.ViewTests.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  View-composition + facade coverage: the public surface composes in every state
//  (loading / empty / error / data / stale / offline), the focus-free subviews build (region
//  card, history row + section, data body, freshness chip, loading / empty / error chrome), and
//  the P1/S10 facade resolves the native chrome copy + the a11y additions with the English
//  fallbacks. Split from the model/seams tests for the SwiftLint file-length budget. These run in
//  the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class RouteAnnouncerViewTests: XCTestCase {
    private func sample(_ id: Int = 1, _ title: String = "Drives — TeslaSync") -> RouteAnnouncement {
        RouteAnnouncement(
            id: id,
            path: "/drives",
            title: title,
            announcementText: RouteAnnouncerPadding.padded(title, sequence: id),
            timestamp: Date(timeIntervalSinceReferenceDate: Double(id))
        )
    }

    private func model(_ input: RouteAnnouncerInput) -> RouteAnnouncerModel {
        let model = RouteAnnouncerModel(
            source: InMemoryRouteAnnouncerSource(initial: input),
            scheduler: ManualRouteAnnouncerScheduler()
        )
        model.start()
        return model
    }

    private func dataModel(connection: RouteAnnouncerConnection = .live) -> RouteAnnouncerModel {
        let scheduler = ManualRouteAnnouncerScheduler()
        let source = InMemoryRouteAnnouncerSource(
            initial: RouteAnnouncerInput(snapshot: RouteSnapshot(path: "/", title: "Dashboard — TeslaSync"))
        )
        let model = RouteAnnouncerModel(source: source, scheduler: scheduler)
        model.start()
        source.push(RouteAnnouncerInput(snapshot: RouteSnapshot(path: "/drives", title: "Drives — TeslaSync")))
        scheduler.advance(by: 0.2)
        if connection != .live {
            source.push(RouteAnnouncerInput(
                snapshot: RouteSnapshot(path: "/drives", title: "Drives — TeslaSync"),
                connection: connection
            ))
        }
        return model
    }

    // MARK: Surface composes in every state

    func testSurfaceComposesForEveryState() {
        _ = RouteAnnouncer(model: dataModel())
        _ = RouteAnnouncer(model: model(RouteAnnouncerInput(isLoading: true)))
        _ = RouteAnnouncer(model: model(RouteAnnouncerInput(errorMessage: "down")))
        _ = RouteAnnouncer(model: model(RouteAnnouncerInput())) // empty
        _ = RouteAnnouncer(model: dataModel(connection: .stale))
        _ = RouteAnnouncer(model: dataModel(connection: .offline))
        XCTAssertEqual(RouteAnnouncer.surfaceSlug, "RouteAnnouncer")
    }

    func testSurfaceComposesFromConvenienceInitializer() {
        _ = RouteAnnouncer()
    }

    // MARK: Focus-free subviews build

    func testSubviewsBuild() {
        _ = RouteAnnouncerRegionCard(announcement: nil)
        _ = RouteAnnouncerRegionCard(announcement: sample())
        _ = RouteAnnouncerHistoryRow(announcement: sample())
        _ = RouteAnnouncerHistorySection(entries: [sample(1), sample(2, "Analytics — TeslaSync")])
        _ = RouteAnnouncerDataView(resolved: RouteAnnouncerResolved(
            phase: .data, current: sample(), history: [sample()]
        ))
        _ = RouteAnnouncerFreshnessChip(connection: .stale) {}
        _ = RouteAnnouncerFreshnessChip(connection: .offline) {}
        _ = RouteAnnouncerFreshnessChip(connection: .live) {}
        _ = RouteAnnouncerLoadingView()
        _ = RouteAnnouncerEmptyView()
        _ = RouteAnnouncerErrorView(message: "boom") {}
    }

    // MARK: Strings facade (native chrome copy)

    func testHeaderAndRegionCopyResolve() {
        XCTAssertEqual(RouteAnnouncerStrings.title, "Route announcements")
        XCTAssertEqual(
            RouteAnnouncerStrings.subtitle,
            "The page title voiced to VoiceOver after each navigation"
        )
        XCTAssertEqual(RouteAnnouncerStrings.regionName, "Live region")
        XCTAssertEqual(RouteAnnouncerStrings.regionRole, "Announced politely after navigation")
        XCTAssertEqual(RouteAnnouncerStrings.emptyValue, "—")
        XCTAssertEqual(RouteAnnouncerStrings.historyTitle, "Recent navigations")
        XCTAssertEqual(RouteAnnouncerStrings.navigatedWord, "Navigated")
    }

    func testStateAndFreshnessCopyResolve() {
        XCTAssertEqual(RouteAnnouncerStrings.empty, "No navigations yet")
        XCTAssertEqual(RouteAnnouncerStrings.retry, "Retry")
        XCTAssertEqual(RouteAnnouncerStrings.live, "Live")
        XCTAssertEqual(RouteAnnouncerStrings.stale, "Stale")
        XCTAssertEqual(RouteAnnouncerStrings.offline, "Offline")
    }

    // MARK: Accessibility label presence

    func testAccessibilityLabelsAreNonEmpty() {
        XCTAssertFalse(RouteAnnouncerStrings.emptyA11y.isEmpty)
        XCTAssertFalse(RouteAnnouncerStrings.loadingA11y.isEmpty)
        XCTAssertFalse(RouteAnnouncerStrings.staleA11y.isEmpty)
        XCTAssertFalse(RouteAnnouncerStrings.offlineA11y.isEmpty)
        XCTAssertFalse(RouteAnnouncerStrings.emptyMessage.isEmpty)
        XCTAssertFalse(RouteAnnouncerStrings.errorTitle.isEmpty)
    }
}
