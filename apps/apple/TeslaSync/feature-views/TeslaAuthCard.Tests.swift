//
//  TeslaAuthCard.Tests.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  Surface-level unit coverage:
//    • Projection — every render branch (loading / error / empty / data) across every severity, the
//      detail copy, the badge + CTA labels, and the VoiceOver summary, driven through the public
//      `resolve(_:locale:)` exactly as the view consumes it.
//    • State holder — the `TeslaAuthModel` wiring, the P1/S11 `view.opened` telemetry, the connection
//      tracking, and the one-shot stale auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryTeslaAuthSource`, and the clock + locale are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

private func iso(daysFromNow days: Double) -> String {
    let date = fixedNow.addingTimeInterval(days * 24 * 60 * 60)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

private func presentation(_ resolved: TeslaAuthResolved) -> TeslaAuthPresentation? {
    switch resolved.phase {
    case let .data(value), let .empty(value):
        value
    default:
        nil
    }
}

// MARK: - Projection phases

@MainActor final class TeslaAuthProjectionPhaseTests: XCTestCase {
    func testLoadingOnlyWhenNothingResolved() {
        XCTAssertEqual(
            TeslaAuthProjection.resolve(TeslaAuthInput(isLoading: true), locale: enUS).phase,
            .loading
        )
    }

    func testBackgroundRefreshWithKnownAuthIsNotLoading() {
        let resolved = TeslaAuthProjection.resolve(
            TeslaAuthInput(authenticated: true, expiresAtRaw: iso(daysFromNow: 42), now: fixedNow, isLoading: true),
            locale: enUS
        )
        XCTAssertEqual(presentation(resolved)?.severity, .ok)
    }

    func testExplicitErrorMessageTakesPrecedence() {
        let resolved = TeslaAuthProjection.resolve(
            TeslaAuthInput(authenticated: true, now: fixedNow, errorMessage: "boom"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testUnknownSeverityResolvesToEmptyPhase() {
        let resolved = TeslaAuthProjection.resolve(
            TeslaAuthInput(authenticated: true, now: fixedNow),
            locale: enUS
        )
        guard case .empty = resolved.phase else {
            return XCTFail("expected empty phase for unknown severity")
        }
        XCTAssertEqual(presentation(resolved)?.severity, .unknown)
    }

    func testConcreteSeverityResolvesToDataPhase() {
        let resolved = TeslaAuthProjection.resolve(
            TeslaAuthInput(authenticated: true, expiresAtRaw: iso(daysFromNow: 42), now: fixedNow),
            locale: enUS
        )
        guard case .data = resolved.phase else {
            return XCTFail("expected data phase for a concrete severity")
        }
    }
}

// MARK: - Projection content (web TONE + detail + CTA)

@MainActor final class TeslaAuthProjectionContentTests: XCTestCase {
    private func resolvePresentation(_ input: TeslaAuthInput) -> TeslaAuthPresentation? {
        presentation(TeslaAuthProjection.resolve(input, locale: enUS))
    }

    func testConnected() {
        let view = resolvePresentation(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: 42),
            now: fixedNow
        ))
        XCTAssertEqual(view?.severity, .ok)
        XCTAssertEqual(view?.accent, .success)
        XCTAssertEqual(view?.badgeLabel, "Connected")
        XCTAssertEqual(view?.detail, "Token expires in 42 days.")
        XCTAssertEqual(view?.ctaLabel, "Manage")
        XCTAssertEqual(view?.isReauthenticate, false)
        XCTAssertEqual(view?.accessibilitySummary, "Tesla account, Connected. Token expires in 42 days.")
    }

    func testExpiringSoon() {
        let view = resolvePresentation(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: 3),
            now: fixedNow
        ))
        XCTAssertEqual(view?.severity, .warn)
        XCTAssertEqual(view?.accent, .warning)
        XCTAssertEqual(view?.badgeLabel, "Expires soon")
        XCTAssertEqual(view?.detail, "Token expires in 3 days.")
        XCTAssertEqual(view?.ctaLabel, "Manage")
    }

    func testExpired() {
        let view = resolvePresentation(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: -5),
            now: fixedNow
        ))
        XCTAssertEqual(view?.severity, .expired)
        XCTAssertEqual(view?.accent, .danger)
        XCTAssertEqual(view?.badgeLabel, "Token expired")
        XCTAssertEqual(view?.detail, "Expired 5d ago — re-authenticate to resume Fleet API calls.")
        XCTAssertEqual(view?.ctaLabel, "Re-authenticate")
        XCTAssertEqual(view?.isReauthenticate, true)
    }

    func testDisconnected() {
        let view = resolvePresentation(TeslaAuthInput(authenticated: false, now: fixedNow))
        XCTAssertEqual(view?.severity, .disconnected)
        XCTAssertEqual(view?.accent, .danger)
        XCTAssertEqual(view?.badgeLabel, "Not connected")
        XCTAssertEqual(view?.detail, "No Tesla account is currently connected.")
        XCTAssertEqual(view?.ctaLabel, "Re-authenticate")
    }

    func testUnknown() {
        let view = resolvePresentation(TeslaAuthInput(authenticated: true, now: fixedNow))
        XCTAssertEqual(view?.severity, .unknown)
        XCTAssertEqual(view?.accent, .neutral)
        XCTAssertEqual(view?.badgeLabel, "Unknown")
        XCTAssertEqual(view?.detail, "Token expiry unknown — re-authenticate to refresh.")
        XCTAssertEqual(view?.ctaLabel, "Manage")
    }

    func testExpiresInOneDay() {
        let view = resolvePresentation(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: 1),
            now: fixedNow
        ))
        XCTAssertEqual(view?.detail, "Token expires in 1 day.")
    }

    func testUnparseableExpiryDetail() {
        let view = resolvePresentation(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: "not-a-date",
            now: fixedNow
        ))
        XCTAssertEqual(view?.severity, .unknown)
        XCTAssertEqual(view?.detail, "Token expiry unparseable.")
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class TeslaAuthModelTests: XCTestCase {
    private func makeModel(
        _ input: TeslaAuthInput,
        telemetry: TeslaAuthTelemetry = OSLogTeslaAuthTelemetry()
    ) -> (TeslaAuthModel, InMemoryTeslaAuthSource) {
        let source = InMemoryTeslaAuthSource(initial: input)
        let model = TeslaAuthModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    private func connected(connection: TeslaAuthConnection = .live) -> TeslaAuthInput {
        TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: iso(daysFromNow: 42),
            now: fixedNow,
            connection: connection
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTeslaAuthTelemetry()
        let (model, source) = makeModel(connected(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.presentation?.severity, .ok)
        XCTAssertEqual(spy.surfaces, [TeslaAuthCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(TeslaAuthInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(connected())
        XCTAssertEqual(model.presentation?.severity, .ok)
    }

    func testPresentationNilWhileLoadingAndError() {
        let (model, source) = makeModel(TeslaAuthInput(isLoading: true))
        model.start()
        XCTAssertNil(model.presentation)
        source.push(TeslaAuthInput(now: fixedNow, errorMessage: "boom"))
        XCTAssertNil(model.presentation)
    }

    func testConnectionTracksInput() {
        let (model, source) = makeModel(connected())
        model.start()
        XCTAssertEqual(model.connection, .live)
        source.push(connected(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(connected())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(connected(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(connected(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(connected())
        model.start()
        source.push(connected(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(connected())
        model.start()
        source.push(connected(connection: .stale)) // refresh 1
        source.push(connected(connection: .live)) // re-arm
        source.push(connected(connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(connected())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(connected())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TeslaAuthCard.surfaceSlug, "TeslaAuthCard")
        XCTAssertEqual(TeslaAuthCard.accountPath, "/tesla-account")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTeslaAuthTelemetry: TeslaAuthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
