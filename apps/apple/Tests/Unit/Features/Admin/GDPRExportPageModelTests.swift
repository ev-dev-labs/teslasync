import XCTest
@testable import TeslaSync

/// State-machine tests for `GDPRExportPageModel` — every data state the page renders
/// (idle / loading / success / not-found / unavailable / error), the lookup intent +
/// input trimming, the download-availability derivation, the status wire-fold + tone
/// mapping, and the display-boundary formatters (`formatBytes` / `formatRelative` /
/// `formatDateTime`) ported from the web.
@MainActor final class GDPRExportPageModelTests: XCTestCase {
    private struct StubSource: GDPRExportDataSource {
        var artifact: GDPRExportArtifact?
        var notFound = false
        var unavailable = false
        var fails = false

        func load(id: String) async throws -> GDPRExportArtifact {
            if notFound { throw GDPRArtifactNotFound() }
            if unavailable { throw GDPRSubsystemUnavailable() }
            if fails { throw StubError() }
            return artifact ?? GDPRExportPageModelTests.artifact(id: id, status: .complete)
        }
    }

    private struct StubError: Error {}

    private static func artifact(
        id: String = "abc",
        status: GDPRArtifactStatus = .complete,
        bytes: Int64? = 2048,
        sha256: String? = "deadbeef",
        storage: String? = "s3",
        error: String? = nil
    ) -> GDPRExportArtifact {
        GDPRExportArtifact(
            id: id,
            userID: "u1",
            status: status,
            format: "zip",
            bytes: bytes,
            sha256: sha256,
            storage: storage,
            createdAt: "2026-06-12T17:04:00Z",
            completedAt: status == .complete ? "2026-06-12T17:06:30Z" : nil,
            expiresAt: "2026-06-19T17:06:30Z",
            error: error
        )
    }

    // MARK: - Initial state

