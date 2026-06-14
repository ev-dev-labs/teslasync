//
//  ConnectionSegment.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  Pure-core coverage for the footer API-connection segment: the latency bucketing (web `bucket`), the
//  snapshot factory (web `useApiHealth` `data` → return), and the projection across every status + the
//  freshness branch — the tone / glyph map, the "API" label, the latency / "Offline" / "Stale" suffix gate,
//  the tooltip + aria composition, and the route. No SwiftUI, no store, no bundle, no real time (the
//  relative `now` + the string facade are injected), so every web render branch is asserted deterministically.
//

import XCTest

private let englishStrings: ConnectionSegmentResolve = { _, fallback in fallback }
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

// MARK: - Latency bucketing (web `bucket(result)`)

final class ConnectionHealthBucketTests: XCTestCase {
    func testFastSuccessIsOnline() {
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: true, latencyMs: 42), .online)
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: true, latencyMs: 499), .online)
    }

    func testSlowSuccessIsDegradedAtThreshold() {
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: true, latencyMs: 500), .degraded)
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: true, latencyMs: 1800), .degraded)
    }

    func testFailureIsOfflineRegardlessOfLatency() {
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: false, latencyMs: 10), .offline)
        XCTAssertEqual(ConnectionHealthBucket.classify(ok: false, latencyMs: 5000), .offline)
    }
}

// MARK: - Snapshot factory (web `useApiHealth` return)

final class ConnectionSegmentSnapshotTests: XCTestCase {
    func testInitialIsConnectingWithNoReading() {
        let snapshot = ConnectionSegmentSnapshot.initial
        XCTAssertEqual(snapshot.status, .connecting)
        XCTAssertNil(snapshot.latencyMs)
        XCTAssertNil(snapshot.lastCheckedAt)
    }

    func testMakeFromSuccessfulProbeBucketsAndCarriesReading() {
        let result = ConnectionProbeResult(ok: true, latencyMs: 120, checkedAt: fixedNow)
        let snapshot = ConnectionSegmentSnapshot.make(from: result)
        XCTAssertEqual(snapshot.status, .online)
        XCTAssertEqual(snapshot.latencyMs, 120)
        XCTAssertEqual(snapshot.lastCheckedAt, fixedNow)
    }

    func testMakeFromFailedProbeIsOffline() {
        let result = ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow)
        let snapshot = ConnectionSegmentSnapshot.make(from: result)
        XCTAssertEqual(snapshot.status, .offline)
        XCTAssertEqual(snapshot.latencyMs, 5000)
    }
}

// MARK: - Projection (web `cfg[status]` + suffix / tooltip / aria)

final class ConnectionSegmentProjectionTests: XCTestCase {
    private func resolve(
        _ snapshot: ConnectionSegmentSnapshot,
        iconOnly: Bool = false,
        now: Date = fixedNow
    ) -> ConnectionSegmentResolved {
        ConnectionSegmentProjection.resolve(snapshot: snapshot, iconOnly: iconOnly, now: now, strings: englishStrings)
    }

