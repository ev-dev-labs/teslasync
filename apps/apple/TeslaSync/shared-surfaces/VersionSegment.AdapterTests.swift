//
//  VersionSegment.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + projection): the surface identity + cadences +
//  release-notes URL, the uptime formatter (web `uptimeLabel`), the `appVersion` resolution order, the
//  projector across loading / empty / error / ready and every modal-row presence guard, the dot rule, the
//  platform-label join, the tooltip + VoiceOver builders, and value-type equality. Split from
//  VersionSegment.ModelTests.swift (the state-holder half) to keep each file within the SwiftLint
//  file-length budget. The derivation is pure — no network, no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class VersionSegmentSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(VersionSegmentSurface.slug, "VersionSegment")
        XCTAssertEqual(VersionSegment.surfaceSlug, "VersionSegment")
    }

    func testCadencesMatchWeb() {
        XCTAssertEqual(VersionSegmentSurface.versionPollInterval, 60)
        XCTAssertEqual(VersionSegmentSurface.updatePollInterval, 60 * 60)
    }

    func testReleaseNotesURLMatchesWeb() {
        XCTAssertEqual(
            VersionSegmentSurface.releaseNotesURL.absoluteString,
            "https://github.com/ev-dev-labs/teslasync/releases"
        )
    }

    func testConnectionAxisCoversTheThreeLeafStates() {
        XCTAssertEqual(VersionSegmentConnection.allCases, [.live, .stale, .offline])
    }

    func testDevBuildInfoIsTheWebWorstCase() {
        XCTAssertEqual(VersionSegmentBuildInfo.dev.buildVersion, "dev")
        XCTAssertEqual(VersionSegmentBuildInfo.dev.buildSHA, "dev")
    }
}

// MARK: - Uptime formatter (web `uptimeLabel`)

final class VersionUptimeFormatterTests: XCTestCase {
    func testNilNonFiniteAndNonPositiveReturnNil() {
        XCTAssertNil(VersionUptimeFormatter.label(nil))
        XCTAssertNil(VersionUptimeFormatter.label(0))
        XCTAssertNil(VersionUptimeFormatter.label(-5))
        XCTAssertNil(VersionUptimeFormatter.label(.infinity))
        XCTAssertNil(VersionUptimeFormatter.label(.nan))
    }

    func testMinutesBranch() {
        XCTAssertEqual(VersionUptimeFormatter.label(30), "0m")
        XCTAssertEqual(VersionUptimeFormatter.label(90), "1m")
        XCTAssertEqual(VersionUptimeFormatter.label(3599), "59m")
    }

    func testHoursBranch() {
        XCTAssertEqual(VersionUptimeFormatter.label(3600), "1h 0m")
        XCTAssertEqual(VersionUptimeFormatter.label(3661), "1h 1m")
    }

    func testDaysBranch() {
        XCTAssertEqual(VersionUptimeFormatter.label(90000), "1d 1h")
        XCTAssertEqual(VersionUptimeFormatter.label(273_600), "3d 4h")
    }
}

// MARK: - appVersion resolution order (web `server && !== 'unknown' ? server : build`)

final class VersionSegmentResolutionTests: XCTestCase {
    func testServerTruthWins() {
        XCTAssertEqual(VersionSegmentProjection.resolveAppVersion(server: "2026.6.2", build: "dev"), "2026.6.2")
    }

    func testUnknownServerFallsToBuild() {
        XCTAssertEqual(VersionSegmentProjection.resolveAppVersion(server: "unknown", build: "1.2.3"), "1.2.3")
    }

    func testEmptyServerFallsToBuild() {
        XCTAssertEqual(VersionSegmentProjection.resolveAppVersion(server: "  ", build: "1.2.3"), "1.2.3")
    }

    func testBuildOnly() {
        XCTAssertEqual(VersionSegmentProjection.resolveAppVersion(server: nil, build: "dev"), "dev")
    }

    func testNothingResolvesToNil() {
        XCTAssertNil(VersionSegmentProjection.resolveAppVersion(server: nil, build: nil))
        XCTAssertNil(VersionSegmentProjection.resolveAppVersion(server: "unknown", build: ""))
    }
}

// MARK: - Projector (combined input → resolved)

