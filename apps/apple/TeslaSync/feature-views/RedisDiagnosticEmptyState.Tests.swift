//
//  RedisDiagnosticEmptyState.Tests.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  Unit coverage for the RedisDiagnosticEmptyState surface:
//    • Projection — the nine-branch ladder (error precedence, mode-local, mirror-broken,
//      no-telemetry stale/absent, TTL boundary, fallthrough, legacy fallback) + the
//      "other vehicles" key filtering + the interpolating bodies.
//    • Adapter — chip-name fallback, timestamp formatter, docs-URL resolution, the
//      catalog copy keys.
//    • State holder — chips-phase resolution + the RedisDiagnosticModel wiring and the
//      P1/S11 view.opened telemetry.
//    • Accessibility — the banner + chip VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by InMemoryRedisDiagnosticSource.
//

import XCTest
@testable import TeslaSync

/// Localizer that returns the English fallback, so resolution tests are locale-independent.
private let fallbackLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Projection: the nine-branch ladder

@MainActor final class RedisDiagnosticProjectionTests: XCTestCase {
    private func resolve(
        meta: RedisDiagnosticSignalsMeta? = nil,
        serverError: RedisApiError? = nil,
        networkError: Bool = false,
        now: Date = Date()
    ) -> RedisDiagnosticResolved {
        RedisDiagnosticProjection.resolve(
            meta: meta, serverError: serverError, networkError: networkError, now: now
        )
    }

    private func meta(
        mode: RedisLiveStoreMode = .hybrid,
        l1: Int = 0,
        l2: Int = 0,
        l1LastSeen: Date? = nil
    ) -> RedisDiagnosticSignalsMeta {
        RedisDiagnosticSignalsMeta(
            liveSignalStoreMode: mode,
            redisKey: "vehicle:7:signals",
            redisFieldCount: l2,
            l1SignalCount: l1,
            vehicleVin: "TESLA1234567890",
            l1LastSeenAt: l1LastSeen
        )
    }

    func testCacheNotWired503NotAvailable() {
        let resolved = resolve(serverError: RedisApiError(status: 503, message: "Redis signal cache is not available"))
        XCTAssertEqual(resolved.kind, .cacheNotWired)
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertTrue(resolved.isError)
        XCTAssertEqual(resolved.cta?.path, "/docs/caching#configuration")
    }

    func testUnreachable503Unreachable() {
        let resolved = resolve(serverError: RedisApiError(status: 503, message: "Redis is unreachable"))
        XCTAssertEqual(resolved.kind, .unreachable)
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertNil(resolved.cta)
    }

    func testUnreachable502Upstream() {
        let resolved = resolve(serverError: RedisApiError(status: 502, message: "upstream connect timeout"))
        XCTAssertEqual(resolved.kind, .unreachable)
    }

    func testGeneric500IsRequestFailedWithInterpolatedBody() {
        let resolved = resolve(serverError: RedisApiError(status: 500, message: "database query failed"))
        XCTAssertEqual(resolved.kind, .requestFailed)
        XCTAssertEqual(resolved.tone, .warning)
        let body = resolved.body.resolved(fallbackLocalize)
        XCTAssertTrue(body.contains("500"))
        XCTAssertTrue(body.contains("database query failed"))
        XCTAssertFalse(body.contains("{{"))
    }

    func test502NotAvailableFallsToRequestFailed() {
        // cacheNotWired requires 503; "not available" does not match unreachable/upstream.
        let resolved = resolve(serverError: RedisApiError(status: 502, message: "service not available"))
        XCTAssertEqual(resolved.kind, .requestFailed)
    }

    func testNetworkError() {
        let resolved = resolve(networkError: true)
        XCTAssertEqual(resolved.kind, .networkError)
        XCTAssertEqual(resolved.tone, .warning)
        XCTAssertTrue(resolved.isError)
    }

    func testErrorTakesPrecedenceOverMeta() {
        let resolved = resolve(
            meta: meta(l1: 99, l2: 0),
            serverError: RedisApiError(status: 503, message: "Redis signal cache is not available")
        )
        XCTAssertEqual(resolved.kind, .cacheNotWired)
        // Meta is still present, so the meta list renders even in the error branch.
        XCTAssertTrue(resolved.showsMeta)
    }

