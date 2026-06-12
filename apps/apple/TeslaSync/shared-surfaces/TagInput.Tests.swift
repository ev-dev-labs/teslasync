//
//  TagInput.Tests.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  Adapter + projection + seam coverage for the TagInput surface — the Swift port of the web behaviour
//  (components/forms/TagInput.tsx):
//    • normalise — trim + optional lowercase (web `normaliseTag`).
//    • splitTokens — JS `String.split(/[seps\r\n]+/)` parity (collapsing runs, leading / trailing empties,
//      always-on CR / LF).
//    • commit — add / duplicate (case-insensitive) / empty-skip / cap / validation / multi-add, preserving
//      the trailing fragment (web `tryAddOne` + `commitText`).
//    • removeAt — valid + out-of-range guard (web `removeAt`).
//    • announcementPadding — rotating `\u200B` mod-4 dedupe (web `announce`).
//    • interpolate / joinTags / fieldAccessibilityLabel — i18next + a11y string composition.
//    • Projection — error / loading / ready-empty / ready-populated / at-cap (web branches + P4 leaf).
//    • Seams — Live (start / update / commit-writeback / refresh) + InMemory (records commits / push).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store — each assertion reads
//  the pure core or the in-memory seam directly.
//

import XCTest
@testable import TeslaSync

// MARK: - normalise (web normaliseTag)

final class TagInputNormaliseTests: XCTestCase {
    func testTrimsSurroundingWhitespaceAndNewlines() {
        XCTAssertEqual(TagInputEngine.normalise("  Foo  ", lowercase: false), "Foo")
        XCTAssertEqual(TagInputEngine.normalise("\n\t bar \t", lowercase: false), "bar")
    }

    func testLowercaseFlagLowercasesAfterTrimming() {
        XCTAssertEqual(TagInputEngine.normalise("  Foo  ", lowercase: true), "foo")
        XCTAssertEqual(TagInputEngine.normalise("HTTP", lowercase: true), "http")
    }
}

// MARK: - splitTokens (web String.split(/[seps\r\n]+/))

final class TagInputSplitTests: XCTestCase {
    private let comma: [TagSeparator] = [.comma]

    func testSplitsOnSeparator() {
        XCTAssertEqual(TagInputEngine.splitTokens("a,b", separators: comma), ["a", "b"])
    }

    func testTrailingSeparatorYieldsTrailingEmpty() {
        XCTAssertEqual(TagInputEngine.splitTokens("a,b,", separators: comma), ["a", "b", ""])
    }

    func testLeadingSeparatorYieldsLeadingEmpty() {
        XCTAssertEqual(TagInputEngine.splitTokens(",a", separators: comma), ["", "a"])
    }

    func testConsecutiveSeparatorsCollapse() {
        XCTAssertEqual(TagInputEngine.splitTokens("a,,b", separators: comma), ["a", "b"])
    }

    func testEmptyStringYieldsSingleEmptyToken() {
        XCTAssertEqual(TagInputEngine.splitTokens("", separators: comma), [""])
    }

    func testLoneSeparatorYieldsTwoEmpties() {
        XCTAssertEqual(TagInputEngine.splitTokens(",", separators: comma), ["", ""])
    }

    func testNoSeparatorYieldsWholeString() {
        XCTAssertEqual(TagInputEngine.splitTokens("abc", separators: comma), ["abc"])
    }

    func testNewlinesAlwaysSplitEvenWhenNotConfigured() {
        XCTAssertEqual(TagInputEngine.splitTokens("a\nb\r\nc", separators: comma), ["a", "b", "c"])
    }

    func testSpaceSeparatorWhenConfigured() {
        XCTAssertEqual(TagInputEngine.splitTokens("a b c", separators: [.space]), ["a", "b", "c"])
    }
}

// MARK: - commit (web tryAddOne + commitText)

final class TagInputCommitTests: XCTestCase {
    private let comma: [TagSeparator] = [.comma]

    private func commit(
        _ text: String,
        into value: [String],
        lowercase: Bool = false,
        maxTags: Int? = nil,
        validate: ((String) -> String?)? = nil
    ) -> TagInputCommit {
        TagInputEngine.commit(
            text: text,
            into: value,
            separators: comma,
            lowercase: lowercase,
            maxTags: maxTags,
            validate: validate
        )
    }

