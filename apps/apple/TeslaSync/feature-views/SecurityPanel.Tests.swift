//
//  SecurityPanel.Tests.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  Unit coverage for the SecurityPanel surface:
//    • Data — `hasContent` parity with the web `securityData != null ||
//      remoteStartEnabled != null` guard.
//    • Projection — the lock badge, sentry chip, door / window mono values, the
//      user-present + remote-start rows, and the optional detail line across the
//      secure, open, remote-only, and absent inputs, including the web nullish (`??`)
//      vs truthiness (`&&`) distinction.
//    • State holder — `SecurityPanelModel.resolvePhase` across loading / empty /
//      loaded / failed, plus the model wiring, the P1/S11 `view.opened` telemetry,
//      the freshness flag, and the stale one-shot auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySecurityPanelSource`.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be
/// asserted without the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Data: hasContent (web `securityData != null || remoteStartEnabled != null`)

@MainActor final class SecurityPanelDataTests: XCTestCase {
    func testNoInputsHasNoContent() {
        XCTAssertFalse(SecurityPanelData().hasContent)
        XCTAssertFalse(SecurityPanelData(event: nil, remoteStartEnabled: nil).hasContent)
    }

    func testEventOrRemoteStartGivesContent() {
        XCTAssertTrue(SecurityPanelData(event: SecurityPanelEvent(), remoteStartEnabled: nil).hasContent)
        // Web: `remoteStartEnabled != null` — even an explicit `false` counts as data.
        XCTAssertTrue(SecurityPanelData(event: nil, remoteStartEnabled: false).hasContent)
        XCTAssertTrue(SecurityPanelData(event: nil, remoteStartEnabled: true).hasContent)
    }
}

// MARK: - Projection helpers

@MainActor final class SecurityPanelProjectionTests: XCTestCase {
    private func row(_ rows: [SecurityPanelRowModel], _ id: String) -> SecurityPanelRowModel? {
        rows.first { $0.id == id }
    }

    private let secureEvent = SecurityPanelEvent(
        locked: true,
        sentryMode: true,
        doorsOpen: nil,
        windowsOpen: nil,
        userPresent: true,
        detail: "All secure"
    )

    private let openEvent = SecurityPanelEvent(
        locked: false,
        sentryMode: false,
        doorsOpen: "Driver Front Open",
        windowsOpen: "1 Open",
        userPresent: false,
        detail: nil
    )