    func testNoMetaLegacyFallback() {
        let resolved = resolve()
        XCTAssertEqual(resolved.kind, .legacyEmpty)
        XCTAssertFalse(resolved.showsMeta)
        XCTAssertEqual(resolved.title.resolved(fallbackLocalize), "No signals cached for this vehicle")
    }

    func testModeLocal() {
        let resolved = resolve(meta: meta(mode: .local))
        XCTAssertEqual(resolved.kind, .modeLocal)
        XCTAssertEqual(resolved.tone, .danger)
        XCTAssertEqual(resolved.cta?.path, "/docs/caching")
        XCTAssertFalse(resolved.showsOtherKeys)
    }

    func testMirrorBrokenInterpolatesCount() {
        let resolved = resolve(meta: meta(l1: 42, l2: 0, l1LastSeen: Date()))
        XCTAssertEqual(resolved.kind, .mirrorBroken)
        XCTAssertEqual(resolved.tone, .warning)
        XCTAssertTrue(resolved.showsOtherKeys)
        XCTAssertTrue(resolved.body.resolved(fallbackLocalize).contains("42 signals"))
    }

    func testNoTelemetryStaleWhenLastSeenOlderThan7Days() {
        let tenDaysAgo = Date().addingTimeInterval(-10 * 86400)
        let resolved = resolve(meta: meta(l1: 0, l2: 0, l1LastSeen: tenDaysAgo))
        XCTAssertEqual(resolved.kind, .noTelemetry)
        XCTAssertEqual(resolved.tone, .info)
        XCTAssertEqual(resolved.body.key, "redis.diagnostic.noTelemetry.bodyStale")
        XCTAssertTrue(resolved.body.resolved(fallbackLocalize).contains("7-day Redis TTL"))
    }

    func testNoTelemetryAbsentWhenLastSeenNil() {
        let resolved = resolve(meta: meta(l1: 0, l2: 0, l1LastSeen: nil))
        XCTAssertEqual(resolved.kind, .noTelemetry)
        XCTAssertEqual(resolved.body.key, "redis.diagnostic.noTelemetry.bodyAbsent")
    }

    func testFallthroughWhenBothEmptyButRecentAbsence() {
        let oneHourAgo = Date().addingTimeInterval(-3600)
        let resolved = resolve(meta: meta(l1: 0, l2: 0, l1LastSeen: oneHourAgo))
        XCTAssertEqual(resolved.kind, .fallthroughEmpty)
        XCTAssertEqual(resolved.tone, .neutral)
        XCTAssertTrue(resolved.showsOtherKeys)
    }

    func testTTLBoundaryDeterministic() {
        let now = Date(timeIntervalSince1970: 1_000_000_000)
        let sixDays = now.addingTimeInterval(-6 * 86400)
        let eightDays = now.addingTimeInterval(-8 * 86400)
        XCTAssertEqual(resolve(meta: meta(l1: 0, l1LastSeen: sixDays), now: now).kind, .fallthroughEmpty)
        XCTAssertEqual(resolve(meta: meta(l1: 0, l1LastSeen: eightDays), now: now).kind, .noTelemetry)
    }

    func testMirrorBrokenBeatsNoTelemetryViaL1Count() {
        // l1 > 0 routes to mirror-broken (when l2 == 0), never no-telemetry.
        let resolved = resolve(meta: meta(l1: 5, l2: 0, l1LastSeen: nil))
        XCTAssertEqual(resolved.kind, .mirrorBroken)
    }
}

// MARK: - Other-vehicle key filtering (web `filter(id !== self && field_count > 0)`)

@MainActor final class RedisDiagnosticOtherKeysTests: XCTestCase {
    func testFiltersSelfAndZeroFieldCounts() {
        let keys = [
            RedisSignalKeyEntry(vehicleId: 1, fieldCount: 230, displayName: "Falcon"),
            RedisSignalKeyEntry(vehicleId: 7, fieldCount: 0),
            RedisSignalKeyEntry(vehicleId: 9, fieldCount: 0),
            RedisSignalKeyEntry(vehicleId: 12, fieldCount: 142, displayName: "Phoenix")
        ]
        let filtered = RedisDiagnosticProjection.otherKeys(keys, excluding: 7)
        XCTAssertEqual(filtered.map(\.vehicleId), [1, 12])
    }
}

// MARK: - Chips-phase resolution (model seam)