    func testTypingWithoutSeparatorCommitsNothingAndKeepsRemainder() {
        let result = commit("foo", into: [])
        XCTAssertEqual(result.tags, [])
        XCTAssertEqual(result.remainder, "foo")
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.announcement, .none)
    }

    func testTrailingSeparatorCommitsAndClearsRemainder() {
        let result = commit("foo,", into: [])
        XCTAssertEqual(result.tags, ["foo"])
        XCTAssertEqual(result.remainder, "")
        XCTAssertEqual(result.committed, 1)
        XCTAssertEqual(result.announcement, .added(1))
    }

    func testMidStringSeparatorKeepsTrailingFragment() {
        let result = commit("foo,bar", into: [])
        XCTAssertEqual(result.tags, ["foo"])
        XCTAssertEqual(result.remainder, "bar")
        XCTAssertEqual(result.committed, 1)
    }

    func testMultipleAddedAnnouncesCount() {
        let result = commit("a,b,c,", into: [])
        XCTAssertEqual(result.tags, ["a", "b", "c"])
        XCTAssertEqual(result.committed, 3)
        XCTAssertEqual(result.announcement, .added(3))
    }

    func testDuplicateIsRejectedAndAnnounced() {
        let result = commit("foo,", into: ["foo"])
        XCTAssertEqual(result.tags, ["foo"])
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.announcement, .duplicate("foo"))
    }

    func testDuplicateCheckIsCaseInsensitive() {
        let result = commit("FOO,", into: ["foo"])
        XCTAssertEqual(result.tags, ["foo"])
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.announcement, .duplicate("FOO"))
    }

    func testEmptyFragmentsAreSkippedSilently() {
        let result = commit(",,", into: [])
        XCTAssertEqual(result.tags, [])
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.announcement, .none)
    }

    func testLowercaseStoresLowercased() {
        let result = commit("FooBar,", into: [], lowercase: true)
        XCTAssertEqual(result.tags, ["foobar"])
    }

    func testCapBlocksAndAnnouncesMaxReached() {
        let result = commit("c,", into: ["a", "b"], maxTags: 2)
        XCTAssertEqual(result.tags, ["a", "b"])
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.announcement, .maxReached)
    }

    func testValidationErrorBlocksCommitAndSuppressesAnnouncement() {
        let validate: (String) -> String? = { $0.count < 2 ? "Too short" : nil }
        let result = commit("a,", into: [], validate: validate)
        XCTAssertEqual(result.tags, [])
        XCTAssertEqual(result.committed, 0)
        XCTAssertEqual(result.error, "Too short")
        XCTAssertEqual(result.announcement, .none)
    }

    func testValidatorAcceptsValidTag() {
        let validate: (String) -> String? = { $0.count < 2 ? "Too short" : nil }
        let result = commit("abc,", into: [], validate: validate)
        XCTAssertEqual(result.tags, ["abc"])
        XCTAssertNil(result.error)
    }
}

// MARK: - removeAt (web removeAt)

final class TagInputRemoveTests: XCTestCase {
    func testRemovesAtIndex() {
        let result = TagInputEngine.removeAt(0, from: ["a", "b"])
        XCTAssertEqual(result.tags, ["b"])
        XCTAssertEqual(result.removed, "a")
    }

    func testOutOfRangeLeavesListUnchanged() {
        XCTAssertNil(TagInputEngine.removeAt(5, from: ["a"]).removed)
        XCTAssertNil(TagInputEngine.removeAt(-1, from: ["a"]).removed)
        XCTAssertEqual(TagInputEngine.removeAt(5, from: ["a"]).tags, ["a"])
    }
}

// MARK: - Announcement padding (web rotating \u200B dedupe)

final class TagInputPaddingTests: XCTestCase {
    func testPaddingRotatesModuloFour() {
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 0).count, 0)
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 1).count, 1)
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 2).count, 2)
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 3).count, 3)
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 4).count, 0)
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 5).count, 1)
    }

    func testPaddingUsesZeroWidthSpace() {
        XCTAssertEqual(TagInputEngine.announcementPadding(sequence: 1), TagInputEngine.zeroWidthSpace)
    }
}

// MARK: - Interpolation / join / a11y label

final class TagInputStringHelperTests: XCTestCase {
    func testInterpolateReplacesTokens() {
        XCTAssertEqual(TagInputEngine.interpolate("{{a}}-{{b}}", ["a": "1", "b": "2"]), "1-2")
    }

