//
//  ConditionBuilder.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The composable automation ConditionBuilder — the SwiftUI parity of
//  web/src/features/automations/pages/ConditionBuilder.tsx. A controlled editor: the
//  web `{ conditions, onChange }` props map to a SwiftUI `Binding<[…]>`, and the one
//  data hook (web `useGeofences`) binds through `GeofenceOptionsModel` (P1/S8). The
//  surface renders the condition rows + the "Add Condition" affordance, and emits the
//  P1/S11 `view.opened` event with the slug `ConditionBuilder` on appear. No
//  networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `ConditionBuilder`: a list of editable
/// condition rows (signal / time-window / geofence / other-automation) plus the add
/// affordance. The geofence picker's data source renders every state the P4 contract
/// requires (loading / empty / error / stale / offline); the editor itself is driven
/// by the bound condition array.
public struct ConditionBuilder: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ConditionBuilderDiagnostics.surface

    @Binding private var conditions: [AutomationConditionInput]
    @State private var geofenceModel: GeofenceOptionsModel
    private let telemetry: any ConditionBuilderTelemetry

    /// The canonical binding: the web `conditions` value + `onChange` setter collapse
    /// into a SwiftUI `Binding`, and the geofence hook binds through its P1/S8 model.
    public init(
        conditions: Binding<[AutomationConditionInput]>,
        geofenceModel: GeofenceOptionsModel,
        telemetry: any ConditionBuilderTelemetry = OSLogConditionBuilderTelemetry()
    ) {
        _conditions = conditions
        _geofenceModel = State(initialValue: geofenceModel)
        self.telemetry = telemetry
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach($conditions) { $condition in
                    ConditionRowPanel(
                        condition: $condition,
                        isFirst: condition.id == conditions.first?.id,
                        geofenceModel: geofenceModel,
                        onRemove: { remove(condition.id) }
                    )
                }
                addButton
            }
        }
        .task {
            ConditionBuilderOpenReporter.report(using: telemetry)
            geofenceModel.start()
        }
        .onDisappear { geofenceModel.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The "Add Condition" affordance (web `<UiButton … onClick={addCondition}>`):
    /// appends a default signal condition.
    private var addButton: some View {
        TSButton(variant: .ghost, size: .small) {
            conditions.append(AutomationConditionInput(
                body: ConditionBuilderAdapter.defaultCondition(kind: .signal)
            ))
        } label: {
            Label {
                Text(verbatim: CBStrings.string("automations.builder.addCondition", "Add Condition"))
            } icon: {
                Image(systemName: "plus")
            }
            .font(Font.TS.caption)
        }
        .accessibilityLabel(Text(verbatim: CBStrings.string("automations.builder.addCondition", "Add Condition")))
    }

    /// Web `removeCondition`: drops the row with the given identity.
    private func remove(_ id: AutomationConditionInput.ID) {
        conditions.removeAll { $0.id == id }
    }
}
