//
//  TemperatureGauges.ViewTests.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  Per-state view-render smoke tests for the temperature-gauges surface: every render state
//  (loading / empty / error / stale / offline / content °C / content °F / content with a missing
//  reading) materializes through `ImageRenderer`. The model is driven by
//  `InMemoryTemperatureGaugesSource`, so the tests run with no network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class TemperatureGaugesViewStateTests: XCTestCase {
        private func renders(_ update: TemperatureGaugesUpdate) -> Bool {
            let source = InMemoryTemperatureGaugesSource(initial: update)
            let model = TemperatureGaugesModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: TemperatureGauges(model: model).frame(width: 700, height: 320))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sensors(includeMissing: Bool = false) -> [TempSensorInput] {
            [
                TempSensorInput(
                    id: "frontMotor",
                    labelKey: "drivetrain.frontMotor",
                    labelFallback: "Front Motor",
                    valueCelsius: 95,
                    maxTempCelsius: 150
                ),
                TempSensorInput(
                    id: "rearMotor",
                    labelKey: "drivetrain.rearMotor",
                    labelFallback: "Rear Motor",
                    valueCelsius: 110,
                    maxTempCelsius: 150
                ),
                TempSensorInput(
                    id: "inverter",
                    labelKey: "drivetrain.inverter",
                    labelFallback: "Inverter",
                    valueCelsius: includeMissing ? nil : 105,
                    maxTempCelsius: 120
                ),
                TempSensorInput(
                    id: "battery",
                    labelKey: "drivetrain.battery",
                    labelFallback: "Battery",
                    valueCelsius: 34,
                    maxTempCelsius: 60
                )
            ]
        }

        func testContentCelsiusRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .loaded, sensors: sensors())))
        }

        func testContentFahrenheitRenders() {
            XCTAssertTrue(
                renders(
                    TemperatureGaugesUpdate(
                        status: .loaded,
                        sensors: sensors(),
                        units: TemperatureGaugesUnitPrefs(temperature: .fahrenheit)
                    )
                )
            )
        }

        func testContentWithMissingReadingRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .loaded, sensors: sensors(includeMissing: true))))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .empty, sensors: [])))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .loaded, connection: .stale, sensors: sensors())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(TemperatureGaugesUpdate(status: .loaded, connection: .offline, sensors: sensors())))
        }
    }
#endif
