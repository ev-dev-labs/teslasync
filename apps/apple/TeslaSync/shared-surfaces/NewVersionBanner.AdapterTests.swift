//
//  NewVersionBanner.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity + poll cadence, the
//  watcher snapshot's `newVersionAvailable` rule (web `boot && latest && latest !== boot`), the
//  projector (combined input → view-ready resolved, across loading / empty / error / available and the
//  per-version dismissal guard), the dismissal-reset rule (web effect), the VoiceOver label builder,
//  and value-type equality. Split from NewVersionBanner.ModelTests.swift (the state-holder / seams
//  half) to keep each file within the SwiftLint file-length budget. The derivation is pure — no
//  network, no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class NewVersionBannerSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(NewVersionBannerSurface.slug, "NewVersionBanner")
        XCTAssertEqual(NewVersionBanner.surfaceSlug, "NewVersionBanner")
    }

    func testPollIntervalMatchesWebFiveMinutes() {
        XCTAssertEqual(NewVersionBannerSurface.pollInterval, 5 * 60)
    }

    func testConnectionAxisCoversTheThreeLeafStates() {
        XCTAssertEqual(NewVersionConnection.allCases, [.live, .stale, .offline])
    }
}

// MARK: - Watcher snapshot (web `useVersionWatcher` availability rule)

final class NewVersionWatcherSnapshotTests: XCTestCase {
    func testAvailableWhenBaselineAndLatestDiffer() {
        let snapshot = NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.1")
        XCTAssertTrue(snapshot.newVersionAvailable)
    }

    func testNotAvailableWhenEqual() {
        let snapshot = NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.0")
        XCTAssertFalse(snapshot.newVersionAvailable)
    }

    func testNotAvailableWithoutBaseline() {
        XCTAssertFalse(NewVersionWatcherSnapshot(latestVersion: "1.1").newVersionAvailable)
    }

    func testNotAvailableWithoutLatest() {
        XCTAssertFalse(NewVersionWatcherSnapshot(bootVersion: "1.0").newVersionAvailable)
    }
}

// MARK: - Projector (combined input → resolved)

final class NewVersionBannerProjectorTests: XCTestCase {
    private func resolve(
        boot: String? = nil,
        latest: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        dismissed: String? = nil
    ) -> NewVersionBannerResolved {
        NewVersionBannerProjection.resolve(NewVersionBannerInput(
            snapshot: NewVersionWatcherSnapshot(
                bootVersion: boot,
                latestVersion: latest,
                isLoading: isLoading,
                errorMessage: errorMessage
            ),
            dismissedVersion: dismissed
        ))
    }

    func testErrorTakesPrecedence() {
        let result = resolve(boot: "1.0", latest: "1.1", isLoading: true, errorMessage: "boom")
        XCTAssertEqual(result.phase, .error("boom"))
        XCTAssertNil(result.data)
    }

    func testEmptyErrorMessageIsNotAnError() {
        XCTAssertEqual(resolve(isLoading: true, errorMessage: "").phase, .loading)
    }

    func testLoadingWhileBootProbeInFlight() {
        XCTAssertEqual(resolve(isLoading: true).phase, .loading)
    }

    func testEmptyWhenUpToDate() {
        XCTAssertEqual(resolve(boot: "1.0", latest: "1.0").phase, .empty)
    }

    func testEmptyWhileStillBaselining() {
        XCTAssertEqual(resolve(latest: "1.0").phase, .empty)
    }

    func testAvailableWhenNewVersionAndNotDismissed() {
        let result = resolve(boot: "1.0", latest: "1.1")
        XCTAssertEqual(result.phase, .available)
        XCTAssertEqual(result.data, NewVersionBannerData(latestVersion: "1.1", bootVersion: "1.0"))
    }

    func testDismissedForCurrentVersionIsEmpty() {
        XCTAssertEqual(resolve(boot: "1.0", latest: "1.1", dismissed: "1.1").phase, .empty)
    }

    func testDismissedForOlderVersionStillShows() {
        // Dismissed 1.1, but the deploy advanced to 1.2 → the banner re-surfaces.
        let result = resolve(boot: "1.0", latest: "1.2", dismissed: "1.1")
        XCTAssertEqual(result.phase, .available)
        XCTAssertEqual(result.data?.latestVersion, "1.2")
    }
}

// MARK: - Dismissal reset (web `useEffect`)

final class NewVersionDismissalResetTests: XCTestCase {
    func testKeepsDismissalWhenItMatchesLatest() {
        XCTAssertEqual(
            NewVersionDismissalReset.resolve(dismissedVersion: "1.1", latestVersion: "1.1"),
            "1.1"
        )
    }

    func testClearsDismissalWhenLatestAdvances() {
        XCTAssertNil(NewVersionDismissalReset.resolve(dismissedVersion: "1.1", latestVersion: "1.2"))
    }

    func testKeepsDismissalWhenLatestUnknown() {
        XCTAssertEqual(
            NewVersionDismissalReset.resolve(dismissedVersion: "1.1", latestVersion: nil),
            "1.1"
        )
    }

    func testNilDismissalStaysNil() {
        XCTAssertNil(NewVersionDismissalReset.resolve(dismissedVersion: nil, latestVersion: "1.2"))
    }
}

// MARK: - Accessibility label

final class NewVersionBannerAccessibilityTests: XCTestCase {
    func testLabelAppendsVersionDetailWithSeparator() {
        let label = NewVersionBannerAccessibility.bannerLabel(
            message: "A new version of TeslaSync is available.",
            versionDetail: "Version 1.1"
        )
        XCTAssertEqual(label, "A new version of TeslaSync is available. Version 1.1")
    }

    func testLabelAddsPeriodWhenMessageLacksTerminal() {
        let label = NewVersionBannerAccessibility.bannerLabel(message: "Update ready", versionDetail: "Version 2")
        XCTAssertEqual(label, "Update ready. Version 2")
    }

    func testLabelIsJustMessageWhenNoDetail() {
        XCTAssertEqual(
            NewVersionBannerAccessibility.bannerLabel(message: "Update ready.", versionDetail: nil),
            "Update ready."
        )
        XCTAssertEqual(
            NewVersionBannerAccessibility.bannerLabel(message: "Update ready.", versionDetail: ""),
            "Update ready."
        )
    }
}

// MARK: - Value-type equality

final class NewVersionBannerValueTypeTests: XCTestCase {
    func testSnapshotEquality() {
        let lhs = NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.1", connection: .stale)
        let rhs = NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.1", connection: .stale)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.2", connection: .stale))
    }

    func testProbeOutcomeEquality() {
        XCTAssertEqual(NewVersionProbeOutcome.version("1.0"), .version("1.0"))
        XCTAssertNotEqual(NewVersionProbeOutcome.version("1.0"), .version("1.1"))
        XCTAssertEqual(
            NewVersionProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: true)
        )
        XCTAssertNotEqual(
            NewVersionProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: false)
        )
    }
}
