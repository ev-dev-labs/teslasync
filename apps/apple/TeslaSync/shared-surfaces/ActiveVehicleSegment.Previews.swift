//
//  ActiveVehicleSegment.Previews.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  Xcode previews for every branch of the footer active-vehicle segment: the static single-vehicle chip,
//  the multi-vehicle `Menu` switcher (with metrics), the `iconOnly` collapse, the loading skeleton, the
//  friendly empty chip, the error retry tile, and the stale + offline freshness chips. DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let avsDemoFleet: [ActiveVehicleSegmentVehicle] = [
        ActiveVehicleSegmentVehicle(id: 1, displayName: "Lightning", vin: "5YJ3E1EA7KF000001", model: "Model 3"),
        ActiveVehicleSegmentVehicle(id: 2, displayName: "Garage Loaner", vin: "5YJSA1E26HF000002", model: "Model S"),
        ActiveVehicleSegmentVehicle(id: 3, displayName: nil, vin: "5YJYGDEE0LF000003", model: "Model Y")
    ]

    private let avsDemoMetrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: 72, ratedRangeMeters: 418_400)

    @MainActor
    private func avsModel(
        vehicles: [ActiveVehicleSegmentVehicle] = avsDemoFleet,
        selectedId: Int? = 1,
        metrics: ActiveVehicleSegmentMetrics = avsDemoMetrics,
        distanceUnit: String = "mi",
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ActiveVehicleSegmentConnection = .live
    ) -> ActiveVehicleSegmentModel {
        let snapshot = ActiveVehicleSegmentSnapshot(
            vehicles: vehicles,
            selectedId: selectedId,
            metrics: metrics,
            distanceUnit: distanceUnit,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let model = ActiveVehicleSegmentModel(source: InMemoryActiveVehicleSegmentSource(snapshot: snapshot))
        model.start()
        return model
    }

    @MainActor
    private func avsStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Switcher · multi-vehicle + metrics") {
        avsStaged("3 vehicles · 'Lightning' selected · 72% · 260 mi") {
            ActiveVehicleSegment(model: avsModel(selectedId: 1))
        }
    }

    #Preview("Static · single vehicle") {
        avsStaged("one vehicle → non-interactive chip") {
            ActiveVehicleSegment(model: avsModel(vehicles: [avsDemoFleet[0]], selectedId: 1))
        }
    }

    #Preview("Switcher · km + VIN fallback") {
        avsStaged("#3 has no name → VIN label; metrics in km") {
            ActiveVehicleSegment(model: avsModel(selectedId: 3, distanceUnit: "km"))
        }
    }

    #Preview("Icon only") {
        avsStaged("iconOnly → lone glyph (+ chevron when switchable)") {
            ActiveVehicleSegment(model: avsModel(selectedId: 2), iconOnly: true)
        }
    }

    #Preview("Loading / empty / error") {
        avsStaged("leaf states") {
            ActiveVehicleSegment(model: avsModel(isLoading: true))
            ActiveVehicleSegment(model: avsModel(vehicles: [], selectedId: nil, metrics: .absent))
            ActiveVehicleSegment(model: avsModel(errorMessage: "Network unavailable"))
        }
    }

    #Preview("Freshness · stale / offline") {
        avsStaged("freshness chips beside the segment") {
            ActiveVehicleSegment(model: avsModel(connection: .stale))
            ActiveVehicleSegment(model: avsModel(connection: .offline))
        }
    }
#endif
