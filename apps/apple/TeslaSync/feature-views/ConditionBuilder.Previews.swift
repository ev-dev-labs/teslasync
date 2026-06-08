//
//  ConditionBuilder.Previews.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  Xcode previews for the surface across condition kinds + every geofence-source
//  state (content / loading / empty / error / stale / offline). DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let previewGeofences: [GeofenceOption] = [
        GeofenceOption(id: "1", name: "Home"),
        GeofenceOption(id: "2", name: "Work"),
        GeofenceOption(id: "3", name: "Supercharger — Downtown")
    ]

    private let everyKind: [AutomationConditionInput] = [
        AutomationConditionInput(body: ConditionBuilderAdapter.defaultCondition(kind: .signal)),
        AutomationConditionInput(body: .signal(SignalCondition(signal: "is_locked", op: .equals, valueBool: true))),
        AutomationConditionInput(body: ConditionBuilderAdapter.defaultCondition(kind: .timeWindow)),
        AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 1, state: .inside))),
        AutomationConditionInput(body: .otherAutomation(
            OtherAutomationCondition(otherAutomationId: 5, state: .recentlyTriggered)
        ))
    ]

    @MainActor
    private struct CBPreviewHost: View {
        @State var conditions: [AutomationConditionInput]
        let geofenceState: GeofenceLoadState<[GeofenceOption]>

        var body: some View {
            ScrollView {
                ConditionBuilder(
                    conditions: $conditions,
                    geofenceModel: GeofenceOptionsModel(previewState: geofenceState)
                )
                .padding()
            }
            .frame(maxWidth: 680)
            .background(Color.TS.bg)
        }
    }

    #Preview("Content · live") {
        CBPreviewHost(conditions: everyKind, geofenceState: .loaded(previewGeofences, stale: false))
    }

    #Preview("Geofence · loading") {
        CBPreviewHost(
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 0, state: .inside)))],
            geofenceState: .loading(cached: nil, stale: false)
        )
    }

    #Preview("Geofence · empty") {
        CBPreviewHost(
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 0, state: .dwell)))],
            geofenceState: .empty(stale: false)
        )
    }

    #Preview("Geofence · error") {
        CBPreviewHost(
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 0, state: .outside)))],
            geofenceState: .failed(.network(message: "503"), cached: nil, stale: false)
        )
    }

    #Preview("Geofence · stale") {
        CBPreviewHost(
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 2, state: .inside)))],
            geofenceState: .loaded(previewGeofences, stale: true)
        )
    }

    #Preview("Geofence · offline cached") {
        CBPreviewHost(
            conditions: [AutomationConditionInput(body: .geofence(GeofenceCondition(placeId: 1, state: .inside)))],
            geofenceState: .failed(.offline, cached: previewGeofences, stale: true)
        )
    }

    #Preview("Empty conditions") {
        CBPreviewHost(conditions: [], geofenceState: .loaded(previewGeofences, stale: false))
    }
#endif