    func testEventRowOrder() {
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: secureEvent, remoteStartEnabled: true),
            localize: echo
        )
        XCTAssertEqual(model.eventRows.map(\.id), ["sentry", "doors", "windows", "userPresent"])
    }

    func testSecureEventRendersSafeStates() {
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: secureEvent, remoteStartEnabled: true),
            localize: echo
        )
        XCTAssertNotNil(model.lock)
        XCTAssertEqual(model.lock?.value, "Locked")
        XCTAssertEqual(model.lock?.tone, .success)
        XCTAssertEqual(model.lock?.systemImage, "lock.fill")
        XCTAssertEqual(model.lock?.accessibilityLabel, "Locked. Vehicle lock status")
        XCTAssertEqual(row(model.eventRows, "sentry")?.value, "Active")
        XCTAssertEqual(row(model.eventRows, "sentry")?.tone, .danger)
        XCTAssertEqual(row(model.eventRows, "sentry")?.kind, .chip)
        // doors_open / windows_open are nil → web `?? 'Closed'`.
        XCTAssertEqual(row(model.eventRows, "doors")?.value, "Closed")
        XCTAssertEqual(row(model.eventRows, "doors")?.kind, .mono)
        XCTAssertEqual(row(model.eventRows, "windows")?.value, "Closed")
        XCTAssertEqual(row(model.eventRows, "userPresent")?.value, "Yes")
        XCTAssertEqual(row(model.eventRows, "userPresent")?.tone, .success)
        XCTAssertEqual(model.detail, "All secure")
        XCTAssertEqual(model.remoteStart.value, "Enabled")
        XCTAssertEqual(model.remoteStart.tone, .success)
    }

    func testOpenEventRendersRawValues() {
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: openEvent, remoteStartEnabled: false),
            localize: echo
        )
        XCTAssertNotNil(model.lock)
        XCTAssertEqual(model.lock?.value, "Unlocked")
        XCTAssertEqual(model.lock?.tone, .warning)
        XCTAssertEqual(model.lock?.systemImage, "lock.open.fill")
        XCTAssertEqual(row(model.eventRows, "sentry")?.value, "Inactive")
        XCTAssertEqual(row(model.eventRows, "sentry")?.tone, .neutral)
        // Non-nil door / window strings surface verbatim.
        XCTAssertEqual(row(model.eventRows, "doors")?.value, "Driver Front Open")
        XCTAssertEqual(row(model.eventRows, "windows")?.value, "1 Open")
        XCTAssertEqual(row(model.eventRows, "userPresent")?.value, "No")
        XCTAssertEqual(row(model.eventRows, "userPresent")?.tone, .neutral)
        XCTAssertNil(model.detail)
        XCTAssertEqual(model.remoteStart.value, "Disabled")
        XCTAssertEqual(model.remoteStart.tone, .neutral)
    }

    func testNilFieldsUseLockedAndSentryFallbacks() {
        // Web optional-chaining: `locked ?` → Unlocked, `sentry_mode ?` → Inactive,
        // `user_present ?` → No when the booleans are null.
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: SecurityPanelEvent(), remoteStartEnabled: nil),
            localize: echo
        )
        XCTAssertEqual(model.lock?.value, "Unlocked")
        XCTAssertEqual(row(model.eventRows, "sentry")?.value, "Inactive")
        XCTAssertEqual(row(model.eventRows, "userPresent")?.value, "No")
    }

    func testRemoteOnlyHasNoEventRowsButShowsRemoteStart() {
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: nil, remoteStartEnabled: true),
            localize: echo
        )
        XCTAssertNil(model.lock)
        XCTAssertTrue(model.eventRows.isEmpty)
        XCTAssertNil(model.detail)
        XCTAssertEqual(model.remoteStart.value, "Enabled")
    }

    func testNilDataShowsRemoteStartDash() {
        let model = SecurityPanelProjection.content(data: nil, localize: echo)
        XCTAssertNil(model.lock)
        XCTAssertTrue(model.eventRows.isEmpty)
        // Web `remoteStartEnabled == null ? '—'`.
        XCTAssertEqual(model.remoteStart.value, "—")
        XCTAssertEqual(model.remoteStart.tone, .neutral)
    }

    func testRemoteStartTernaryBranches() {
        func remote(_ enabled: Bool?) -> SecurityPanelRowModel {
            SecurityPanelProjection.content(
                data: SecurityPanelData(event: nil, remoteStartEnabled: enabled),
                localize: echo
            ).remoteStart
        }
        XCTAssertEqual(remote(nil).value, "—")
        XCTAssertEqual(remote(nil).tone, .neutral)
        XCTAssertEqual(remote(true).value, "Enabled")
        XCTAssertEqual(remote(true).tone, .success)
        XCTAssertEqual(remote(false).value, "Disabled")
        XCTAssertEqual(remote(false).tone, .neutral)
    }

    func testDoorsUseNullishNotTruthiness() {
        // Web `doors_open ?? 'Closed'` is nullish — a non-nil empty string passes
        // through verbatim rather than falling back to "Closed".
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: SecurityPanelEvent(doorsOpen: ""), remoteStartEnabled: nil),
            localize: echo
        )
        XCTAssertEqual(row(model.eventRows, "doors")?.value, "")
    }

    func testDetailUsesTruthinessNotNullish() {
        // Web `securityData.detail && …` — an empty string is falsy and omitted.
        let empty = SecurityPanelProjection.content(
            data: SecurityPanelData(event: SecurityPanelEvent(detail: ""), remoteStartEnabled: nil),
            localize: echo
        )
        XCTAssertNil(empty.detail)
        let present = SecurityPanelProjection.content(
            data: SecurityPanelData(event: SecurityPanelEvent(detail: "Sentry triggered"), remoteStartEnabled: nil),
            localize: echo
        )
        XCTAssertEqual(present.detail, "Sentry triggered")
    }

    func testRowAccessibilityLabelsCombineLabelAndValue() {
        let model = SecurityPanelProjection.content(
            data: SecurityPanelData(event: secureEvent, remoteStartEnabled: true),
            localize: echo
        )
        XCTAssertEqual(row(model.eventRows, "sentry")?.accessibilityLabel, "Sentry Mode: Active")
        XCTAssertEqual(model.remoteStart.accessibilityLabel, "Remote Start: Enabled")
    }
}

// MARK: - Phase resolution

@MainActor final class SecurityPanelPhaseTests: XCTestCase {
    private let data = SecurityPanelData(event: SecurityPanelEvent(locked: true), remoteStartEnabled: nil)

    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        XCTAssertEqual(
            SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .loading, data: data)),
            .content
        )
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .empty)), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .loaded)), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(
            SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .loaded, data: data)),
            .content
        )
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(
            SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testFailedWithCachedDataStaysContent() {
        XCTAssertEqual(
            SecurityPanelModel.resolvePhase(SecurityPanelUpdate(status: .failed("boom"), data: data)),
            .content
        )
    }
}

// MARK: - State holder: wiring + telemetry + freshness + stale auto-refresh

@MainActor final class SecurityPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: SecurityPanelUpdate,
        telemetry: SecurityPanelTelemetry = OSLogSecurityPanelTelemetry()
    ) -> (SecurityPanelModel, InMemorySecurityPanelSource) {
        let source = InMemorySecurityPanelSource(initial: update)
        let model = SecurityPanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loadedUpdate(connection: SecurityPanelConnection = .live) -> SecurityPanelUpdate {
        SecurityPanelUpdate(
            status: .loaded,
            connection: connection,
            data: SecurityPanelData(event: SecurityPanelEvent(locked: true), remoteStartEnabled: true)
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySecurityPanelTelemetry()
        let (model, source) = makeModel(loadedUpdate(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.content.remoteStart.value, "Enabled")
        XCTAssertEqual(spy.surfaces, [SecurityPanelSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SecurityPanelUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhase() {
        let (model, _) = makeModel(SecurityPanelUpdate(status: .empty, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.showsFreshness)
    }

    func testRemoteOnlyResolvesToContent() {
        let (model, _) = makeModel(SecurityPanelUpdate(
            status: .loaded,
            data: SecurityPanelData(event: nil, remoteStartEnabled: false)
        ))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.content.lock)
        XCTAssertEqual(model.content.remoteStart.value, "Disabled")
    }

    func testShowsFreshnessOnlyWhenContentAndNotLive() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        XCTAssertFalse(model.showsFreshness)
        source.push(loadedUpdate(connection: .stale))
        XCTAssertTrue(model.showsFreshness)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(connection: .live))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(loadedUpdate())
        model.start()
        source.push(loadedUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySecurityPanelTelemetry: SecurityPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
