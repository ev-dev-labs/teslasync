import SwiftUI
import XCTest
@testable import TeslaSync

/// Binding + wiring tests for `ArchivedPageModel` — the three web i18n keys the page renders, the
/// copy-link share URL (web `copyLink`), the hosted `InboxBody` fixed to the archived tab and
/// populating from the sample seed (rows + the `useVehicles`/`useAlertRules` context), the
/// back-to-inbox target, the route registration, and the `/notifications/archived` deep-link
/// parse (with a no-regression check that the sibling notification routes still resolve).
@MainActor final class ArchivedPageModelTests: XCTestCase {
    // MARK: - Parity strings (web notifications.archived.title / .subtitle / .backToInbox)

    func testStringKeysMatchWeb() {
        let model = ArchivedPageModel()
        XCTAssertEqual(model.titleKey, LocalizedStringKey("notifications.archived.title"))
        XCTAssertEqual(model.subtitleKey, LocalizedStringKey("notifications.archived.subtitle"))
        XCTAssertEqual(model.backToInboxKey, LocalizedStringKey("notifications.archived.backToInbox"))
    }

    // MARK: - Copy-link share URL (web copyLink → window.location.href)

    func testShareURLIsCanonicalRoutePath() {
        let model = ArchivedPageModel()
        XCTAssertEqual(model.shareURL, "/notifications/archived")
    }

    // MARK: - Hosted InboxBody fixed to the archived tab

    func testInboxIsFixedToArchivedTab() {
        let model = ArchivedPageModel()
        XCTAssertTrue(model.inbox.filters.archived, "web <InboxBody archived={true}/>")
        // Archived view is always row-by-row (web `isGrouped = view === 'grouped' && !archived`).
        XCTAssertFalse(model.inbox.isGrouped)
    }

    func testSampleSeedPopulatesArchivedRowsAndContext() {
        let model = ArchivedPageModel()
        model.inbox.start()
        XCTAssertEqual(model.inbox.rows.count, 3)
        XCTAssertTrue(model.inbox.rows.allSatisfy(\.isArchived), "every seeded row carries archived_at")
        XCTAssertEqual(model.inbox.listPhase, .content)
        // Web `useVehicles` + `useAlertRules` reach the inbox through the source snapshot.
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.rules.count, 3)
    }

    func testEmptySourceYieldsEmptyPhase() {
        let model = ArchivedPageModel(
            source: InMemoryInboxSource(
                initial: InboxUpdate(flatStatus: .empty, groupStatus: .empty, updatedAt: Date())
            )
        )
        model.inbox.start()
        XCTAssertEqual(model.inbox.listPhase, .empty)
        XCTAssertTrue(model.vehicles.isEmpty)
    }

    func testFailedSourceYieldsErrorPhase() {
        let model = ArchivedPageModel(
            source: InMemoryInboxSource(
                initial: InboxUpdate(flatStatus: .failed("boom"), groupStatus: .failed("boom"))
            )
        )
        model.inbox.start()
        XCTAssertEqual(model.inbox.listPhase, .error("boom"))
    }

    // MARK: - Back-to-inbox target (web <Link to="/notifications/inbox">)

    func testBackToInboxTargetsNotificationsHub() {
        let model = ArchivedPageModel()
        // Web links to /notifications/inbox; /notifications redirects there.
        XCTAssertEqual(model.backToInboxRoute, .notifications)
    }

    // MARK: - Route registration + deep-link parsing

    func testRouteRegistrationHostsNotificationsArchived() {
        let registry = ArchivedRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.notificationsArchived))
        XCTAssertNotNil(registry.view(for: .notificationsArchived))
    }

    func testDeepLinkResolvesToNotificationsArchived() {
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/archived"), .notificationsArchived)
        XCTAssertEqual(AppRoute.notificationsArchived.path, "/notifications/archived")
        XCTAssertEqual(AppRoute.notificationsArchived.group, .operations)
    }

    func testSiblingNotificationRoutesStillResolve() {
        // No regression: the base + audit + webhooks notification routes keep their resolution,
        // and the inbox deep link resolves to the notifications hub.
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications"), .notifications)
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/audit"), .notificationsAudit)
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/webhooks"), .notificationsWebhooks)
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/inbox"), .notifications)
    }

    func testRoutePathSegmentsRemainUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, segments.count, "every route path segment is unique")
    }
}
