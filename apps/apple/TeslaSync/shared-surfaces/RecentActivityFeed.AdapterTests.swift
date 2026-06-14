//
//  RecentActivityFeed.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  Pure-adapter coverage for the RecentActivityFeed surface:
//    • entityHref — the web routing (id routes, static routes, the nil guards, the `encodeURIComponent`
//      parity for the id segment).
//    • subtitle — the web `subtitleParts.join(' — ')` composition.
//    • relativeTime — the web `formatRelative` bucketing (boundaries + the future guard) and the
//      localized text (the `{{count}}` interpolation, the key resolution, the absolute fallback).
//    • row — the per-entry projection wiring (visual + route + subtitle + relative).
//
//  No network, no store — each assertion reads the pure adapter directly.
//

import XCTest
@testable import TeslaSync

// MARK: - entityHref (web routing)

final class RecentActivityFeedHrefTests: XCTestCase {
    func testIdRoutesEmbedEncodedId() {
        XCTAssertEqual(
            RecentActivityFeedAdapter.entityHref(entityType: "vehicle", entityID: "12"),
            "/vehicles/12"
        )
        XCTAssertEqual(
            RecentActivityFeedAdapter.entityHref(entityType: "drive", entityID: "88"),
            "/drives/88"
        )
        XCTAssertEqual(
            RecentActivityFeedAdapter.entityHref(entityType: "charging_session", entityID: "5"),
            "/charging/5"
        )
        XCTAssertEqual(
            RecentActivityFeedAdapter.entityHref(entityType: "charge", entityID: "5"),
            "/charging/5"
        )
    }

    func testStaticRoutesIgnoreId() {
        XCTAssertEqual(
            RecentActivityFeedAdapter.entityHref(entityType: "alert_rule", entityID: "9"),
            "/notifications/alerts"
        )
        XCTAssertEqual(RecentActivityFeedAdapter.entityHref(entityType: "automation", entityID: "9"), "/automations")
        XCTAssertEqual(RecentActivityFeedAdapter.entityHref(entityType: "geofence", entityID: "9"), "/geofences")
        XCTAssertEqual(RecentActivityFeedAdapter.entityHref(entityType: "export", entityID: "9"), "/data-export")
        XCTAssertEqual(RecentActivityFeedAdapter.entityHref(entityType: "data_export", entityID: "9"), "/data-export")
        XCTAssertEqual(RecentActivityFeedAdapter.entityHref(entityType: "api_key", entityID: "9"), "/api-keys")
    }

    func testNilWhenTypeOrIdMissingOrUnknown() {
        XCTAssertNil(RecentActivityFeedAdapter.entityHref(entityType: nil, entityID: "1"))
        XCTAssertNil(RecentActivityFeedAdapter.entityHref(entityType: "vehicle", entityID: nil))
        XCTAssertNil(RecentActivityFeedAdapter.entityHref(entityType: "", entityID: "1"))
        XCTAssertNil(RecentActivityFeedAdapter.entityHref(entityType: "vehicle", entityID: ""))
        XCTAssertNil(RecentActivityFeedAdapter.entityHref(entityType: "widget", entityID: "1"))
    }

    func testIdSegmentIsPercentEncoded() {
        let href = RecentActivityFeedAdapter.entityHref(entityType: "vehicle", entityID: "a b/c")
        XCTAssertEqual(href, "/vehicles/a%20b%2Fc")
    }
}

// MARK: - subtitle (web `subtitleParts.join(' — ')`)

final class RecentActivityFeedSubtitleTests: XCTestCase {
    func testTypeAndIdAndDetail() {
        let subtitle = RecentActivityFeedAdapter.subtitle(entityType: "vehicle", entityID: "12", detail: "woke")
        XCTAssertEqual(subtitle, "vehicle · 12 — woke")
    }

    func testTypeOnly() {
        XCTAssertEqual(
            RecentActivityFeedAdapter.subtitle(entityType: "vehicle", entityID: nil, detail: nil),
            "vehicle"
        )
    }

    func testDetailOnly() {
        XCTAssertEqual(
            RecentActivityFeedAdapter.subtitle(entityType: nil, entityID: nil, detail: "Changed units"),
            "Changed units"
        )
    }

    func testTypeAndDetailWithoutId() {
        XCTAssertEqual(
            RecentActivityFeedAdapter.subtitle(entityType: "settings", entityID: nil, detail: "Units"),
            "settings — Units"
        )
    }

