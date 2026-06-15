import XCTest
@testable import TeslaSync

// MARK: - Page model + catalog tests

@MainActor
final class DevToolsPageModelTests: XCTestCase {
    func testInitialTabIsFleetAPI() {
        let model = DevToolsPageModel()
        XCTAssertEqual(model.selectedTab, .fleetAPI)
        XCTAssertEqual(model.toolSearch, "")
        XCTAssertNil(model.expandedToolID)
    }

    func testInitialTabOverride() {
        let model = DevToolsPageModel(selectedTab: .utilities)
        XCTAssertEqual(model.selectedTab, .utilities)
    }

    func testSelectTab() {
        let model = DevToolsPageModel()
        model.select(.telemetry)
        XCTAssertEqual(model.selectedTab, .telemetry)
    }

    func testSearchFiltersTools() {
        let model = DevToolsPageModel()
        model.toolSearch = "base64"
        XCTAssertEqual(model.filteredTools.map(\.id), ["base64"])
        XCTAssertTrue(model.hasToolMatches)
    }

    func testSearchNoMatchYieldsEmpty() {
        let model = DevToolsPageModel()
        model.toolSearch = "zzzznotatool"
        XCTAssertTrue(model.filteredTools.isEmpty)
        XCTAssertFalse(model.hasToolMatches)
    }

    func testEmptySearchReturnsAllTools() {
        let model = DevToolsPageModel()
        model.toolSearch = "   "
        XCTAssertEqual(model.filteredTools.count, DevToolsCatalog.utilityTools.count)
    }

    func testToggleToolExpansion() {
        let model = DevToolsPageModel()
        model.toggleTool("vin")
        XCTAssertEqual(model.expandedToolID, "vin")
        XCTAssertTrue(model.isToolExpanded("vin"))
        model.toggleTool("vin")
        XCTAssertNil(model.expandedToolID)
    }

    func testToggleCollapsesPrevious() {
        let model = DevToolsPageModel()
        model.toggleTool("vin")
        model.toggleTool("json")
        XCTAssertEqual(model.expandedToolID, "json")
        XCTAssertFalse(model.isToolExpanded("vin"))
    }

    func testCatalogCounts() {
        XCTAssertEqual(DevToolsTab.allCases.count, 5)
        XCTAssertEqual(DevToolsCatalog.onboardingSteps.count, 7)
        XCTAssertEqual(DevToolsCatalog.teslaEndpoints.count, 11)
        XCTAssertEqual(DevToolsCatalog.telemetryCategories.count, 12)
        XCTAssertEqual(DevToolsCatalog.infraTools.count, 5)
        XCTAssertEqual(DevToolsCatalog.referenceLinks.count, 4)
        XCTAssertEqual(DevToolsCatalog.utilityTools.count, 15)
    }

    func testTelemetryFieldTotalMatchesSum() {
        let sum = DevToolsCatalog.telemetryCategories.reduce(0) { $0 + $1.fields.count }
        XCTAssertEqual(DevToolsCatalog.telemetryFieldTotal, sum)
        XCTAssertGreaterThan(DevToolsCatalog.telemetryFieldTotal, 200)
    }

    func testToolIDsAreUnique() {
        let ids = DevToolsCatalog.utilityTools.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testReferenceLinksHaveValidURLs() {
        XCTAssertTrue(DevToolsCatalog.referenceLinks.allSatisfy { $0.url != nil })
    }
}

// MARK: - Utility compute tests (web devtools tools)

final class DevToolsUtilitiesTests: XCTestCase {
    func testDecodeVIN() {
        let decoded = DevToolsUtilities.decodeVIN("5YJ3E1EA1NF000001")
        XCTAssertEqual(decoded?.manufacturer, "Tesla (USA)")
        XCTAssertEqual(decoded?.model, "Model 3")
        XCTAssertEqual(decoded?.driveType, "Dual Motor AWD")
        XCTAssertEqual(decoded?.year, "2022")
        XCTAssertEqual(decoded?.plant, "Fremont, CA")
        XCTAssertEqual(decoded?.serial, "000001")
    }

    func testDecodeVINTooShort() {
        XCTAssertNil(DevToolsUtilities.decodeVIN("5YJ3E1"))
    }

    func testBase64RoundTrip() {
        XCTAssertEqual(DevToolsUtilities.base64Encode("Hello World"), "SGVsbG8gV29ybGQ=")
        XCTAssertEqual(DevToolsUtilities.base64Decode("SGVsbG8gV29ybGQ="), "Hello World")
        XCTAssertNil(DevToolsUtilities.base64Decode("not valid %%%"))
    }

    func testURLEncodeDecode() {
        XCTAssertEqual(DevToolsUtilities.urlEncode("a b&c=d"), "a%20b%26c%3Dd")
        XCTAssertEqual(DevToolsUtilities.urlDecode("a%20b%26c%3Dd"), "a b&c=d")
    }

    func testFormatJSONValid() {
        let result = DevToolsUtilities.formatJSON("{\"b\":1,\"a\":2}")
        XCTAssertTrue(result.error.isEmpty)
        XCTAssertTrue(result.formatted.contains("\"a\""))
        let aIndex = result.formatted.range(of: "\"a\"")?.lowerBound
        let bIndex = result.formatted.range(of: "\"b\"")?.lowerBound
        XCTAssertNotNil(aIndex)
        XCTAssertNotNil(bIndex)
        if let aIndex, let bIndex { XCTAssertLessThan(aIndex, bIndex) }
    }