    func testOnlineFreshShowsLatencyAndEmeraldGlyph() {
        let resolved = resolve(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))
        XCTAssertEqual(resolved.tone, .success)
        XCTAssertEqual(resolved.icon, .activity)
        XCTAssertEqual(resolved.freshness, .fresh)
        XCTAssertEqual(resolved.shortLabel, "API")
        XCTAssertEqual(resolved.suffix, "42ms")
        XCTAssertEqual(resolved.tooltip, "API connection · Online · 42ms")
        XCTAssertEqual(resolved.accessibilityLabel, "API connection status: Online (42ms)")
        XCTAssertEqual(resolved.route, "/system-status")
    }

    func testDegradedShowsLatencyAndAmberGlyph() {
        let resolved = resolve(ConnectionSegmentSnapshot(status: .degraded, latencyMs: 820, lastCheckedAt: fixedNow))
        XCTAssertEqual(resolved.tone, .warning)
        XCTAssertEqual(resolved.icon, .warning)
        XCTAssertEqual(resolved.suffix, "820ms")
        XCTAssertEqual(resolved.tooltip, "API connection · Degraded · 820ms")
        XCTAssertEqual(resolved.accessibilityLabel, "API connection status: Degraded (820ms)")
    }

    func testOfflineOmitsLatencyAndUsesOfflineLabel() {
        let resolved = resolve(ConnectionSegmentSnapshot(status: .offline, latencyMs: 5000, lastCheckedAt: fixedNow))
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertEqual(resolved.icon, .slash)
        XCTAssertEqual(resolved.suffix, "Offline")
        XCTAssertEqual(resolved.tooltip, "API connection · Offline")
        XCTAssertEqual(resolved.accessibilityLabel, "API connection status: Offline")
    }

    func testConnectingShowsNoSuffixAndMutedGlyph() {
        let resolved = resolve(.initial)
        XCTAssertEqual(resolved.tone, .muted)
        XCTAssertEqual(resolved.icon, .help)
        XCTAssertNil(resolved.suffix)
        XCTAssertEqual(resolved.tooltip, "API connection · Connecting…")
        XCTAssertEqual(resolved.accessibilityLabel, "API connection status: Connecting…")
    }

    func testStaleHealthyReadingDimsAndSwapsLatencyForStaleMarker() {
        let aged = fixedNow.addingTimeInterval(-(ConnectionSegmentSurface.stalenessWindowSeconds + 5))
        let resolved = resolve(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: aged))
        XCTAssertEqual(resolved.freshness, .stale)
        XCTAssertEqual(resolved.tone, .muted)
        XCTAssertEqual(resolved.suffix, "Stale")
        XCTAssertEqual(resolved.tooltip, "API connection · Online · Stale")
        XCTAssertEqual(resolved.accessibilityLabel, "API connection status: Online (Stale)")
    }

    func testFreshReadingWithinWindowIsNotStale() {
        let recent = fixedNow.addingTimeInterval(-(ConnectionSegmentSurface.stalenessWindowSeconds - 5))
        let resolved = resolve(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: recent))
        XCTAssertEqual(resolved.freshness, .fresh)
        XCTAssertEqual(resolved.suffix, "42ms")
    }

    func testOfflineNeverReportsStaleEvenWhenAged() {
        let aged = fixedNow.addingTimeInterval(-3600)
        let resolved = resolve(ConnectionSegmentSnapshot(status: .offline, latencyMs: 5000, lastCheckedAt: aged))
        XCTAssertEqual(resolved.freshness, .fresh)
        XCTAssertEqual(resolved.suffix, "Offline")
    }

    func testIconOnlyHidesLabel() {
        let resolved = resolve(
            ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow),
            iconOnly: true
        )
        XCTAssertFalse(resolved.showsLabel)
    }

    func testExpandedShowsLabel() {
        let resolved = resolve(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))
        XCTAssertTrue(resolved.showsLabel)
    }
}

// MARK: - Accessibility (every status yields a non-empty VoiceOver label)

final class ConnectionSegmentAccessibilityTests: XCTestCase {
    func testEveryStatusHasNonEmptyLabelContainingStateLabel() {
        let cases: [(ConnectionHealthStatus, String)] = [
            (.online, "Online"), (.degraded, "Degraded"), (.offline, "Offline"), (.connecting, "Connecting…")
        ]
        for (status, stateLabel) in cases {
            let resolved = ConnectionSegmentProjection.resolve(
                snapshot: ConnectionSegmentSnapshot(status: status, latencyMs: 50, lastCheckedAt: fixedNow),
                now: fixedNow,
                strings: englishStrings
            )
            XCTAssertFalse(resolved.accessibilityLabel.isEmpty, "missing a11y label for \(status)")
            XCTAssertTrue(
                resolved.accessibilityLabel.contains(stateLabel),
                "a11y label for \(status) missing state label"
            )
        }
    }
}

@testable import TeslaSync
