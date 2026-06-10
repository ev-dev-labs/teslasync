//
//  SignalCategoryTree.Previews.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  Xcode previews for each surface state (content / expanded / many-selected /
//  loading / empty / error / no-results / stale / offline). DEBUG-only; skipped by
//  the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: SignalCategoryTreeUpdate,
        configure: (SignalCategoryTreeModel) -> Void = { _ in }
    ) -> SignalCategoryTreeModel {
        let source = InMemorySignalCategoryTreeSource(initial: update)
        let model = SignalCategoryTreeModel(source: source)
        model.start()
        configure(model)
        return model
    }

    private func previewDescriptors() -> [SignalDescriptor] {
        [
            SignalDescriptor(name: "charge_state", category: "charging", valueKind: .string),
            SignalDescriptor(name: "charger_power", category: "charging", valueKind: .float, unitKind: .charge),
            SignalDescriptor(name: "battery_level", category: "charging", valueKind: .int, unitKind: .charge),
            SignalDescriptor(name: "vehicle_speed", category: "driving", valueKind: .float, unitKind: .speed),
            SignalDescriptor(name: "odometer", category: "driving", valueKind: .float, unitKind: .distance),
            SignalDescriptor(name: "shift_state", category: "driving", valueKind: .string),
            SignalDescriptor(name: "motor_rpm", category: "powertrain", valueKind: .int),
            SignalDescriptor(name: "pedal_position", category: "powertrain", valueKind: .float),
            SignalDescriptor(name: "inside_temp", category: "climate", valueKind: .float, unitKind: .temperature),
            SignalDescriptor(name: "is_climate_on", category: "climate", valueKind: .bool),
            SignalDescriptor(name: "latitude", category: "location", valueKind: .float),
            SignalDescriptor(name: "locked", category: "vehicle_state", valueKind: .bool),
            SignalDescriptor(name: "sentry_mode", category: "safety_security", valueKind: .bool)
        ]
    }

    private func populatedUpdate(
        connection: SignalCategoryTreeConnection = .live,
        updatedAt: Date? = Date()
    ) -> SignalCategoryTreeUpdate {
        SignalCategoryTreeUpdate(
            status: .loaded,
            connection: connection,
            descriptors: previewDescriptors(),
            updatedAt: updatedAt
        )
    }

    @MainActor
    private func previewContainer(_ model: SignalCategoryTreeModel) -> some View {
        SignalCategoryTree(model: model)
            .padding(TSSpacing.lg)
            .frame(width: 460, height: 560, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Content (expanded)") {
        previewContainer(previewModel(populatedUpdate()) { model in
            model.toggleExpanded("charging")
            model.toggleExpanded("driving")
            model.toggleLeaf("charger_power")
        })
    }

    #Preview("Many selected") {
        previewContainer(previewModel(populatedUpdate()) { model in
            model.toggleExpanded("charging")
            model.toggleGroup("charging")
            model.toggleLeaf("vehicle_speed")
            model.toggleLeaf("motor_rpm")
        })
    }

    #Preview("Searching") {
        previewContainer(previewModel(populatedUpdate()) { model in
            model.setSearch("temp")
        })
    }

    #Preview("No results") {
        previewContainer(previewModel(populatedUpdate()) { model in
            model.setSearch("zzzzz")
        })
    }

    #Preview("Loading") {
        previewContainer(previewModel(SignalCategoryTreeUpdate(status: .loading)))
    }

    #Preview("Empty") {
        previewContainer(previewModel(SignalCategoryTreeUpdate(status: .loaded)))
    }

    #Preview("Error") {
        previewContainer(previewModel(SignalCategoryTreeUpdate(status: .failed("HTTP 503 Service Unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(populatedUpdate(
            connection: .stale,
            updatedAt: Date().addingTimeInterval(-180)
        )) { model in
            model.toggleExpanded("charging")
        })
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(populatedUpdate(
            connection: .offline,
            updatedAt: Date().addingTimeInterval(-1800)
        )) { model in
            model.toggleExpanded("driving")
        })
    }
#endif