    func testFormatJSONInvalid() {
        let result = DevToolsUtilities.formatJSON("{not json")
        XCTAssertTrue(result.formatted.isEmpty)
        XCTAssertFalse(result.error.isEmpty)
    }

    func testSHA256KnownVector() {
        XCTAssertEqual(
            DevToolsUtilities.sha256Hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testUUIDFormat() {
        let uuid = DevToolsUtilities.generateUUID()
        XCTAssertEqual(uuid.count, 36)
        XCTAssertEqual(uuid, uuid.lowercased())
        XCTAssertNotNil(UUID(uuidString: uuid))
    }

    func testConvertBytes() {
        let conversions = DevToolsUtilities.convertBytes(value: 1, unit: "KB")
        XCTAssertEqual(conversions?.first { $0.unit == "B" }?.value, "1024")
        XCTAssertEqual(conversions?.first { $0.unit == "KB" }?.value, "1")
        XCTAssertNil(DevToolsUtilities.convertBytes(value: 1, unit: "ZB"))
    }

    func testColorConversion() {
        let rgb = DevToolsUtilities.hexToRGB("#3b82f6")
        XCTAssertEqual(rgb, DevToolsUtilities.RGB(red: 59, green: 130, blue: 246))
        XCTAssertNil(DevToolsUtilities.hexToRGB("#zzz"))
        let hsl = DevToolsUtilities.rgbToHSL(DevToolsUtilities.RGB(red: 255, green: 0, blue: 0))
        XCTAssertEqual(hsl, DevToolsUtilities.HSL(hue: 0, saturation: 100, lightness: 50))
    }

    func testDecodeJWT() {
        let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiQSJ9.sig"
        let decoded = DevToolsUtilities.decodeJWT(token)
        XCTAssertTrue(decoded?.header.contains("HS256") ?? false)
        XCTAssertTrue(decoded?.payload.contains("123") ?? false)
        XCTAssertNil(DevToolsUtilities.decodeJWT("onlyonepart"))
    }

    func testDecodePermission() {
        let perm = DevToolsUtilities.decodePermission("755")
        XCTAssertEqual(perm?.owner, "rwx")
        XCTAssertEqual(perm?.group, "r-x")
        XCTAssertEqual(perm?.other, "r-x")
        XCTAssertEqual(perm?.symbolic, "rwxr-xr-x")
        XCTAssertNil(DevToolsUtilities.decodePermission("78"))
        XCTAssertNil(DevToolsUtilities.decodePermission("999"))
    }

    func testRegexMatches() {
        let global = DevToolsUtilities.regexMatches(pattern: "\\d+", flags: "g", in: "a1b22c333")
        XCTAssertEqual(global?.map(\.text), ["1", "22", "333"])
        XCTAssertEqual(global?.map(\.index), [1, 3, 6])
        let single = DevToolsUtilities.regexMatches(pattern: "\\d+", flags: "", in: "a1b22")
        XCTAssertEqual(single?.map(\.text), ["1"])
        XCTAssertNil(DevToolsUtilities.regexMatches(pattern: "(", flags: "g", in: "abc"))
    }

    func testDescribeCron() {
        XCTAssertEqual(DevToolsUtilities.describeCron("0 0 * * *"), "At 00:00")
        XCTAssertEqual(DevToolsUtilities.describeCron("* * * * *"), "Every minute")
        XCTAssertNil(DevToolsUtilities.describeCron("* * *"))
    }

    func testNextCronRuns() {
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let runs = DevToolsUtilities.nextCronRuns("* * * * *", count: 3, from: base)
        XCTAssertEqual(runs.count, 3)
        XCTAssertTrue(DevToolsUtilities.nextCronRuns("bad", count: 3, from: base).isEmpty)
    }

    func testTimestampDecode() {
        let now = Date(timeIntervalSince1970: 1_700_000_060)
        let fromUnix = DevToolsUtilities.decodeUnix("1700000000", now: now)
        XCTAssertEqual(fromUnix?.unix, 1_700_000_000)
        XCTAssertTrue(fromUnix?.iso.hasPrefix("2023-11-14") ?? false)
        XCTAssertEqual(fromUnix?.relative, "1m ago")
        XCTAssertNil(DevToolsUtilities.decodeUnix("notanumber", now: now))
        XCTAssertNotNil(DevToolsUtilities.decodeISO("2023-11-14T22:13:20Z", now: now))
    }

    func testFilterTools() {
        XCTAssertEqual(DevToolsCatalog.filterTools("").count, 15)
        XCTAssertEqual(DevToolsCatalog.filterTools("json").map(\.id), ["json"])
        XCTAssertTrue(DevToolsCatalog.filterTools("zzz").isEmpty)
    }

    func testFilterHTTPCodes() {
        XCTAssertTrue(DevToolsReferenceData.filterHTTPCodes("404").contains { $0.code == 404 })
        XCTAssertEqual(DevToolsReferenceData.filterHTTPCodes("").count, DevToolsReferenceData.httpCodes.count)
        XCTAssertTrue(DevToolsReferenceData.filterHTTPCodes("teapot").isEmpty)
    }
}