final class VersionSegmentProjectorTests: XCTestCase {
    private func resolve(
        _ snapshot: VersionSegmentSnapshot,
        build: VersionSegmentBuildInfo = VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)
    ) -> VersionSegmentResolved {
        VersionSegmentProjection.resolve(VersionSegmentInput(snapshot: snapshot, buildInfo: build))
    }

    func testReadyWithDevBuildAlways() {
        // The default dev build resolves a version, so the leaf states never trigger in production.
        let result = VersionSegmentProjection.resolve(VersionSegmentInput(snapshot: VersionSegmentSnapshot()))
        XCTAssertEqual(result.phase, .ready)
        XCTAssertEqual(result.data?.appVersion, "dev")
        XCTAssertFalse(result.data?.hasSHA ?? true)
    }

    func testLoadingWhenNoVersionAndProbeInFlight() {
        XCTAssertEqual(resolve(VersionSegmentSnapshot(isLoading: true)).phase, .loading)
    }

    func testErrorWhenNoVersionAndProbeFailed() {
        XCTAssertEqual(resolve(VersionSegmentSnapshot(errorMessage: "boom")).phase, .error("boom"))
    }

    func testErrorTakesPrecedenceOverLoading() {
        let result = resolve(VersionSegmentSnapshot(isLoading: true, errorMessage: "boom"))
        XCTAssertEqual(result.phase, .error("boom"))
    }

    func testEmptyErrorMessageIsNotAnError() {
        XCTAssertEqual(resolve(VersionSegmentSnapshot(isLoading: true, errorMessage: "")).phase, .loading)
    }

    func testEmptyWhenResolvedWithNoVersion() {
        XCTAssertEqual(resolve(VersionSegmentSnapshot()).phase, .empty)
    }

    func testReadyFromServerVersion() {
        let result = resolve(VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "9.9.9")))
        XCTAssertEqual(result.phase, .ready)
        XCTAssertEqual(result.data?.appVersion, "9.9.9")
    }

    func testShaAndHasShaFromBuild() {
        let dev = VersionSegmentProjection.resolve(VersionSegmentInput(
            snapshot: VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1.0")),
            buildInfo: VersionSegmentBuildInfo(buildVersion: "1.0", buildSHA: "dev")
        ))
        XCTAssertEqual(dev.data?.sha, "dev")
        XCTAssertFalse(dev.data?.hasSHA ?? true)

        let real = VersionSegmentProjection.resolve(VersionSegmentInput(
            snapshot: VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1.0")),
            buildInfo: VersionSegmentBuildInfo(buildVersion: "1.0", buildSHA: "a1b2c3d")
        ))
        XCTAssertEqual(real.data?.sha, "a1b2c3d")
        XCTAssertTrue(real.data?.hasSHA ?? false)
    }

    func testUpdateAndChangelogFields() {
        let result = resolve(VersionSegmentSnapshot(
            versionInfo: VersionInfo(appVersion: "1.0"),
            updateCheck: UpdateCheckResult(updateAvailable: true, latest: "2.0", message: "fixes"),
            changelogUnseenCount: 4
        ))
        XCTAssertTrue(result.data?.updateAvailable ?? false)
        XCTAssertEqual(result.data?.latestVersion, "2.0")
        XCTAssertEqual(result.data?.updateMessage, "fixes")
        XCTAssertTrue(result.data?.hasUnseenChangelog ?? false)
        XCTAssertEqual(result.data?.unseenChangelogCount, 4)
    }
}

// MARK: - Dot rule (web amber update > cyan unseen > none)

final class VersionSegmentDotTests: XCTestCase {
    private func data(update: Bool, unseen: Bool) -> VersionSegmentData {
        VersionSegmentData(
            appVersion: "1.0", sha: "dev", hasSHA: false, updateAvailable: update,
            latestVersion: nil, updateMessage: nil, uptimeLabel: nil,
            hasUnseenChangelog: unseen, unseenChangelogCount: unseen ? 1 : 0, provenanceRows: []
        )
    }

    func testUpdateWinsOverUnseen() {
        XCTAssertEqual(data(update: true, unseen: true).dot, .update)
    }

    func testUnseenWhenNoUpdate() {
        XCTAssertEqual(data(update: false, unseen: true).dot, .unseenChangelog)
    }

