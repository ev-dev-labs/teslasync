//
//  TeslaChargingSessionsMap.Tests.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  Adapter + projection + formatting + label/accessibility coverage for the
//  TeslaChargingSessionsMap surface (the model/state-holder coverage lives in
//  `TeslaChargingSessionsMap.ModelTests`). Each test ports a web computation or
//  branch. These run in the TeslaSync(/-macOS) XCTest targets — no network, no
//  real store, no rendered map.
//

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard + charger display

@MainActor final class TeslaChargingSessionsMapAdapterTests: XCTestCase {
    func testIsPlottableAcceptsFiniteNumbersOnly() {
        XCTAssertTrue(TeslaChargingSessionsMapNumeric.isPlottable(37.77))
        XCTAssertTrue(TeslaChargingSessionsMapNumeric.isPlottable(0))
        XCTAssertFalse(TeslaChargingSessionsMapNumeric.isPlottable(nil))
        XCTAssertFalse(TeslaChargingSessionsMapNumeric.isPlottable(.nan))
        XCTAssertFalse(TeslaChargingSessionsMapNumeric.isPlottable(.infinity))
    }

    func testChargerTypeUppercasedTrimsAndDropsBlank() {
        XCTAssertEqual(TeslaChargerTypeDisplay.uppercased("Supercharger V3"), "SUPERCHARGER V3")
        XCTAssertEqual(TeslaChargerTypeDisplay.uppercased("  ccs  "), "CCS")
        XCTAssertNil(TeslaChargerTypeDisplay.uppercased(nil))
        XCTAssertNil(TeslaChargerTypeDisplay.uppercased(""))
        XCTAssertNil(TeslaChargerTypeDisplay.uppercased("   "))
    }

    func testRecordIsPlottableMirrorsWebFilter() {
        let plottable = TeslaChargingSessionRecord(id: 1, latitude: 37.4, longitude: -122.0)
        let missingLng = TeslaChargingSessionRecord(id: 2, latitude: 37.4, longitude: nil)
        let nanLat = TeslaChargingSessionRecord(id: 3, latitude: .nan, longitude: -122.0)
        XCTAssertTrue(plottable.isPlottable)
        XCTAssertFalse(missingLng.isPlottable)
        XCTAssertFalse(nanLat.isPlottable)
    }

    func testMarkerFromCarriesDisplayFieldsOrNilWhenUnplottable() {
        let session = TeslaChargingSessionRecord(
            id: 7,
            siteLocationName: "Site",
            startedAt: Date(timeIntervalSince1970: 0),
            totalEnergyAddedWh: 42500,
            totalCost: 13.6,
            chargerType: "CCS",
            latitude: 37.4,
            longitude: -122.0
        )
        let marker = TeslaChargingSessionMarker.from(session)
        XCTAssertEqual(marker?.id, 7)
        XCTAssertEqual(marker?.latitude ?? 0, 37.4, accuracy: 0.0001)
        XCTAssertEqual(marker?.longitude ?? 0, -122.0, accuracy: 0.0001)
        XCTAssertEqual(marker?.energyWh ?? -1, 42500, accuracy: 0.0001)
        XCTAssertEqual(marker?.cost ?? -1, 13.6, accuracy: 0.0001)
        XCTAssertEqual(marker?.chargerType, "CCS")
        XCTAssertNil(TeslaChargingSessionMarker.from(TeslaChargingSessionRecord(id: 8)))
    }
}

// MARK: - Projection (port of the web `center` + `clusterPoints`)

@MainActor final class TeslaChargingSessionsMapProjectionTests: XCTestCase {
    private func record(_ id: Int, _ lat: Double?, _ lng: Double?) -> TeslaChargingSessionRecord {
        TeslaChargingSessionRecord(id: id, latitude: lat, longitude: lng)
    }

    func testEmptySliceUsesSanFranciscoDefaultCenter() {
        let projection = TeslaChargingSessionsMapProjection.make(sessions: [])
        XCTAssertEqual(projection.centerLatitude, 37.77, accuracy: 0.0001)
        XCTAssertEqual(projection.centerLongitude, -122.42, accuracy: 0.0001)
        XCTAssertFalse(projection.hasPlottableMarkers)
        XCTAssertEqual(projection.plottedCount, 0)
    }

    func testCenterIsMeanTreatingMissingComponentsAsZero() {
        let projection = TeslaChargingSessionsMapProjection.make(
            sessions: [record(1, 10, 20), record(2, nil, nil)]
        )
        // Web parity: avg(lat ?? 0) = (10 + 0) / 2, avg(lng ?? 0) = (20 + 0) / 2.
        XCTAssertEqual(projection.centerLatitude, 5, accuracy: 0.0001)
        XCTAssertEqual(projection.centerLongitude, 10, accuracy: 0.0001)
    }

    func testMarkersReproduceWebClusterPointsFilter() {
        let projection = TeslaChargingSessionsMapProjection.make(
            sessions: [
                record(1, 37.4, -122.0),
                record(2, nil, -122.0),
                record(3, .nan, -122.0),
                record(4, 36.2, -120.2)
            ]
        )
        XCTAssertEqual(projection.plottedCount, 2)
        XCTAssertEqual(projection.markers.map(\.id), [1, 4])
        XCTAssertTrue(projection.hasPlottableMarkers)
        XCTAssertEqual(projection.markerCoordinates.count, 2)
    }
}

