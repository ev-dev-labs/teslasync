import SwiftUI

// The Only-If (Conditions), Then (Actions), and conflict-warnings regions of
// `AutomationBuilderPage`. Each composes the sibling editor surface — `ConditionBuilder`,
// `ActionBuilder`, `ConflictWarnings` — exactly as the web page composes its sub-components,
// seeded from the page form and writing edits back through the page model (DRY, ADR-004).

// MARK: - Only If / Conditions (web `FormSection title="Only If (Conditions)"`)

struct AutomationBuilderConditionsSection: View {
    let model: AutomationBuilderPageModel
    /// The condition editor's geofence picker source (empty here; geofence data is that unit's
    /// concern). Held as `@State` so the composed `ConditionBuilder` keeps one stable model.
    @State private var geofenceModel = GeofenceOptionsModel(geofences: [], loading: false)

    var body: some View {
        TSFormSection("automations.builder.onlyIf") {
            Text("automations.builder.onlyIfDesc")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            ConditionBuilder(conditions: conditionsBinding, geofenceModel: geofenceModel)
        }
    }

    private var conditionsBinding: Binding<[AutomationConditionInput]> {
        Binding(get: { model.form.conditions }, set: { model.setConditions($0) })
    }
}

// MARK: - Then / Actions (web `FormSection title="Then (Actions)"`)

struct AutomationBuilderActionsSection: View {
    let model: AutomationBuilderPageModel

    var body: some View {
        TSFormSection("automations.builder.then") {
            Text("automations.builder.thenDesc")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            ActionBuilder(model: makeActionModel())
                .id(model.channelRevision)
        }
    }

    /// Builds the composed action editor's model, bridging its `onChange` to the page form. Keyed
    /// on `channelRevision` so the channel options refresh once the notifications load resolves.
    private func makeActionModel() -> ActionBuilderModel {
        ActionBuilderModel(
            actions: model.form.actions,
            channels: model.channels,
            onChange: { model.setActions($0) }
        )
    }
}

// MARK: - Conflicts (web `{conflicts.length > 0 && <ConflictWarnings/>}`)

struct AutomationBuilderConflictsSection: View {
    let conflicts: [AutomationConflict]

    var body: some View {
        if conflicts.isEmpty {
            EmptyView()
        } else {
            ConflictWarnings(model: ConflictWarningsModel(
                source: InMemoryConflictWarningsSource(
                    initial: ConflictWarningsInput(phase: .loaded(conflicts))
                )
            ))
        }
    }
}