    func testNoneWhenNeither() {
        XCTAssertEqual(data(update: false, unseen: false).dot, .none)
    }
}

// MARK: - Provenance rows + platform label (web `<dl>` presence guards)

final class VersionSegmentProvenanceTests: XCTestCase {
    private func rows(_ info: VersionInfo?, uptime: String? = nil) -> [VersionProvenanceRow] {
        VersionSegmentProjection.provenanceRows(appVersion: "1.0", sha: "abc", info: info, uptime: uptime)
    }

    func testAlwaysIncludesAppVersionAndCommit() {
        let result = rows(nil)
        XCTAssertEqual(result.map(\.id), ["appVersion", "commit"])
        XCTAssertEqual(result[0].value, "v1.0")
        XCTAssertEqual(result[1].value, "abc")
        XCTAssertTrue(result[0].mono)
    }

    func testChartSkippedWhenUnknownOrAbsent() {
        XCTAssertFalse(rows(VersionInfo(chartVersion: "unknown")).contains { $0.id == "chart" })
        XCTAssertFalse(rows(VersionInfo(chartVersion: nil)).contains { $0.id == "chart" })
        let withChart = rows(VersionInfo(chartVersion: "1.4.0"))
        XCTAssertEqual(withChart.first { $0.id == "chart" }?.value, "v1.4.0")
    }

    func testGoAndUptimeRows() {
        let withGo = rows(VersionInfo(goVersion: "go1.25"))
        XCTAssertEqual(withGo.first { $0.id == "go" }?.value, "go1.25")
        let withUptime = rows(nil, uptime: "3d 4h")
        let uptimeRow = withUptime.first { $0.id == "uptime" }
        XCTAssertEqual(uptimeRow?.value, "3d 4h")
        XCTAssertFalse(uptimeRow?.mono ?? true)
    }

    func testPlatformLabelJoins() {
        XCTAssertEqual(VersionSegmentProjection.platformLabel(os: "linux", arch: "arm64"), "linux/arm64")
        XCTAssertEqual(VersionSegmentProjection.platformLabel(os: "linux", arch: nil), "linux")
        XCTAssertEqual(VersionSegmentProjection.platformLabel(os: nil, arch: "arm64"), "arm64")
        XCTAssertNil(VersionSegmentProjection.platformLabel(os: nil, arch: "  "))
    }
}

// MARK: - Accessibility (tooltip + VoiceOver label)

final class VersionSegmentAccessibilityTests: XCTestCase {
    func testTooltipJoinsNonEmptyWithMiddleDot() {
        let result = VersionSegmentAccessibility.tooltip(parts: ["TeslaSync version", "v1.0", "", "up 2h 3m"])
        XCTAssertEqual(result, "TeslaSync version · v1.0 · up 2h 3m")
    }

    func testSegmentLabelWithShaAndUnseen() {
        let label = VersionSegmentAccessibility.segmentLabel(
            versionLabel: "TeslaSync version", appVersion: "1.0", sha: "abc", hasSHA: true,
            unseenLabel: "unseen changelog"
        )
        XCTAssertEqual(label, "TeslaSync version: v1.0 (abc), unseen changelog")
    }

    func testSegmentLabelWithoutShaOrUnseen() {
        let label = VersionSegmentAccessibility.segmentLabel(
            versionLabel: "TeslaSync version", appVersion: "1.0", sha: "dev", hasSHA: false, unseenLabel: nil
        )
        XCTAssertEqual(label, "TeslaSync version: v1.0")
    }
}

// MARK: - Value-type equality

final class VersionSegmentValueTypeTests: XCTestCase {
    func testSnapshotEquality() {
        let lhs = VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1.0"), connection: .stale)
        let rhs = VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1.0"), connection: .stale)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1.1"), connection: .stale))
    }

    func testProbeOutcomeEquality() {
        XCTAssertEqual(VersionInfoProbeOutcome.info(VersionInfo(appVersion: "1")), .info(VersionInfo(appVersion: "1")))
        XCTAssertEqual(
            UpdateCheckProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: true)
        )
        XCTAssertNotEqual(
            UpdateCheckProbeOutcome.failed(message: "x", offline: true),
            .failed(message: "x", offline: false)
        )
    }
}
