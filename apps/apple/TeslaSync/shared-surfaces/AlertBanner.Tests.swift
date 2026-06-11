//
//  AlertBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  Adapter + projection coverage for the AlertBanner surface:
//    • Variant — the web `'info' | 'success' | 'warning' | 'danger'` axis + the per-variant SF Symbol.
//    • Text — the verbatim (caller content) vs localized (facade-resolved) resolution.
//    • Notice — the `useMutationToast` bridge (success / error ± detail) and the connectivity bridge
//      (the verbatim `OfflineBanner` / `LiveStaleDataBanner` copy + keys), plus the icon-default +
//      dismiss-gate in `content(canDismiss:)`.
//    • Projection — the render branches plus the P4 leaf contract across error / loading /
//      connectivity / notice / empty, including the dismiss gate and the offline-before-stale order.
//    • Accessibility — the composed VoiceOver banner label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private let identityResolver: AlertBannerResolve = { _, fallback in fallback }
private let keyResolver: AlertBannerResolve = { key, _ in key }

// MARK: - Variant (web `alertVariantMap` keys)

final class AlertBannerVariantTests: XCTestCase {
    func testEachVariantHasADistinctSymbol() {
        let symbols = Set(AlertBannerVariant.allCases.map(\.defaultSymbolName))
        XCTAssertEqual(symbols.count, AlertBannerVariant.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }

    func testVariantSymbolsAreStable() {
        XCTAssertEqual(AlertBannerVariant.info.defaultSymbolName, "info.circle.fill")
        XCTAssertEqual(AlertBannerVariant.success.defaultSymbolName, "checkmark.circle.fill")
        XCTAssertEqual(AlertBannerVariant.warning.defaultSymbolName, "exclamationmark.triangle.fill")
        XCTAssertEqual(AlertBannerVariant.danger.defaultSymbolName, "exclamationmark.octagon.fill")
    }

    func testVariantUnionMatchesWeb() {
        XCTAssertEqual(AlertBannerVariant.allCases, [.info, .success, .warning, .danger])
    }
}

// MARK: - Text (verbatim vs facade-resolved)

final class AlertBannerTextTests: XCTestCase {
    func testVerbatimIgnoresResolver() {
        XCTAssertEqual(AlertBannerText.verbatim("HTTP 500").resolve(keyResolver), "HTTP 500")
        XCTAssertEqual(AlertBannerText.verbatim("HTTP 500").resolve(identityResolver), "HTTP 500")
    }

    func testLocalizedUsesResolver() {
        let text = AlertBannerText.localized(key: "pwa.offline.title", fallback: "You're offline")
        XCTAssertEqual(text.resolve(identityResolver), "You're offline")
        XCTAssertEqual(text.resolve(keyResolver), "pwa.offline.title")
    }
}

// MARK: - Notice — mutation bridge (web `useMutationToast`)

final class AlertBannerMutationBridgeTests: XCTestCase {
    func testSuccessIsSingleLineSuccessVariant() {
        let notice = AlertBannerNotice.from(mutation: AlertBannerMutation(kind: .success, title: "Settings saved"))
        XCTAssertEqual(notice.variant, .success)
        XCTAssertNil(notice.title)
        XCTAssertEqual(notice.message, .verbatim("Settings saved"))
        XCTAssertTrue(notice.dismissable)
        XCTAssertNil(notice.symbolName)
    }

    func testErrorWithDetailSplitsTitleAndDetail() {
        let mutation = AlertBannerMutation(kind: .error, title: "Failed to save", detail: "HTTP 500: boom")
        let notice = AlertBannerNotice.from(mutation: mutation)
        XCTAssertEqual(notice.variant, .danger)
        XCTAssertEqual(notice.title, .verbatim("Failed to save"))
        XCTAssertEqual(notice.message, .verbatim("HTTP 500: boom"))
        XCTAssertTrue(notice.dismissable)
    }

    func testErrorWithoutDetailIsSingleLine() {
        let notice = AlertBannerNotice.from(mutation: AlertBannerMutation(kind: .error, title: "Failed to save"))
        XCTAssertEqual(notice.variant, .danger)
        XCTAssertNil(notice.title)
        XCTAssertEqual(notice.message, .verbatim("Failed to save"))
    }

    func testErrorWithEmptyDetailIsSingleLine() {
        let mutation = AlertBannerMutation(kind: .error, title: "Failed to save", detail: "")
        let notice = AlertBannerNotice.from(mutation: mutation)
        XCTAssertNil(notice.title)
        XCTAssertEqual(notice.message, .verbatim("Failed to save"))
    }
}

// MARK: - Notice — connectivity bridge (web `OfflineBanner` / `LiveStaleDataBanner`)

final class AlertBannerConnectivityBridgeTests: XCTestCase {
    func testLiveHasNoConnectivityNotice() {
        XCTAssertNil(AlertBannerNotice.connectivity(for: .live))
    }

    func testStaleReproducesLiveStaleDataBanner() throws {
        let notice = try XCTUnwrap(AlertBannerNotice.connectivity(for: .stale))
        XCTAssertEqual(notice.variant, .warning)
        XCTAssertEqual(notice.symbolName, "clock.badge.exclamationmark")
        XCTAssertFalse(notice.dismissable)
        XCTAssertEqual(notice.title, .localized(key: "live.staleBanner.title", fallback: "Live data unavailable"))
        XCTAssertEqual(
            notice.message.resolve(identityResolver),
            "The live data connection has been offline for more than 2 minutes. "
                + "Values on this page may be stale until the connection is restored."
        )
        XCTAssertEqual(notice.title?.resolve(keyResolver), "live.staleBanner.title")
    }

