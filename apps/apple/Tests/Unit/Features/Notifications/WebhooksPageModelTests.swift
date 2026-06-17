import XCTest
@testable import TeslaSync

/// Binding + wiring tests for `WebhooksPageModel` — the two web i18n keys the page renders, the
/// copy-link share URL (web `copyLink`), the hosted `WebhookChannelsSection` populating from the
/// sample seed, the route registration, and the `/notifications/webhooks` deep-link parse (with a
/// no-regression check that `/notifications` + `/notifications/audit` still resolve).
@MainActor final class WebhooksPageModelTests: XCTestCase {
    // MARK: - Parity strings (web notifications.webhooks.title / .subtitle)

    func testTitleAndSubtitleKeysMatchWeb() {
        let model = WebhooksPageModel()
        XCTAssertEqual(model.titleKey, LocalizedStringKey("notifications.webhooks.title"))
        XCTAssertEqual(model.subtitleKey, LocalizedStringKey("notifications.webhooks.subtitle"))
    }

    // MARK: - Copy-link share URL (web copyLink → window.location.href)

    func testShareURLIsCanonicalRoutePath() {
        let model = WebhooksPageModel()
        XCTAssertEqual(model.shareURL, "/notifications/webhooks")
    }

    // MARK: - Hosted WebhookChannelsSection

    func testSectionPopulatesFromSampleSeedOnStart() {
        let model = WebhooksPageModel()
        model.section.start()
        XCTAssertEqual(model.section.channels.count, 3)
        // Web sorts by name (localeCompare, case-insensitive): Discord < Home Assistant < n8n.
        XCTAssertEqual(model.section.channels.first?.name, "Discord #alerts")
    }

    func testSampleSourceFactorySeedsThreeChannels() {
        let model = WebhooksPageModel(source: SampleWebhookChannelsSource.makeSource())
        model.section.start()
        XCTAssertEqual(model.section.channels.count, 3)
    }

    func testEmptySourceYieldsNoChannels() {
        let empty = InMemoryWebhookChannelsSource(
            initial: WebhookChannelsUpdate(status: .loaded, channels: [], connection: .live)
        )
        let model = WebhooksPageModel(source: empty)
        model.section.start()
        XCTAssertTrue(model.section.channels.isEmpty)
    }

    // MARK: - Route registration + deep-link parsing

    func testRouteRegistrationHostsNotificationsWebhooks() {
        let registry = WebhooksRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.notificationsWebhooks))
        XCTAssertNotNil(registry.view(for: .notificationsWebhooks))
    }

    func testDeepLinkResolvesToNotificationsWebhooks() {
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/webhooks"), .notificationsWebhooks)
        XCTAssertEqual(AppRoute.notificationsWebhooks.path, "/notifications/webhooks")
        XCTAssertEqual(AppRoute.notificationsWebhooks.group, .operations)
    }

    func testSiblingNotificationRoutesStillResolve() {
        // No regression: the base + audit notification routes keep their existing resolution.
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications"), .notifications)
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/audit"), .notificationsAudit)
    }

    func testRoutePathSegmentsRemainUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, segments.count, "every route path segment is unique")
    }
}
