//
//  TriggerConfigurator.Previews.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  Xcode previews for every web branch + the geofence-query states: schedule (simple /
//  advanced), vehicle event, geofence (data / loading / empty / error / stale / offline /
//  dwell), and signal (numeric / boolean / state / change-only). DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private let previewGeofences: [Geofence] = [
        Geofence(id: "1", name: "Home"),
        Geofence(id: "2", name: "Work"),
        Geofence(id: "3", name: "Supercharger — Downtown")
    ]

    @MainActor
    private func previewModel(
        _ trigger: AutomationTrigger,
        geofences: GeofenceInput = GeofenceInput(geofences: previewGeofences)
    ) -> TriggerConfiguratorModel {
        let source = InMemoryGeofenceSource(initial: geofences)
        let model = TriggerConfiguratorModel(trigger: trigger, source: source)
        model.start()
        return model
    }

    private func previewWrap(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 480)
            .background(Color.TS.bg)
    }

    #Preview("Schedule · simple") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .schedule(cronExpr: "0 8 * * 1,2,3,4,5", timezone: "America/New_York")
        )))
    }

    #Preview("Schedule · advanced") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .schedule(cronExpr: "*/15 9 * * *", timezone: "UTC")
        )))
    }

    #Preview("Event") {
        previewWrap(TriggerConfigurator(model: previewModel(.event(.online))))
    }

    #Preview("Geofence · data") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 2, event: .enter, dwellMinutes: nil)
        )))
    }

    #Preview("Geofence · loading") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil),
            geofences: GeofenceInput(isLoading: true, isFetching: true)
        )))
    }

    #Preview("Geofence · empty") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil),
            geofences: GeofenceInput(geofences: [])
        )))
    }

    #Preview("Geofence · error") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 0, event: .enter, dwellMinutes: nil),
            geofences: GeofenceInput(errorMessage: "GET /geofences failed: 503")
        )))
    }

    #Preview("Geofence · stale") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 1, event: .exit, dwellMinutes: nil),
            geofences: GeofenceInput(isFetching: true, geofences: previewGeofences, isStale: true)
        )))
    }

    #Preview("Geofence · offline") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 1, event: .enter, dwellMinutes: nil),
            geofences: GeofenceInput(geofences: previewGeofences, isOffline: true)
        )))
    }

    #Preview("Geofence · dwell") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .geofence(placeID: 3, event: .dwell, dwellMinutes: 10)
        )))
    }

    #Preview("Signal · numeric") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .signal(SignalTrigger(signal: "battery_level", op: .lessThan, value: .number(20)))
        )))
    }

    #Preview("Signal · boolean") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .signal(SignalTrigger(signal: "is_locked", op: .equals, value: .bool(true)))
        )))
    }

    #Preview("Signal · state") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .signal(SignalTrigger(signal: "state", op: .equals, value: .text("online")))
        )))
    }

    #Preview("Signal · change-only") {
        previewWrap(TriggerConfigurator(model: previewModel(
            .signal(SignalTrigger(signal: "speed", op: .changed, value: .none))
        )))
    }
#endif