    func testOfflineReproducesOfflineBanner() throws {
        let notice = try XCTUnwrap(AlertBannerNotice.connectivity(for: .offline))
        XCTAssertEqual(notice.variant, .warning)
        XCTAssertEqual(notice.symbolName, "wifi.slash")
        XCTAssertFalse(notice.dismissable)
        XCTAssertEqual(notice.title, .localized(key: "pwa.offline.title", fallback: "You're offline"))
        XCTAssertEqual(
            notice.message.resolve(identityResolver),
            "Showing cached data. New requests will retry when you reconnect."
        )
        XCTAssertEqual(notice.message.resolve(keyResolver), "pwa.offline.banner")
    }
}

// MARK: - Notice — resolved content (icon default + dismiss gate)

final class AlertBannerNoticeContentTests: XCTestCase {
    func testContentFillsVariantDefaultSymbolWhenNoneSupplied() {
        let notice = AlertBannerNotice(variant: .info, message: .verbatim("Heads up"))
        XCTAssertEqual(notice.content(canDismiss: false).symbolName, "info.circle.fill")
    }

    func testContentKeepsExplicitSymbol() {
        let notice = AlertBannerNotice(variant: .warning, symbolName: "wifi.slash", message: .verbatim("Offline"))
        XCTAssertEqual(notice.content(canDismiss: false).symbolName, "wifi.slash")
    }

    func testDismissShownOnlyWhenDismissableAndCapable() {
        let dismissable = AlertBannerNotice(variant: .success, message: .verbatim("Saved"), dismissable: true)
        XCTAssertTrue(dismissable.content(canDismiss: true).showDismiss)
        XCTAssertFalse(dismissable.content(canDismiss: false).showDismiss)

        let persistent = AlertBannerNotice(variant: .warning, message: .verbatim("Offline"), dismissable: false)
        XCTAssertFalse(persistent.content(canDismiss: true).showDismiss)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AlertBannerProjectionTests: XCTestCase {
    private func notice(_ variant: AlertBannerVariant = .info) -> AlertBannerNotice {
        AlertBannerNotice(variant: variant, message: .verbatim("hello"), dismissable: true)
    }

    func testErrorTakesPrecedenceOverEverything() {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(), connection: .offline, isLoading: true, errorMessage: "boom"),
            canDismiss: true
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.content)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(), errorMessage: ""),
            canDismiss: true
        )
        XCTAssertEqual(resolved.phase, .alert)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(isLoading: true),
            canDismiss: true
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testOfflineConnectivityOverridesNotice() throws {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(.success), connection: .offline),
            canDismiss: true
        )
        XCTAssertEqual(resolved.phase, .alert)
        let content = try XCTUnwrap(resolved.content)
        XCTAssertEqual(content.variant, .warning)
        XCTAssertEqual(content.symbolName, "wifi.slash")
        XCTAssertFalse(content.showDismiss)
    }

    func testStaleConnectivityOverridesNotice() throws {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(.success), connection: .stale),
            canDismiss: true
        )
        let content = try XCTUnwrap(resolved.content)
        XCTAssertEqual(content.variant, .warning)
        XCTAssertEqual(content.symbolName, "clock.badge.exclamationmark")
    }

    func testNoticeRendersWhenLive() throws {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(.danger), connection: .live),
            canDismiss: true
        )
        let content = try XCTUnwrap(resolved.content)
        XCTAssertEqual(content.variant, .danger)
        XCTAssertTrue(content.showDismiss)
    }

    func testEmptyWhenNothingToShow() {
        let resolved = AlertBannerProjection.resolve(input: AlertBannerInput(), canDismiss: true)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.content)
    }

    func testNoticeDismissGatedByCapability() throws {
        let resolved = AlertBannerProjection.resolve(
            input: AlertBannerInput(notice: notice(.success)),
            canDismiss: false
        )
        let content = try XCTUnwrap(resolved.content)
        XCTAssertFalse(content.showDismiss)
    }
}

// MARK: - Accessibility

final class AlertBannerAccessibilityTests: XCTestCase {
    func testLabelReadsTitleThenMessage() {
        let label = AlertBannerAccessibility.label(
            title: "Failed to save settings",
            message: "HTTP 500: internal server error"
        )
        XCTAssertEqual(label, "Failed to save settings. HTTP 500: internal server error")
    }

    func testLabelMessageOnlyWhenNoTitle() {
        XCTAssertEqual(AlertBannerAccessibility.label(title: nil, message: "Settings saved"), "Settings saved")
        XCTAssertEqual(AlertBannerAccessibility.label(title: "", message: "Settings saved"), "Settings saved")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = AlertBannerAccessibility.label(
            title: "You're offline.",
            message: "Showing cached data."
        )
        XCTAssertEqual(label, "You're offline. Showing cached data.")
    }

    func testLabelEmptyWhenBothEmpty() {
        XCTAssertEqual(AlertBannerAccessibility.label(title: nil, message: ""), "")
    }
}
