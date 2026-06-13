//
//  EditConflictBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  Adapter + projection + model coverage for the EditConflictBanner surface:
//    • Interpolation — the `{{token}}` substitution (web i18next `{{resource}}`).
//    • Copy — the web `editConflict.banner.title` / `takeOver` / `switchHint` constants and the
//      `resourceLabel ? bodyWithLabel : body` branch (empty label falls back to the generic key).
//    • Accessibility — the combined, whitespace-collapsed VoiceOver banner label (title + body).
//    • Projection — every render branch across error / loading / empty (owner or no-peer) / data, with
//      an observed conflict surviving a transient loading or failure (the P4 leaf contract).
//    • Model — start telemetry, snapshot application, take-over semantics (optimistic hide + lease
//      claim + parent handler), the banner reappearing when a new peer wins the lease, and the stale
//      auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real lease bus, so
//  each assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source. The string resolver is the identity-fallback so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: EditConflictResolve = { _, fallback in fallback }

private let peer = EditConflictPeer(tabID: "peer-tab-aaa", claimedAt: Date(timeIntervalSince1970: 1_700_000_000))
private let otherPeer = EditConflictPeer(tabID: "peer-tab-bbb", claimedAt: Date(timeIntervalSince1970: 1_700_000_100))

private let bodyGeneric =
    "This resource is open in another tab of this browser. Saving here will overwrite changes made there."

// MARK: - Interpolation (web i18next `{{token}}`)

final class EditConflictInterpolationTests: XCTestCase {
    func testReplacesASingleToken() {
        XCTAssertEqual(
            EditConflictInterpolation.apply("{{resource}} is open.", ["resource": "Your settings"]),
            "Your settings is open."
        )
    }

    func testReplacesEveryOccurrence() {
        XCTAssertEqual(
            EditConflictInterpolation.apply("{{x}}-{{x}}", ["x": "1"]),
            "1-1"
        )
    }

    func testLeavesUnknownTokensUntouched() {
        XCTAssertEqual(
            EditConflictInterpolation.apply("Hello {{name}}", ["other": "x"]),
            "Hello {{name}}"
        )
    }
}

// MARK: - Copy (web `t('editConflict.banner.*', …)`)

final class EditConflictMessageTests: XCTestCase {
    func testTitleIsTheConstantHeadline() {
        XCTAssertEqual(
            EditConflictMessage.title(strings: fallbackStrings),
            "Another browser tab is editing this"
        )
    }

    func testBodyWithoutLabelUsesTheGenericKey() {
        XCTAssertEqual(
            EditConflictMessage.body(resourceLabel: nil, strings: fallbackStrings),
            bodyGeneric
        )
    }

    func testBodyWithLabelInterpolatesTheResource() {
        XCTAssertEqual(
            EditConflictMessage.body(resourceLabel: "Your settings", strings: fallbackStrings),
            "Your settings is open in another tab of this browser. Saving here will overwrite changes made there."
        )
    }

    func testBodyTreatsEmptyLabelAsAbsent() {
        XCTAssertEqual(
            EditConflictMessage.body(resourceLabel: "", strings: fallbackStrings),
            bodyGeneric
        )
    }

    func testTakeOverAndSwitchHintCopy() {
        XCTAssertEqual(EditConflictMessage.takeOver(strings: fallbackStrings), "Take over editing")
        XCTAssertEqual(
            EditConflictMessage.switchHint(strings: fallbackStrings),
            "Or switch to your other tab to keep editing there."
        )
    }
}

// MARK: - Accessibility

final class EditConflictAccessibilityTests: XCTestCase {
    func testBannerLabelCombinesTitleAndBody() {
        XCTAssertEqual(
            EditConflictAccessibility.bannerLabel(title: "Another tab is editing this", body: "Saving overwrites."),
            "Another tab is editing this. Saving overwrites."
        )
    }

