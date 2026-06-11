//
//  Avatar.ModelTests.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  State-holder, source, and view coverage for the Avatar surface:
//    • Model — start idempotence, the once-only `view.opened` telemetry (not re-emitted after a
//      stop/start), descriptor apply, and the localised identity / presence / tooltip accessors.
//    • Live source — start/refresh emit the bound descriptor.
//    • Views — every subview + the surface compose (signature contract).
//
//  The pure adapter coverage lives in `Avatar.Tests.swift`. These run in the TeslaSync(/-macOS)
//  XCTest targets with no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class AvatarModelTests: XCTestCase {
    private func makeModel(
        _ descriptor: AvatarDescriptor,
        spy: SpyAvatarTelemetry
    ) -> (model: AvatarModel, source: InMemoryAvatarSource) {
        let source = InMemoryAvatarSource(initial: descriptor)
        let model = AvatarModel(source: source, telemetry: spy, strings: { _, fallback in fallback })
        return (model, source)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyAvatarTelemetry()
        let env = makeModel(AvatarDescriptor(name: "Ada"), spy: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(spy.surfaces, ["Avatar"])
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStopThenStartDoesNotReEmit() {
        let spy = SpyAvatarTelemetry()
        let env = makeModel(AvatarDescriptor(name: "Ada"), spy: spy)
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(spy.surfaces, ["Avatar"])
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.source.stopCount, 1)
    }

    func testApplyUpdatesResolved() {
        let spy = SpyAvatarTelemetry()
        let env = makeModel(AvatarDescriptor(name: "Ada Lovelace"), spy: spy)
        env.model.start()
        XCTAssertEqual(env.model.resolved.fallback, .initials("AL"))
        env.source.push(AvatarDescriptor(name: "John Doe"))
        XCTAssertEqual(env.model.resolved.fallback, .initials("JD"))
    }

    func testRefreshDelegatesToSource() {
        let spy = SpyAvatarTelemetry()
        let env = makeModel(AvatarDescriptor(name: "Ada"), spy: spy)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testIdentityLabel() {
        let spy = SpyAvatarTelemetry()
        let named = makeModel(AvatarDescriptor(name: "  Ada Lovelace  "), spy: spy)
        named.model.start()
        XCTAssertEqual(named.model.identityLabel, "Ada Lovelace")

        let anon = makeModel(AvatarDescriptor(kind: .bot), spy: spy)
        anon.model.start()
        XCTAssertEqual(anon.model.identityLabel, "Unknown user")
    }

    func testPresenceLabel() {
        let spy = SpyAvatarTelemetry()
        let online = makeModel(AvatarDescriptor(name: "Ada", status: .online), spy: spy)
        online.model.start()
        XCTAssertEqual(online.model.presenceLabel, "Online")

        let none = makeModel(AvatarDescriptor(name: "Ada"), spy: spy)
        none.model.start()
        XCTAssertNil(none.model.presenceLabel)
    }

    func testTooltipLabel() {
        let spy = SpyAvatarTelemetry()
        let off = makeModel(AvatarDescriptor(name: "Ada"), spy: spy)
        off.model.start()
        XCTAssertNil(off.model.tooltipLabel)

        let on = makeModel(AvatarDescriptor(name: "Ada", showTooltip: true), spy: spy)
        on.model.start()
        XCTAssertEqual(on.model.tooltipLabel, "Ada")
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveAvatarSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundDescriptor() {
        let descriptor = AvatarDescriptor(name: "Ada", status: .online)
        let source = LiveAvatarSource(descriptor: descriptor)
        var emissions: [AvatarDescriptor] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [descriptor, descriptor])
    }
}

// MARK: - Views (signature contract)

@MainActor
final class AvatarViewTests: XCTestCase {
    func testSubviewsCompose() {
        let resolved = AvatarProjection.resolve(AvatarDescriptor(name: "Ada", status: .online))
        _ = AvatarContent(resolved: resolved, src: nil, identity: "Ada", presence: "Online", tooltip: "Ada")
        _ = AvatarFallbackDisc(resolved: resolved)
        _ = AvatarInitialsLabel(text: "AD", size: .lg, tone: .white)
        _ = AvatarGlyph(kind: .user, size: .lg, tone: .white, isAttributed: false)
        _ = AvatarGlyph(kind: .bot, size: .lg, tone: .ink, isAttributed: true)
        _ = AvatarStatusDot(status: .online, size: .lg)
        _ = AvatarRemoteImage(src: "https://x/y.png", reduceMotion: true)
        _ = AvatarHelixMark(size: 24, tint: .white)
    }

    func testSurfaceComposesForEveryBranch() {
        let descriptors: [AvatarDescriptor] = [
            AvatarDescriptor(name: "Ada Lovelace", status: .online),
            AvatarDescriptor(userId: "u-2"),
            AvatarDescriptor(kind: .bot),
            AvatarDescriptor(name: "Ada", src: "https://x/y.png", size: .lg, shape: .rounded),
            AvatarDescriptor(name: "Ada", showTooltip: true)
        ]
        for descriptor in descriptors {
            _ = Avatar(descriptor)
        }
        _ = Avatar(name: "Grace Hopper", status: .idle)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAvatarTelemetry: AvatarTelemetry, @unchecked Sendable {
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