    func testJoinTags() {
        XCTAssertEqual(TagInputEngine.joinTags(["a", "b", "c"]), "a, b, c")
        XCTAssertEqual(TagInputEngine.joinTags([]), "")
    }

    func testFieldAccessibilityLabelFoldsSummary() {
        XCTAssertEqual(
            TagInputEngine.fieldAccessibilityLabel(label: "Tags", summary: "Tags: a, b"),
            "Tags, Tags: a, b"
        )
    }

    func testFieldAccessibilityLabelFallsBackToLabelWhenSummaryBlank() {
        XCTAssertEqual(TagInputEngine.fieldAccessibilityLabel(label: "Tags", summary: "   "), "Tags")
    }
}

// MARK: - Projection (web render branches + P4 leaf)

final class TagInputProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = TagInputProjection.resolve(
            TagInputSnapshot(tags: ["a"], isLoading: true, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testReadyEmptyRendersField() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: [], label: "Tags"))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertEqual(resolved.label, "Tags")
        XCTAssertNil(resolved.countText)
    }

    func testReadyPopulatedCarriesTags() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: ["a", "b"], label: "Tags"))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertFalse(resolved.isEmpty)
        XCTAssertEqual(resolved.tags, ["a", "b"])
    }

    func testCapComputesCountAndDisablesInput() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: ["a", "b"], maxTags: 2))
        XCTAssertTrue(resolved.atMax)
        XCTAssertTrue(resolved.isDisabled)
        XCTAssertEqual(resolved.countText, "2/2")
    }

    func testUnderCapShowsCountButEnablesInput() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: ["a"], maxTags: 3))
        XCTAssertFalse(resolved.atMax)
        XCTAssertFalse(resolved.isDisabled)
        XCTAssertEqual(resolved.countText, "1/3")
    }

    func testDisabledPropagatesToInputAndChips() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: ["a"], disabled: true))
        XCTAssertTrue(resolved.isDisabled)
        XCTAssertTrue(resolved.chipsDisabled)
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = TagInputProjection.resolve(TagInputSnapshot(tags: ["a"], errorMessage: ""))
        XCTAssertEqual(resolved.phase, .ready)
    }
}

// MARK: - Live source (production value bridge + commit write-back)

@MainActor
final class LiveTagInputSourceTests: XCTestCase {
    func testStartEmitsInitialValue() {
        let source = LiveTagInputSource(value: TagInputSnapshot(tags: ["a"]))
        var latest: TagInputSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        XCTAssertEqual(latest?.tags, ["a"])
    }

    func testUpdateReEmitsTheNewValue() {
        let source = LiveTagInputSource()
        var latest: TagInputSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(TagInputSnapshot(tags: ["x", "y"], label: "Tags"))
        XCTAssertEqual(latest?.tags, ["x", "y"])
        XCTAssertEqual(latest?.label, "Tags")
    }

    func testCommitForwardsToOnCommitAndReEmits() {
        var committed: [[String]] = []
        let source = LiveTagInputSource(onCommit: { committed.append($0) })
        var emissions: [[String]] = []
        source.onUpdate = { emissions.append($0.tags) }
        source.start()
        source.commit(["a", "b"])
        XCTAssertEqual(committed, [["a", "b"]])
        XCTAssertEqual(emissions.last, ["a", "b"])
    }

    func testRefreshReEmitsCurrentValue() {
        let source = LiveTagInputSource(value: TagInputSnapshot(tags: ["a"]))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - In-memory source (records commits / push)

@MainActor
final class InMemoryTagInputSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        let source = InMemoryTagInputSource(initial: TagInputSnapshot(tags: ["a"]))
        var latest: TagInputSnapshot?
        source.onUpdate = { latest = $0 }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(latest?.tags, ["a"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCommitIsRecordedAndPushEmits() {
        let source = InMemoryTagInputSource()
        var latest: TagInputSnapshot?
        source.onUpdate = { latest = $0 }
        source.commit(["a"])
        source.commit(["a", "b"])
        source.push(TagInputSnapshot(tags: ["z"]))
        XCTAssertEqual(source.committed, [["a"], ["a", "b"]])
        XCTAssertEqual(latest?.tags, ["z"])
    }
}