    func testBannerLabelCollapsesWhitespace() {
        XCTAssertEqual(
            EditConflictAccessibility.bannerLabel(title: "  Conflict ", body: "Open  in   another tab. "),
            "Conflict. Open in another tab."
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class EditConflictProjectionTests: XCTestCase {
    private func resolve(_ input: EditConflictInput) -> EditConflictResolved {
        EditConflictProjection.resolve(input: input, strings: fallbackStrings)
    }

    private func conflict(
        resourceKey: String = "settings/general",
        resourceLabel: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> EditConflictInput {
        EditConflictInput(
            otherTab: peer,
            resourceKey: resourceKey,
            resourceLabel: resourceLabel,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    func testOwnerIsEmpty() {
        let input = EditConflictInput(isOwner: true, otherTab: peer, resourceKey: "settings/general")
        XCTAssertEqual(resolve(input).phase, .empty)
    }

    func testNoPeerIsEmpty() {
        XCTAssertEqual(resolve(EditConflictInput(resourceKey: "automation/42")).phase, .empty)
    }

    func testErrorWithNoConflictIsError() {
        let resolved = resolve(EditConflictInput(resourceKey: "settings/general", errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorWithObservedConflictKeepsShowingData() {
        let resolved = resolve(conflict(resourceLabel: "Your settings", errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(
            resolved.data?.body,
            "Your settings is open in another tab of this browser. Saving here will overwrite changes made there."
        )
    }

    func testLoadingWithNoConflictIsLoading() {
        XCTAssertEqual(resolve(EditConflictInput(resourceKey: "settings/general", isLoading: true)).phase, .loading)
    }

    func testLoadingWithObservedConflictShowsData() {
        XCTAssertEqual(resolve(conflict(isLoading: true)).phase, .data)
    }

    func testConflictRendersDataWithPropagatedFields() {
        let resolved = resolve(conflict(resourceKey: "alert-rules/list"))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.title, "Another browser tab is editing this")
        XCTAssertEqual(resolved.data?.body, bodyGeneric)
        XCTAssertEqual(resolved.data?.takeOverLabel, "Take over editing")
        XCTAssertEqual(resolved.data?.switchHint, "Or switch to your other tab to keep editing there.")
        XCTAssertEqual(resolved.data?.resourceKey, "alert-rules/list")
        XCTAssertEqual(resolved.data?.otherTabID, "peer-tab-aaa")
    }
}

// MARK: - Model (state holder + take-over + auto-refresh)

private final class SpyEditConflictTelemetry: EditConflictBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
private final class CallFlag {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}

@MainActor
final class EditConflictBannerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryEditConflictSource,
        telemetry: EditConflictBannerTelemetry = SpyEditConflictTelemetry(),
        onTakeOver: (@MainActor () -> Void)? = nil
    ) -> EditConflictBannerModel {
        EditConflictBannerModel(
            source: source,
            telemetry: telemetry,
            strings: fallbackStrings,
            onTakeOver: onTakeOver
        )
    }

    private func conflictInput() -> EditConflictInput {
        EditConflictInput(otherTab: peer, resourceKey: "settings/general", resourceLabel: "Your settings")
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryEditConflictSource(initial: EditConflictInput(resourceKey: "settings/general"))
        let telemetry = SpyEditConflictTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["EditConflictBanner"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryEditConflictSource()
        let model = makeModel(source: source)
        model.start()

        source.push(conflictInput())

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(
            model.data?.body,
            "Your settings is open in another tab of this browser. Saving here will overwrite changes made there."
        )
        XCTAssertEqual(model.data?.otherTabID, "peer-tab-aaa")
    }

    func testTakeOverHidesBannerClaimsLeaseAndInvokesHandler() {
        let source = InMemoryEditConflictSource(initial: conflictInput())
        let tookOver = CallFlag()
        let model = makeModel(source: source, onTakeOver: { tookOver.fire() })
        model.start()
        XCTAssertEqual(model.phase, .data)

        model.takeOver()

        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(source.claimCount, 1)
        XCTAssertEqual(tookOver.count, 1)
    }

    func testBannerReappearsWhenANewPeerWinsTheLease() {
        let source = InMemoryEditConflictSource(initial: conflictInput())
        let model = makeModel(source: source, onTakeOver: {})
        model.start()
        model.takeOver()
        XCTAssertEqual(model.phase, .empty)

        // A new peer claims the lease back — the banner must reappear (web tiebreaker behaviour).
        source.push(EditConflictInput(otherTab: otherPeer, resourceKey: "settings/general"))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.data?.otherTabID, "peer-tab-bbb")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryEditConflictSource()
        let model = makeModel(source: source)
        model.start()

        source.push(EditConflictInput(otherTab: peer, resourceKey: "settings/general", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(EditConflictInput(otherTab: peer, resourceKey: "settings/general", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryEditConflictSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
