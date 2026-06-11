//
//  AchievementUnlockListener.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  Pure-core coverage for the AchievementUnlockListener adapter — the verbatim ports of the web
//  helpers, asserted in isolation (Foundation only, no store, no view):
//    • AchievementUnlockListenerQueue — the `useAchievementUnlocks` reducer (de-dupe by id, newest-
//      first prepend, MAX_RECENT bound, blank-id drop, dismiss filter).
//    • AchievementUnlockListenerRoute — the `navigate('/lifetime?achievement=' + encodeURIComponent)`
//      deep link across plain / spaced / reserved / unreserved / non-ASCII ids.
//    • AchievementUnlockListenerChimeSpec — the verbatim WebAudio tone parameters.
//    • AchievementUnlockListenerAccessibility — the toast + stack VoiceOver label composition.
//    • AchievementUnlockListenerMeta — the static diagnostics slug.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let passthroughStrings: AchievementUnlockListenerResolve = { _, fallback in fallback }

private func event(id: String) -> AchievementUnlockListenerEvent {
    AchievementUnlockListenerEvent(
        vehicleID: 1,
        unlockedAt: nil,
        achievement: AchievementUnlockListenerAchievement(id: id, name: "Name", detail: "Detail", icon: "🏆")
    )
}

// MARK: - Unlock queue (web `useAchievementUnlocks` reducer)

final class AchievementUnlockListenerQueueTests: XCTestCase {
    func testInsertingPrependsNewestFirst() {
        let result = AchievementUnlockListenerQueue.inserting(event(id: "b"), into: [event(id: "a")])
        XCTAssertEqual(result.map(\.id), ["b", "a"])
    }

    func testInsertingDeDupesById() {
        let queue = [event(id: "a"), event(id: "b")]
        let result = AchievementUnlockListenerQueue.inserting(event(id: "a"), into: queue)
        XCTAssertEqual(result.map(\.id), ["a", "b"])
    }

    func testInsertingDropsBlankId() {
        let result = AchievementUnlockListenerQueue.inserting(event(id: ""), into: [event(id: "a")])
        XCTAssertEqual(result.map(\.id), ["a"])
    }

    func testInsertingBoundsToMaxRecent() {
        let seed = (0 ..< AchievementUnlockListenerLimits.maxRecent).map { event(id: "q\($0)") }
        let result = AchievementUnlockListenerQueue.inserting(event(id: "new"), into: seed)
        XCTAssertEqual(result.count, AchievementUnlockListenerLimits.maxRecent)
        XCTAssertEqual(result.first?.id, "new")
        XCTAssertFalse(result.contains { $0.id == "q\(AchievementUnlockListenerLimits.maxRecent - 1)" })
    }

    func testRemovingFiltersById() {
        let queue = [event(id: "a"), event(id: "b")]
        XCTAssertEqual(AchievementUnlockListenerQueue.removing(id: "a", from: queue).map(\.id), ["b"])
    }
}

// MARK: - Deep link (web `encodeURIComponent`)

final class AchievementUnlockListenerRouteTests: XCTestCase {
    private func route(_ id: String) -> String {
        AchievementUnlockListenerRoute.lifetime(achievementID: id)
    }

    func testPlainIdIsUnchanged() {
        XCTAssertEqual(route("road-warrior"), "/lifetime?achievement=road-warrior")
    }

    func testSpaceEncodesToPercent20() {
        XCTAssertEqual(route("a b"), "/lifetime?achievement=a%20b")
    }

    func testReservedCharactersEncode() {
        XCTAssertEqual(route("a/b"), "/lifetime?achievement=a%2Fb")
        XCTAssertEqual(route("a&b=c"), "/lifetime?achievement=a%26b%3Dc")
    }

    func testUnreservedCharactersArePreserved() {
        XCTAssertEqual(route("tilde~star*paren()"), "/lifetime?achievement=tilde~star*paren()")
    }

    func testNonAsciiPercentEncodesUtf8() {
        XCTAssertEqual(route("café"), "/lifetime?achievement=caf%C3%A9")
    }
}

// MARK: - Chime spec (web WebAudio tone)

final class AchievementUnlockListenerChimeSpecTests: XCTestCase {
    func testCelebrationMatchesWebTone() {
        let spec = AchievementUnlockListenerChimeSpec.celebration
        XCTAssertEqual(spec.frequencies, [659.25, 987.77])
        XCTAssertEqual(spec.waveform, .triangle)
        XCTAssertEqual(spec.staggerSeconds, 0.12, accuracy: 0.0001)
        XCTAssertEqual(spec.noteDurationSeconds, 0.5, accuracy: 0.0001)
        XCTAssertEqual(spec.attackSeconds, 0.02, accuracy: 0.0001)
        XCTAssertEqual(spec.decaySeconds, 0.45, accuracy: 0.0001)
        XCTAssertEqual(spec.peakGain, 0.18, accuracy: 0.0001)
    }
}

// MARK: - Accessibility (toast + stack labels)

final class AchievementUnlockListenerAccessibilityTests: XCTestCase {
    func testToastLabelJoinsParts() {
        let label = AchievementUnlockListenerAccessibility.toastLabel(
            eyebrow: "Achievement Unlocked",
            name: "Road Warrior",
            detail: "Drove 1,000 km."
        )
        XCTAssertEqual(label, "Achievement Unlocked. Road Warrior. Drove 1,000 km.")
    }

    func testToastLabelSkipsEmptyDetail() {
        let label = AchievementUnlockListenerAccessibility.toastLabel(
            eyebrow: "Achievement Unlocked",
            name: "Road Warrior",
            detail: ""
        )
        XCTAssertEqual(label, "Achievement Unlocked. Road Warrior")
    }

    func testStackLabelAppendsOfflineNote() {
        XCTAssertEqual(
            AchievementUnlockListenerAccessibility.stackLabel(countPhrase: "1 new achievement", offlineNote: nil),
            "1 new achievement"
        )
        XCTAssertEqual(
            AchievementUnlockListenerAccessibility.stackLabel(
                countPhrase: "1 new achievement",
                offlineNote: "Offline"
            ),
            "1 new achievement, Offline"
        )
    }
}

// MARK: - Metadata (static identity)

final class AchievementUnlockListenerMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AchievementUnlockListenerMeta.surfaceSlug, "AchievementUnlockListener")
        XCTAssertEqual(AchievementUnlockListener.surfaceSlug, "AchievementUnlockListener")
    }
}