// MARK: - Formatting parity (web `useFormatting` + popup templates)

@MainActor final class TeslaChargingSessionsMapFormattingTests: XCTestCase {
    private let formatting = DefaultTeslaChargingSessionsMapFormatting()

    func testNumberGroupingAndRounding() {
        XCTAssertEqual(formatting.formatNumber(1234.5, decimals: 2), "1,234.50")
        XCTAssertEqual(formatting.formatNumber(42.46, decimals: 1), "42.5")
    }

    func testCurrency() {
        XCTAssertEqual(formatting.formatCurrency(13.6, decimals: 2), "$13.60")
        XCTAssertEqual(formatting.formatCurrency(0), "$0.00")
    }

    func testEnergyKwhConvertsFromWattHoursAtOneDecimal() {
        XCTAssertEqual(formatting.formatEnergyKwh(wattHours: 42500), "42.5")
        XCTAssertEqual(formatting.formatEnergyKwh(wattHours: 31200), "31.2")
        XCTAssertEqual(formatting.formatEnergyKwh(wattHours: 0), "0.0")
    }

    func testTimestamp() {
        XCTAssertEqual(formatting.formatDateTime(nil), "—")
        XCTAssertNotEqual(formatting.formatDateTime(Date(timeIntervalSince1970: 1_700_000_000)), "—")
    }
}

// MARK: - Labels + accessibility (no hardcoded literals in the view)

@MainActor final class TeslaChargingSessionsMapLabelsTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testMapLabelAndUnknownFallback() {
        XCTAssertEqual(TeslaChargingSessionsMapLabels.mapLabel(localize: echo), "Charging sessions map")
        XCTAssertEqual(TeslaChargingSessionsMapLabels.unknownSite(localize: echo), "Unknown")
    }

    func testSiteNameResolvesBlankToUnknown() {
        XCTAssertEqual(TeslaChargingSessionsMapLabels.siteName("Mountain View", localize: echo), "Mountain View")
        XCTAssertEqual(TeslaChargingSessionsMapLabels.siteName(nil, localize: echo), "Unknown")
        XCTAssertEqual(TeslaChargingSessionsMapLabels.siteName("", localize: echo), "Unknown")
        XCTAssertEqual(TeslaChargingSessionsMapLabels.siteName("   ", localize: echo), "Unknown")
    }

    func testMarkerAccessibilityLabelInterpolatesName() {
        XCTAssertEqual(
            TeslaChargingSessionsMapLabels.markerAccessibilityLabel(siteName: "Home", localize: echo),
            "Home charging session"
        )
    }

    func testEnergyTemplateAndCountTemplates() {
        XCTAssertEqual(TeslaChargingSessionsMapLabels.energy(valueText: "42.5", localize: echo), "42.5 kWh")
        XCTAssertEqual(TeslaChargingSessionsMapLabels.count(3, localize: echo), "3 sessions")
        XCTAssertEqual(
            TeslaChargingSessionsMapLabels.countAccessibility(3, localize: echo),
            "3 charging sessions on the map"
        )
    }
}

// MARK: - Callout display (port of the web `popupHtml`)

@MainActor final class TeslaChargingSessionCalloutDisplayTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let formatting = DefaultTeslaChargingSessionsMapFormatting()

    private func marker(
        site: String?,
        energyWh: Double?,
        cost: Double?,
        charger: String?
    ) -> TeslaChargingSessionMarker {
        TeslaChargingSessionMarker(
            id: 1,
            latitude: 37.4,
            longitude: -122.0,
            siteLocationName: site,
            startedAt: Date(timeIntervalSince1970: 0),
            energyWh: energyWh,
            cost: cost,
            chargerType: charger
        )
    }

    func testFullPopulatedCallout() {
        let display = TeslaChargingSessionCalloutDisplay.make(
            marker: marker(site: "Mountain View", energyWh: 42500, cost: 13.6, charger: "Supercharger V3"),
            formatting: formatting,
            localize: echo
        )
        XCTAssertEqual(display.siteName, "Mountain View")
        XCTAssertEqual(display.energyText, "42.5 kWh")
        XCTAssertEqual(display.costText, "$13.60")
        XCTAssertEqual(display.chargerText, "SUPERCHARGER V3")
        XCTAssertEqual(display.accessibilityLabel, "Mountain View charging session")
        XCTAssertNotEqual(display.dateText, "—")
        XCTAssertTrue(display.accessibilitySummary.contains("42.5 kWh"))
        XCTAssertTrue(display.accessibilitySummary.contains("$13.60"))
    }

    func testOptionalBranchesAreOmittedLikeTheWebPopup() {
        let display = TeslaChargingSessionCalloutDisplay.make(
            marker: marker(site: nil, energyWh: nil, cost: nil, charger: nil),
            formatting: formatting,
            localize: echo
        )
        XCTAssertEqual(display.siteName, "Unknown")
        XCTAssertNil(display.energyText)
        XCTAssertNil(display.costText)
        XCTAssertNil(display.chargerText)
        XCTAssertEqual(display.accessibilityLabel, "Unknown charging session")
        XCTAssertFalse(display.accessibilitySummary.contains("kWh"))
    }
}
