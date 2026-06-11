//
//  ChartHiddenSeriesContext.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  Pure-core coverage for the hidden-series bridge (the store + model + view-composition half lives in
//  ChartHiddenSeriesContext.Tests.swift; split to keep each file within the SwiftLint file-length
//  budget). This is the "adapter (cached → projection)" unit test the acceptance calls for: it drives
//  the URL-param codec + the set algebra and asserts the verbatim port of the web persistence:
//    • name    — the `hidden_{chartKey}` query key (web `HIDDEN_PARAM_PREFIX + chartKey`).
//    • decode  — `nil` / `""` → empty set (web `omitDefault` / `parse('')`); split on `,`; empties
//                dropped; order-independent (web `new Set(raw.split(','))`).
//    • encode  — empty → `nil` (web `omitDefault` / `reset`); sorted, comma-joined (web
//                `serialize(Array.from(hidden).sort())`); round-trips with decode.
//    • reducer — toggle add/remove (the shared `TSChartFormat.toggleHidden`), isHidden, cleared.
//    • slug    — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no store instance, so
//  each assertion reads the pure codec / reducer directly.
//

import XCTest
@testable import TeslaSync

// MARK: - HiddenSeriesParam (web useUrlArray + useHiddenSeries serialization)

final class HiddenSeriesParamTests: XCTestCase {
    func testNamePrefixesChartKey() {
        XCTAssertEqual(HiddenSeriesParam.name(forChartKey: "battery-trend"), "hidden_battery-trend")
        XCTAssertEqual(HiddenSeriesParam.name(forChartKey: ""), "hidden_")
    }

    func testDecodeNilOrEmptyIsEmptySet() {
        XCTAssertEqual(HiddenSeriesParam.decode(nil), [])
        XCTAssertEqual(HiddenSeriesParam.decode(""), [])
    }

    func testDecodeSplitsOnComma() {
        XCTAssertEqual(HiddenSeriesParam.decode("health"), ["health"])
        XCTAssertEqual(HiddenSeriesParam.decode("health,projected"), ["health", "projected"])
    }

    func testDecodeDropsEmptyTokens() {
        XCTAssertEqual(HiddenSeriesParam.decode("health,,projected"), ["health", "projected"])
        XCTAssertEqual(HiddenSeriesParam.decode(",health,"), ["health"])
    }

    func testDecodeIsOrderIndependent() {
        XCTAssertEqual(HiddenSeriesParam.decode("projected,health"), HiddenSeriesParam.decode("health,projected"))
    }

    func testEncodeEmptyIsNil() {
        XCTAssertNil(HiddenSeriesParam.encode([]))
    }

    func testEncodeIsSortedAndJoined() {
        XCTAssertEqual(HiddenSeriesParam.encode(["health"]), "health")
        XCTAssertEqual(HiddenSeriesParam.encode(["projected", "health"]), "health,projected")
        XCTAssertEqual(HiddenSeriesParam.encode(["fleet", "projected", "health"]), "fleet,health,projected")
    }

    func testCanonicalIsSorted() {
        XCTAssertEqual(HiddenSeriesParam.canonical(["projected", "fleet", "health"]), ["fleet", "health", "projected"])
        XCTAssertEqual(HiddenSeriesParam.canonical([]), [])
    }

    func testEncodeDecodeRoundTrip() {
        let original: Set = ["projected", "health"]
        let encoded = HiddenSeriesParam.encode(original)
        XCTAssertEqual(HiddenSeriesParam.decode(encoded), original)
    }
}

// MARK: - HiddenSeriesReducer (web HiddenSeriesState mutations)

final class HiddenSeriesReducerTests: XCTestCase {
    func testToggleAddsWhenShown() {
        XCTAssertEqual(HiddenSeriesReducer.toggle([], "health"), ["health"])
        XCTAssertEqual(HiddenSeriesReducer.toggle(["projected"], "health"), ["health", "projected"])
    }

    func testToggleRemovesWhenHidden() {
        XCTAssertEqual(HiddenSeriesReducer.toggle(["health"], "health"), [])
        XCTAssertEqual(HiddenSeriesReducer.toggle(["health", "projected"], "health"), ["projected"])
    }

    func testToggleTwiceRestoresOriginal() {
        let once = HiddenSeriesReducer.toggle([], "health")
        XCTAssertEqual(HiddenSeriesReducer.toggle(once, "health"), [])
    }

    func testIsHidden() {
        XCTAssertTrue(HiddenSeriesReducer.isHidden(["health"], "health"))
        XCTAssertFalse(HiddenSeriesReducer.isHidden(["health"], "projected"))
        XCTAssertFalse(HiddenSeriesReducer.isHidden([], "health"))
    }

    func testCleared() {
        XCTAssertEqual(HiddenSeriesReducer.cleared(), [])
    }
}

// MARK: - Meta (diagnostics slug)

final class ChartHiddenSeriesSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ChartHiddenSeriesSurface.slug, "ChartHiddenSeriesContext")
    }
}
