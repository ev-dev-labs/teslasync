//
//  TriggerConfigurator.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The composable automation trigger configurator — the SwiftUI parity of
//  features/automations/pages/TriggerConfigurator.tsx. Binds through
//  `TriggerConfiguratorModel` (P1/S8) and renders the editor for the current trigger kind
//  (schedule / event / geofence / signal), exactly the web `switch (trigger.kind)`. It is a
//  below-page feature view embedded in the automation builder's step card, so it carries no
//  panel chrome of its own (the host supplies it) — matching the web component, which
//  returns a bare `space-y-4` stack. No networking lives here; every edit is handed to the
//  host through the model's `onChange`.
//

import SwiftUI

/// The trigger configurator surface (web `TriggerConfigurator`). State lives in
/// `TriggerConfiguratorModel`; the host supplies the initial trigger, the geofence source,
/// and the `onChange` callback when constructing the model.
public struct TriggerConfigurator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TriggerConfiguratorSurface.slug

    @State private var model: TriggerConfiguratorModel

    public init(model: TriggerConfiguratorModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            editor
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The per-kind editor (web `switch (trigger.kind)`).
    @ViewBuilder
    private var editor: some View {
        switch model.trigger {
        case let .schedule(cronExpr, timezone):
            ScheduleEditor(model: model, cronExpr: cronExpr, timezone: timezone)
        case let .event(eventType):
            EventEditor(model: model, eventType: eventType)
        case let .geofence(placeID, event, dwellMinutes):
            GeofenceEditor(model: model, placeID: placeID, event: event, dwellMinutes: dwellMinutes)
        case let .signal(trigger):
            SignalEditor(model: model, trigger: trigger)
        }
    }
}