@MainActor final class RedisDiagnosticChipsPhaseTests: XCTestCase {
    private let metaFallthrough = RedisDiagnosticSignalsMeta(
        liveSignalStoreMode: .hybrid, redisKey: "k", redisFieldCount: 0, l1SignalCount: 0, vehicleVin: ""
    )

    private func branch(showsOtherKeys: Bool) -> RedisDiagnosticResolved {
        showsOtherKeys
            ? RedisDiagnosticProjection.resolve(meta: metaFallthrough, serverError: nil, networkError: false)
            : RedisDiagnosticProjection.resolve(
                meta: nil,
                serverError: RedisApiError(status: 500, message: "x"),
                networkError: false
            )
    }

    func testHiddenWhenBranchOmitsOtherKeys() {
        let phase = RedisDiagnosticModel.chipsPhase(
            for: branch(showsOtherKeys: false), keys: .loaded([]), vehicleId: 7
        )
        XCTAssertEqual(phase, .hidden)
    }

    func testLoadingPhase() {
        let phase = RedisDiagnosticModel.chipsPhase(for: branch(showsOtherKeys: true), keys: .loading, vehicleId: 7)
        XCTAssertEqual(phase, .loading)
    }

    func testFailedKeysHideSection() {
        let phase = RedisDiagnosticModel.chipsPhase(for: branch(showsOtherKeys: true), keys: .failed, vehicleId: 7)
        XCTAssertEqual(phase, .hidden)
    }

    func testLoadedButEmptyAfterFilterIsHidden() {
        let keys = RedisDiagnosticKeysState.loaded([RedisSignalKeyEntry(vehicleId: 7, fieldCount: 0)])
        let phase = RedisDiagnosticModel.chipsPhase(for: branch(showsOtherKeys: true), keys: keys, vehicleId: 7)
        XCTAssertEqual(phase, .hidden)
    }

    func testLoadedChips() {
        let entries = [RedisSignalKeyEntry(vehicleId: 1, fieldCount: 99, displayName: "Falcon")]
        let phase = RedisDiagnosticModel.chipsPhase(
            for: branch(showsOtherKeys: true),
            keys: .loaded(entries),
            vehicleId: 7
        )
        XCTAssertEqual(phase, .chips(entries))
    }
}

// MARK: - Adapter helpers: chip name / format / docs URL / interpolation

@MainActor final class RedisDiagnosticAdapterTests: XCTestCase {
    func testChipNamePrefersDisplayNameThenVINThenFallback() {
        let named = RedisSignalKeyEntry(vehicleId: 3, fieldCount: 1, vehicleVin: "VINX", displayName: "Falcon")
        XCTAssertEqual(RedisDiagnosticCopy.chipName(for: named, localize: fallbackLocalize), "Falcon")
        let vinOnly = RedisSignalKeyEntry(vehicleId: 3, fieldCount: 1, vehicleVin: "VINX", displayName: "")
        XCTAssertEqual(RedisDiagnosticCopy.chipName(for: vinOnly, localize: fallbackLocalize), "VINX")
        let bare = RedisSignalKeyEntry(vehicleId: 3, fieldCount: 1)
        XCTAssertEqual(RedisDiagnosticCopy.chipName(for: bare, localize: fallbackLocalize), "Vehicle 3")
    }

    func testDateTimeFormatting() {
        XCTAssertEqual(RedisDiagnosticFormat.dateTime(nil), "—")
        let locale = Locale(identifier: "en_US_POSIX")
        let utc = TimeZone(identifier: "UTC") ?? .current
        let date = ISO8601DateFormatter().date(from: "2026-01-05T15:04:05Z")
        let out = RedisDiagnosticFormat.dateTime(date, locale: locale, timeZone: utc)
        XCTAssertNotEqual(out, "—")
        XCTAssertTrue(out.contains("2026"))
    }

    func testDocsURLResolvesAgainstBase() {
        let url = RedisDiagnosticDocs.url(forPath: "/docs/caching#configuration")
        XCTAssertEqual(url?.absoluteString, "https://teslasync.local/docs/caching#configuration")
    }

    func testInterpolateReplacesNamedTokens() {
        let out = RDInterpolate.apply("a {{x}} b {{y}}", ["x": "1", "y": "2"])
        XCTAssertEqual(out, "a 1 b 2")
        XCTAssertEqual(RDInterpolate.apply("no tokens", [:]), "no tokens")
    }

