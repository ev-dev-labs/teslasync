//
//  UsageCard.Tests.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in UsageCard.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • UsageCardModel — the once-only `view.opened` (idempotent across appear/disappear), the empty-message
//      resolution (custom vs the localized default), the internal-link routing to `onNavigate` by id (and
//      the no-op for an unknown id / external link), the budget + banner VoiceOver labels, and the props
//      update (reassign on change + refresh the host closure).
//    • Views — the public surface + the subviews compose in every real branch.
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - UsageCardModel (lifecycle + routing)

@MainActor
final class UsageCardModelTests: XCTestCase {
    private func model(
        _ input: UsageCardInput,
        onNavigate: (@MainActor (UsageCardFooterLink) -> Void)? = nil,
        telemetry: UsageCardTelemetry = OSLogUsageCardTelemetry()
    ) -> UsageCardModel {
        UsageCardModel(input: input, onNavigate: onNavigate, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(UsageCardInput(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [UsageCardSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(UsageCardInput(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [UsageCardSurface.slug], "view.opened fires once per instance")
    }

    func testResolvedEmptyMessageUsesLocalizedDefaultWhenNil() {
        XCTAssertEqual(model(UsageCardInput()).resolvedEmptyMessage, "No data to display yet.")
    }

    func testResolvedEmptyMessageHonorsCustomCopy() {
        XCTAssertEqual(
            model(UsageCardInput(emptyMessage: "Nothing tracked yet")).resolvedEmptyMessage,
            "Nothing tracked yet"
        )
    }

    func testInternalLinkRoutesRawLinkToOnNavigateByID() {
        let recorder = NavigateRecorder()
        let raw = UsageCardFooterLink(id: "usage", destination: "/settings/usage", label: "Usage")
        let holder = model(UsageCardInput(footer: [raw]), onNavigate: { recorder.record($0) })
        holder.navigate(to: UsageCardProjector.resolveFooterLink(raw))
        XCTAssertEqual(recorder.links.map(\.id), ["usage"])
        XCTAssertEqual(recorder.links.first?.destination, "/settings/usage")
    }

    func testNavigateIsNoOpForUnknownID() {
        let recorder = NavigateRecorder()
        let holder = model(UsageCardInput(), onNavigate: { recorder.record($0) })
        let orphan = UsageCardProjector.resolveFooterLink(
            UsageCardFooterLink(id: "ghost", destination: "/x", label: "x")
        )
        holder.navigate(to: orphan)
        XCTAssertTrue(recorder.links.isEmpty, "an id absent from the props routes nowhere")
    }

    func testBudgetAndBannerAccessibilityLabels() {
        let holder = model(UsageCardInput())
        let budget = UsageCardProjector.resolveBudget(
            UsageCardBudget(headline: "h", pct: 108, accessibilityLabel: "a")
        )
        XCTAssertEqual(holder.budgetAccessibilityValue(budget), "108%")
        let banner = UsageCardProjector.resolveBanner(
            UsageCardBanner(title: "Over credit", description: "Now billing on-demand.")
        )
        XCTAssertEqual(holder.bannerAccessibilityLabel(banner), "Over credit. Now billing on-demand.")
    }

    func testUpdateReassignsOnChange() {
        let holder = model(UsageCardInput())
        XCTAssertFalse(holder.projection.hasAnything)
        holder.update(
            UsageCardInput(bands: [UsageCardBand(id: "b", label: "l", value: "v")]),
            onNavigate: nil
        )
        XCTAssertTrue(holder.projection.hasAnything)
        XCTAssertEqual(holder.input.bands.count, 1)
    }

    func testUpdateRefreshesNavigateClosure() {
        let first = NavigateRecorder()
        let second = NavigateRecorder()
        let raw = UsageCardFooterLink(id: "f", destination: "/x", label: "x")
        let holder = model(UsageCardInput(footer: [raw]), onNavigate: { first.record($0) })
        holder.update(UsageCardInput(footer: [raw]), onNavigate: { second.record($0) })
        holder.navigate(to: UsageCardProjector.resolveFooterLink(raw))
        XCTAssertTrue(first.links.isEmpty, "the stale closure is replaced")
        XCTAssertEqual(second.links.map(\.id), ["f"])
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class UsageCardViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = UsageCard()
        _ = UsageCard(emptyMessage: "Nothing yet")
        _ = UsageCard(budget: UsageCardBudget(headline: "h", pct: 8, accessibilityLabel: "a"))
        _ = UsageCard(bands: [UsageCardBand(id: "b", iconSystemName: "number", label: "l", value: "v")])
        _ = UsageCard(details: [UsageCardDetail(id: "d", label: "l", value: "v", intent: .warn)])
        _ = UsageCard(topLists: [UsageCardTopList(id: "t", iconSystemName: "cpu", title: "t", items: [
            UsageCardTopListItem(id: "i", label: "l", value: "v")
        ])])
        _ = UsageCard(banner: UsageCardBanner(title: "t", description: "d"))
        _ = UsageCard(
            footer: [
                UsageCardFooterLink(id: "a", destination: "/x", label: "Internal", primary: true),
                UsageCardFooterLink(id: "b", destination: "https://example.com", label: "External", external: true)
            ],
            onNavigate: { _ in }
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = UsageCardModel(
            input: UsageCardInput(banner: UsageCardBanner(title: "t", description: "d")),
            telemetry: SpyTelemetry()
        )
        _ = UsageCard(model: injected)
        XCTAssertEqual(UsageCard.surfaceSlug, "UsageCard")
    }

    func testSubviewsCompose() {
        let budget = UsageCardProjector.resolveBudget(
            UsageCardBudget(headline: "h", rightLabel: "8%", caption: "c", pct: 8, accessibilityLabel: "a")
        )
        _ = UsageCardBudgetView(budget: budget, accessibilityValue: "8%")
        _ = UsageCardProgressBar(fraction: 0.5, tint: .red)
        _ = UsageCardBandsView(bands: [UsageCardBand(id: "b", label: "l", value: "v")])
        _ = UsageCardDetailsView(details: [UsageCardDetail(id: "d", label: "l", value: "v")])
        _ = UsageCardTopListsView(topLists: [UsageCardTopList(id: "t", title: "t", items: [])])
        let banner = UsageCardProjector.resolveBanner(UsageCardBanner(title: "t", description: "d"))
        _ = UsageCardBannerView(banner: banner, accessibilityLabel: "t. d")
        let link = UsageCardProjector.resolveFooterLink(
            UsageCardFooterLink(id: "f", destination: "/x", label: "x")
        )
        _ = UsageCardFooterView(links: [link], onSelect: { _ in })
        _ = UsageCardEmptyView(message: "none")
    }
}

// MARK: - Strings facade (P1/S10)

final class UsageCardStringsTests: XCTestCase {
    func testStaticFallbacks() {
        XCTAssertEqual(UsageCardStrings.defaultEmptyMessage, "No data to display yet.")
        XCTAssertEqual(UsageCardStrings.externalLinkHint, "Opens in browser")
    }

    func testFormattedFallbacks() {
        XCTAssertEqual(UsageCardStrings.budgetPercentValue(8), "8%")
        XCTAssertEqual(UsageCardStrings.budgetPercentValue(108), "108%")
        XCTAssertEqual(
            UsageCardStrings.bannerAccessibilityLabel(title: "Over", description: "On-demand now."),
            "Over. On-demand now."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: UsageCardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the raw footer links routed out through `onNavigate` (the `@MainActor` host-closure seam).
@MainActor
private final class NavigateRecorder {
    private(set) var links: [UsageCardFooterLink] = []

    func record(_ link: UsageCardFooterLink) {
        links.append(link)
    }
}