    func testInitialStateIsIdleWithoutSeed() {
        let model = GDPRExportPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.hasActiveLookup)
        XCTAssertNil(model.artifact)
        XCTAssertFalse(model.canDownload)
    }

    func testInitialStateIsLoadingWhenSeeded() {
        let model = GDPRExportPageModel(dataSource: StubSource(), initialID: "  seed-id  ")
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.hasActiveLookup)
        XCTAssertEqual(model.idInput, "seed-id")
        XCTAssertEqual(model.activeId, "seed-id")
    }

    // MARK: - Load outcomes

    func testLoadSuccessPopulatesArtifact() async {
        let model = GDPRExportPageModel(dataSource: StubSource(), initialID: "abc")
        await model.load()
        XCTAssertEqual(model.artifact?.id, "abc")
        XCTAssertTrue(model.canDownload)
        XCTAssertEqual(model.downloadHref, "/api/v1/admin/gdpr/exports/abc/download")
        XCTAssertEqual(model.downloadURL?.absoluteString, "http://localhost:8080/api/v1/admin/gdpr/exports/abc/download")
    }

    func testLoadNotFoundYieldsNotFoundState() async {
        let model = GDPRExportPageModel(dataSource: StubSource(notFound: true), initialID: "abc")
        await model.load()
        XCTAssertEqual(model.state, .notFound)
        XCTAssertTrue(model.isNotFound)
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testLoadUnavailableYieldsUnavailableState() async {
        let model = GDPRExportPageModel(dataSource: StubSource(unavailable: true), initialID: "abc")
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
        XCTAssertFalse(model.isNotFound)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = GDPRExportPageModel(dataSource: StubSource(fails: true), initialID: "abc")
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    func testLoadWithoutActiveIdStaysIdle() async {
        let model = GDPRExportPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .idle)
    }

    func testLoadIfNeededSkipsWhenAlreadyLoaded() async {
        let model = GDPRExportPageModel(dataSource: StubSource(), initialID: "abc")
        await model.load()
        let before = model.artifact?.id
        await model.loadIfNeeded()
        XCTAssertEqual(model.artifact?.id, before)
    }

    // MARK: - Lookup intent

    func testLookupSetsActiveIdAndTrims() async {
        let model = GDPRExportPageModel(dataSource: StubSource())
        model.idInput = "  xyz-123  "
        await model.lookup()
        XCTAssertEqual(model.activeId, "xyz-123")
        XCTAssertEqual(model.artifact?.id, "xyz-123")
    }

    func testLookupIgnoresBlankInput() async {
        let model = GDPRExportPageModel(dataSource: StubSource())
        model.idInput = "   "
        await model.lookup()
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.hasActiveLookup)
    }

    func testCanLookupReflectsTrimmedInput() {
        let model = GDPRExportPageModel(dataSource: StubSource())
        XCTAssertFalse(model.canLookup)
        model.idInput = "   "
        XCTAssertFalse(model.canLookup)
        model.idInput = "id"
        XCTAssertTrue(model.canLookup)
    }

    func testRefreshReloads() async {
        let model = GDPRExportPageModel(dataSource: StubSource(), initialID: "abc")
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.artifact?.id, "abc")
    }

    // MARK: - Download derivation (web `downloadUrl` ternary)

    func testCanDownloadOnlyWhenComplete() async {
        let running = StubSource(artifact: Self.artifact(status: .running))
        let model = GDPRExportPageModel(dataSource: running, initialID: "abc")
        await model.load()
        XCTAssertFalse(model.canDownload)
        XCTAssertNil(model.downloadHref)
        XCTAssertNil(model.downloadURL)
        XCTAssertEqual(model.downloadUnavailableKey, "admin.gdprExport.downloadWait")
    }

    func testDownloadUnavailableKeyByStatus() async {
        for (status, key) in [
            (GDPRArtifactStatus.queued, "admin.gdprExport.downloadWait"),
            (GDPRArtifactStatus.running, "admin.gdprExport.downloadWait"),
            (GDPRArtifactStatus.expired, "admin.gdprExport.downloadExpired"),
            (GDPRArtifactStatus.failed, "admin.gdprExport.downloadFailed")
        ] {
            let model = GDPRExportPageModel(
                dataSource: StubSource(artifact: Self.artifact(status: status)),
                initialID: "abc"
            )
            await model.load()
            XCTAssertEqual(model.downloadUnavailableKey, key, "status \(status)")
        }
    }

    func testDownloadHrefPercentEncodesId() async {
        let model = GDPRExportPageModel(
            dataSource: StubSource(artifact: Self.artifact(id: "a b/c", status: .complete)),
            initialID: "x"
        )
        await model.load()
        XCTAssertEqual(model.downloadHref, "/api/v1/admin/gdpr/exports/a%20b%2Fc/download")
    }

    // MARK: - Status fold + tone (web `GDPRArtifactStatus` / `STATUS_VARIANT`)

    func testStatusWireFold() {
        XCTAssertEqual(GDPRArtifactStatus(wire: "complete"), .complete)
        XCTAssertEqual(GDPRArtifactStatus(wire: "queued"), .queued)
        XCTAssertEqual(GDPRArtifactStatus(wire: "expired"), .expired)
        XCTAssertEqual(GDPRArtifactStatus(wire: "bogus"), .unknown)
    }

    func testStatusToneMapping() {
        XCTAssertEqual(GDPRArtifactStatus.queued.tone, .info)
        XCTAssertEqual(GDPRArtifactStatus.running.tone, .info)
        XCTAssertEqual(GDPRArtifactStatus.complete.tone, .success)
        XCTAssertEqual(GDPRArtifactStatus.failed.tone, .danger)
        XCTAssertEqual(GDPRArtifactStatus.expired.tone, .warning)
        XCTAssertEqual(GDPRArtifactStatus.unknown.tone, .neutral)
    }

    // MARK: - Formatters (web `formatBytes` / `formatRelative` / `formatDateTime`)

    func testFormatBytesBinaryUnits() {
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(0)), "0 B")
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(512)), "512 B")
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(1024)), "1.0 KB")
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(1536)), "1.5 KB")
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(1_048_576)), "1.0 MB")
        XCTAssertEqual(GDPRExportFormat.bytes(Int64(1_073_741_824)), "1.0 GB")
    }

    func testFormatBytesEmptyForNilAndNonFinite() {
        XCTAssertEqual(GDPRExportFormat.bytes(nil as Int64?), "—")
        XCTAssertEqual(GDPRExportFormat.bytes(Double.infinity), "—")
        XCTAssertEqual(GDPRExportFormat.bytes(Double.nan), "—")
    }

    func testRelativeThresholds() {
        let now = GDPRExportFormat.parseISO("2026-06-12T18:00:00Z")!
        XCTAssertEqual(GDPRExportFormat.relative("2026-06-12T17:59:30Z", now: now), "just now")
        XCTAssertEqual(GDPRExportFormat.relative("2026-06-12T17:30:00Z", now: now), "30m ago")
        XCTAssertEqual(GDPRExportFormat.relative("2026-06-12T15:00:00Z", now: now), "3h ago")
        XCTAssertEqual(GDPRExportFormat.relative("2026-06-10T18:00:00Z", now: now), "2d ago")
    }

    func testRelativeAndDateTimeEmptyForBadInput() {
        XCTAssertEqual(GDPRExportFormat.relative(nil), "—")
        XCTAssertEqual(GDPRExportFormat.relative("not-a-date"), "—")
        XCTAssertEqual(GDPRExportFormat.dateTime(nil), "—")
        XCTAssertEqual(GDPRExportFormat.dateTime(""), "—")
        XCTAssertEqual(GDPRExportFormat.dateTime("garbage"), "—")
    }

    func testParseISOHandlesFractionalSeconds() {
        XCTAssertNotNil(GDPRExportFormat.parseISO("2026-06-12T17:06:30.500Z"))
        XCTAssertNotNil(GDPRExportFormat.parseISO("2026-06-12T17:06:30Z"))
    }

    // MARK: - Default seed

    func testSampleDataSourceIsWellFormed() async throws {
        let artifact = try await SampleGDPRExportDataSource().load(id: "lookup-id")
        XCTAssertEqual(artifact.id, "lookup-id")
        XCTAssertEqual(artifact.status, .complete)
        XCTAssertNotNil(artifact.bytes)
        XCTAssertNotNil(artifact.sha256)
        XCTAssertFalse(artifact.format.isEmpty)
    }
}