    func testCatalogCopyKeysResolveNonEmpty() {
        let texts: [RDText] = [
            RedisDiagnosticCopy.cacheNotWiredTitle, RedisDiagnosticCopy.cacheNotWiredBody,
            RedisDiagnosticCopy.unreachableTitle, RedisDiagnosticCopy.unreachableBody,
            RedisDiagnosticCopy.requestFailedTitle, RedisDiagnosticCopy.networkErrorTitle,
            RedisDiagnosticCopy.networkErrorBody, RedisDiagnosticCopy.legacyEmptyMessage,
            RedisDiagnosticCopy.modeLocalTitle, RedisDiagnosticCopy.modeLocalBody,
            RedisDiagnosticCopy.mirrorBrokenTitle, RedisDiagnosticCopy.noTelemetryTitle,
            RedisDiagnosticCopy.noTelemetryAbsentBody, RedisDiagnosticCopy.fallthroughTitle,
            RedisDiagnosticCopy.fallthroughBody, RedisDiagnosticCopy.otherVehicles,
            RedisDiagnosticCopy.metaMode, RedisDiagnosticCopy.metaKey, RedisDiagnosticCopy.metaL1Count,
            RedisDiagnosticCopy.metaL2Count, RedisDiagnosticCopy.metaL1LastSeen,
            RedisDiagnosticCopy.metaL2LastSeen, RedisDiagnosticCopy.metaVin, RedisDiagnosticCopy.retry
        ]
        for text in texts {
            XCTAssertFalse(text.key.isEmpty)
            XCTAssertFalse(text.resolved(fallbackLocalize).isEmpty)
        }
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class RedisDiagnosticModelTests: XCTestCase {
    private func makeModel(
        _ input: RedisDiagnosticInput,
        telemetry: RedisDiagnosticTelemetry = OSLogRedisDiagnosticTelemetry()
    ) -> (RedisDiagnosticModel, InMemoryRedisDiagnosticSource) {
        let source = InMemoryRedisDiagnosticSource(initial: input)
        let model = RedisDiagnosticModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRedisDiagnosticTelemetry()
        let meta = RedisDiagnosticSignalsMeta(
            liveSignalStoreMode: .local, redisKey: "k", redisFieldCount: 0, l1SignalCount: 0, vehicleVin: ""
        )
        let (model, source) = makeModel(RedisDiagnosticInput(vehicleId: 7, meta: meta), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.resolved.kind, .modeLocal)
        XCTAssertEqual(spy.surfaces, [RedisDiagnosticEmptyState.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesResolvedAndChips() {
        let (model, source) = makeModel(RedisDiagnosticInput(vehicleId: 7, networkError: true))
        model.start()
        XCTAssertEqual(model.resolved.kind, .networkError)
        XCTAssertEqual(model.chips, .hidden)

        let meta = RedisDiagnosticSignalsMeta(
            liveSignalStoreMode: .hybrid, redisKey: "k", redisFieldCount: 0, l1SignalCount: 0, vehicleVin: ""
        )
        let entries = [RedisSignalKeyEntry(vehicleId: 1, fieldCount: 12, displayName: "Falcon")]
        source.push(RedisDiagnosticInput(vehicleId: 7, meta: meta, keys: .loaded(entries)))
        XCTAssertEqual(model.resolved.kind, .noTelemetry)
        XCTAssertEqual(model.chips, .chips(entries))
        XCTAssertEqual(model.meta, meta)
    }

    func testRefreshAndSelectVehicleDelegateToSource() {
        let (model, source) = makeModel(RedisDiagnosticInput(vehicleId: 7))
        model.start()
        model.refresh()
        model.refresh()
        model.selectVehicle(12)
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.selectedVehicles, [12])
    }
}

// MARK: - Accessibility summary content

@MainActor final class RedisDiagnosticAccessibilityTests: XCTestCase {
    func testBannerSummaryCombinesTitleAndBody() {
        let summary = RedisDiagnosticAccessibility.bannerSummary(title: "Redis is unreachable", body: "Check the pod.")
        XCTAssertEqual(summary, "Redis is unreachable. Check the pod.")
    }

    func testChipSummaryIncludesNameAndCount() {
        let summary = RedisDiagnosticAccessibility.chipSummary(
            name: "Falcon",
            fieldCount: 5,
            localize: fallbackLocalize
        )
        XCTAssertTrue(summary.contains("Falcon"))
        XCTAssertTrue(summary.contains("5 cached fields"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRedisDiagnosticTelemetry: RedisDiagnosticTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
