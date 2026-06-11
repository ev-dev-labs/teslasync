//
//  UserCell.ModelTests.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  State-holder, source, and view coverage for the UserCell surface:
//    • Model — start idempotence, the once-only `view.opened` telemetry (not re-emitted after a
//      stop/start), descriptor apply, the i18n-facade-resolved display name, and the spoken
//      label / value accessors across the empty + populated branches.
//    • Live source — start/refresh emit the bound descriptor.
//    • Views — every subview + the surface compose (signature contract) and the always-tooltip
//      avatar contract the populated row relies on (the web `showTooltip`).
//
//  The pure adapter coverage lives in `UserCell.Tests.swift`. These run in the TeslaSync(/-macOS)
//  XCTest targets with no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class UserCellModelTests: XCTestCase {
    private func makeModel(
        _ descriptor: UserCellDescriptor,
        spy: SpyUserCellTelemetry,
        strings: @escaping UserCellResolve = { _, fallback in fallback }
    ) -> (model: UserCellModel, source: InMemoryUserCellSource) {
        let source = InMemoryUserCellSource(initial: descriptor)
        let model = UserCellModel(source: source, telemetry: spy, strings: strings)
        return (model, source)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: UserCellUser(name: "Alice Adams")), spy: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(spy.surfaces, ["UserCell"])
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStopThenStartDoesNotReEmit() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: UserCellUser(name: "Alice Adams")), spy: spy)
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(spy.surfaces, ["UserCell"])
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.source.stopCount, 1)
    }

    func testApplyUpdatesResolved() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: UserCellUser(name: "Alice Adams")), spy: spy)
        env.model.start()
        XCTAssertEqual(env.model.displayName, "Alice Adams")
        env.source.push(UserCellDescriptor(user: UserCellUser(name: "Bob Brown")))
        XCTAssertEqual(env.model.displayName, "Bob Brown")
    }

    func testRefreshDelegatesToSource() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: UserCellUser(name: "Alice")), spy: spy)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testEmptyDescriptorHasNoDisplayName() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: nil), spy: spy)
        env.model.start()
        XCTAssertNil(env.model.displayName)
        XCTAssertEqual(env.model.resolved, .empty)
    }

    func testAccessibilityStringsPopulated() {
        let spy = SpyUserCellTelemetry()
        let user = UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com")
        let env = makeModel(UserCellDescriptor(user: user, showEmail: true), spy: spy)
        env.model.start()
        XCTAssertEqual(env.model.accessibilityLabel, "Alice Adams")
        XCTAssertEqual(env.model.accessibilityValue, "alice@example.com")
    }

    func testAccessibilityStringsEmpty() {
        let spy = SpyUserCellTelemetry()
        let env = makeModel(UserCellDescriptor(user: nil), spy: spy)
        env.model.start()
        XCTAssertEqual(env.model.accessibilityLabel, "—")
        XCTAssertEqual(env.model.accessibilityValue, "")
    }

    func testUnknownWordResolvesThroughStringsFacade() {
        // A whitespace-only name is a signal (not empty) but trims away, so the localised
        // "Unknown user" word is used — and it must come from the injected i18n facade.
        let spy = SpyUserCellTelemetry()
        let env = makeModel(
            UserCellDescriptor(user: UserCellUser(name: "   ")),
            spy: spy,
            strings: { key, fallback in key == "avatar.unknown" ? "Inconnu" : fallback }
        )
        env.model.start()
        XCTAssertEqual(env.model.displayName, "Inconnu")
        XCTAssertEqual(env.model.unknownWord, "Inconnu")
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveUserCellSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundDescriptor() {
        let descriptor = UserCellDescriptor(user: UserCellUser(name: "Alice Adams"), showEmail: true)
        let source = LiveUserCellSource(descriptor: descriptor)
        var emissions: [UserCellDescriptor] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [descriptor, descriptor])
    }
}

// MARK: - Views (signature contract + tooltip contract)

@MainActor
final class UserCellViewTests: XCTestCase {
    private let populated = UserCellPopulated(
        displayName: "Alice Adams",
        avatarUserID: "u-1",
        avatarURL: nil,
        email: "alice@example.com",
        size: .sm
    )

    func testSubviewsCompose() {
        _ = UserCellEmpty()
        _ = UserCellRow(populated: populated)
        _ = UserCellContent(resolved: .empty, label: "—", value: "")
        _ = UserCellContent(resolved: .populated(populated), label: "Alice Adams", value: "alice@example.com")
    }

    func testSurfaceComposesForEveryBranch() {
        _ = UserCell(user: nil)
        _ = UserCell(user: UserCellUser())
        _ = UserCell(user: UserCellUser(id: "u-1", name: "Alice Adams"))
        _ = UserCell(user: UserCellUser(email: "jane.smith@example.com"), showEmail: true)
        _ = UserCell(user: UserCellUser(id: "u-2", name: "Grace Hopper"), size: .lg)
        _ = UserCell(UserCellDescriptor(user: UserCellUser(id: "subject-abc")))
    }

    func testPopulatedRowAvatarAlwaysHasTooltip() {
        // The web cell sets `showTooltip` on the avatar; the populated row hard-codes the same. An
        // Avatar built with showTooltip exposes the display name as its tooltip — the contract the
        // row relies on for the full name on hover / long-press.
        let descriptor = AvatarDescriptor(name: populated.displayName, showTooltip: true)
        let model = AvatarModel(
            source: LiveAvatarSource(descriptor: descriptor),
            telemetry: OSLogAvatarTelemetry(),
            strings: { _, fallback in fallback }
        )
        model.start()
        XCTAssertEqual(model.tooltipLabel, "Alice Adams")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyUserCellTelemetry: UserCellTelemetry, @unchecked Sendable {
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