    func testEmptyWhenNothingPresent() {
        XCTAssertEqual(RecentActivityFeedAdapter.subtitle(entityType: nil, entityID: nil, detail: nil), "")
        XCTAssertEqual(RecentActivityFeedAdapter.subtitle(entityType: "", entityID: "", detail: ""), "")
    }
}

// MARK: - relativeTime (web `formatRelative`)

final class RecentActivityFeedRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func bucket(secondsAgo: TimeInterval) -> RecentActivityFeedRelativeTime {
        RecentActivityFeedAdapter.relativeTime(of: now.addingTimeInterval(-secondsAgo), now: now)
    }

    func testJustNowUnderAMinute() {
        XCTAssertEqual(bucket(secondsAgo: 0), .justNow)
        XCTAssertEqual(bucket(secondsAgo: 59), .justNow)
    }

    func testMinutesBucket() {
        XCTAssertEqual(bucket(secondsAgo: 60), .minutes(1))
        XCTAssertEqual(bucket(secondsAgo: 59 * 60), .minutes(59))
    }

    func testHoursBucket() {
        XCTAssertEqual(bucket(secondsAgo: 3600), .hours(1))
        XCTAssertEqual(bucket(secondsAgo: 23 * 3600), .hours(23))
    }

    func testDaysBucket() {
        XCTAssertEqual(bucket(secondsAgo: 86400), .days(1))
        XCTAssertEqual(bucket(secondsAgo: 6 * 86400), .days(6))
    }

    func testAbsoluteAtSevenDays() {
        let reference = now.addingTimeInterval(-7 * 86400)
        XCTAssertEqual(bucket(secondsAgo: 7 * 86400), .absolute(reference))
    }

    func testFutureTimestampIsJustNow() {
        XCTAssertEqual(bucket(secondsAgo: -120), .justNow)
    }

    func testTextInterpolatesCountWithIdentityResolver() {
        let resolver: RecentActivityFeedResolve = { _, fallback in fallback }
        XCTAssertEqual(RecentActivityFeedRelativeTime.justNow.text(resolver: resolver), "just now")
        XCTAssertEqual(RecentActivityFeedRelativeTime.minutes(5).text(resolver: resolver), "5m ago")
        XCTAssertEqual(RecentActivityFeedRelativeTime.hours(3).text(resolver: resolver), "3h ago")
        XCTAssertEqual(RecentActivityFeedRelativeTime.days(2).text(resolver: resolver), "2d ago")
    }

    func testTextResolvesKeysThroughFacade() {
        let resolver: RecentActivityFeedResolve = { key, _ in key }
        XCTAssertEqual(
            RecentActivityFeedRelativeTime.justNow.text(resolver: resolver),
            RecentActivityFeedRelativeKeys.justNow
        )
    }

    func testAbsoluteTextIsNonEmpty() {
        let resolver: RecentActivityFeedResolve = { _, fallback in fallback }
        let text = RecentActivityFeedRelativeTime.absolute(now).text(
            resolver: resolver,
            locale: Locale(identifier: "en_US")
        )
        XCTAssertFalse(text.isEmpty)
    }
}

// MARK: - row projection

final class RecentActivityFeedRowProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testRowWiresVisualRouteSubtitleAndRelative() {
        let entry = RecentActivityFeedEntry(
            id: 7,
            timestamp: now.addingTimeInterval(-90),
            action: "vehicle.command.lock",
            entityType: "vehicle",
            entityID: "12",
            detail: "Locked"
        )
        let row = RecentActivityFeedAdapter.row(for: entry, now: now)
        XCTAssertEqual(row.id, 7)
        XCTAssertEqual(row.titleKey, "activity.action.vehicleCommandLock")
        XCTAssertEqual(row.tone, .success)
        XCTAssertEqual(row.destination, "/vehicles/12")
        XCTAssertEqual(row.subtitle, "vehicle · 12 — Locked")
        XCTAssertEqual(row.relative, .minutes(1))
    }

    func testRowWithoutEntityHasNoDestination() {
        let entry = RecentActivityFeedEntry(id: 1, timestamp: now, action: "auth.login")
        let row = RecentActivityFeedAdapter.row(for: entry, now: now)
        XCTAssertNil(row.destination)
        XCTAssertEqual(row.subtitle, "")
    }

    func testRowsPreserveOrder() {
        let entries = (1 ... 3).map {
            RecentActivityFeedEntry(id: Int64($0), timestamp: now, action: "auth.login")
        }
        XCTAssertEqual(RecentActivityFeedAdapter.rows(for: entries, now: now).map(\.id), [1, 2, 3])
    }
}
