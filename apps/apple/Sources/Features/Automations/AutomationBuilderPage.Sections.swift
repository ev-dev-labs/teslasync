import SwiftUI

// The General + When (Trigger) form sections for `AutomationBuilderPage`, plus the three web
// `GlassPanel` regions the parity manifest enumerates: the trigger-configurator panel
// (GlassPanel1), the empty-trigger panel (GlassPanel2), and (in `AutomationBuilderPage.Form.swift`)
// the preset-hint panel (GlassPanel3). The trigger detail editor composes the sibling
// `TriggerConfigurator` surface, seeded from the form and writing back through the page model.

// MARK: - General (web `FormSection title="General"`)

struct AutomationBuilderGeneralSection: View {
    let model: AutomationBuilderPageModel

    var body: some View {
        TSFormSection("automations.builder.general") {
            TSTextField(
                "automations.builder.namePlaceholder", // parity:allow i18n key name, not a stub
                text: nameBinding,
                label: "automations.builder.name"
            )
            descriptionField
            vehicleField
            TSToggle("automations.builder.enabled", isOn: enabledBinding)
        }
    }

    /// Web `Textarea` bound to the description field (multi-line, growing).
    private var descriptionField: some View {
        TSFormField("automations.builder.description") {
            TextField(
                "automations.builder.descriptionPlaceholder", // parity:allow i18n key name, not a stub
                text: descriptionBinding,
                axis: .vertical
            )
            .lineLimit(2 ... 5)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }

    /// Web vehicle `Select` — "All Vehicles" plus each vehicle (display name or `Vehicle {{id}}`).
    private var vehicleField: some View {
        TSFormField("automations.builder.vehicle") {
            Picker("automations.builder.vehicle", selection: vehicleBinding) {
                Text("automations.builder.allVehicles").tag(Int64?.none)
                ForEach(model.vehicles) { vehicle in
                    Text(verbatim: model.vehicleLabel(vehicle)).tag(Int64?.some(vehicle.id))
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text("automations.builder.vehicle"))
        }
    }

    private var nameBinding: Binding<String> {
        Binding(get: { model.form.name }, set: { model.setName($0) })
    }

    private var descriptionBinding: Binding<String> {
        Binding(get: { model.form.description }, set: { model.setDescription($0) })
    }

    private var vehicleBinding: Binding<Int64?> {
        Binding(get: { model.form.vehicleID }, set: { model.setVehicle($0) })
    }

    private var enabledBinding: Binding<Bool> {
        Binding(get: { model.form.enabled }, set: { model.setEnabled($0) })
    }
}

// MARK: - When / Trigger (web `FormSection title="When (Trigger)"`)

struct AutomationBuilderTriggerSection: View {
    let model: AutomationBuilderPageModel

    var body: some View {
        TSFormSection("automations.builder.when") {
            Text("automations.builder.whenDesc")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            triggerTypeField
            triggerPanel
        }
    }

    /// Web trigger-type `Select` — the "Select trigger type..." sentinel plus `TRIGGER_TYPES`.
    private var triggerTypeField: some View {
        TSFormField("automations.builder.triggerType") {
            Picker("automations.builder.triggerType", selection: triggerKindBinding) {
                Text("automations.builder.selectTrigger").tag(TriggerKind?.none)
                ForEach(TriggerTypeCatalog.all, id: \.option.id) { entry in
                    Text(verbatim: Self.triggerLabel(entry.option)).tag(TriggerKind?.some(entry.option.value))
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text("automations.builder.triggerType"))
        }
    }

    /// GlassPanel1 (configured trigger → `TriggerConfigurator`) or GlassPanel2 (empty trigger).
    @ViewBuilder
    private var triggerPanel: some View {
        if let trigger = model.form.trigger {
            TSGlassPanel {
                TriggerConfigurator(model: makeTriggerModel(trigger))
            }
            .id(trigger.kind)
        } else {
            TSGlassPanel {
                TSEmptyState(
                    title: "automations.builder.emptyTrigger",
                    systemImage: "bolt.badge.clock"
                )
                .frame(maxWidth: .infinity)
            }
        }
    }

    /// Builds the composed configurator's model, bridging its `onChange` to the page form. The
    /// geofence picker binds an empty source here (geofence data is the configurator unit's
    /// concern, not one of this page's data sources), so it renders its own empty state.
    private func makeTriggerModel(_ trigger: AutomationTrigger) -> TriggerConfiguratorModel {
        TriggerConfiguratorModel(
            trigger: trigger,
            source: InMemoryGeofenceSource(initial: GeofenceInput(geofences: [])),
            onChange: { model.setTrigger($0) }
        )
    }

    private var triggerKindBinding: Binding<TriggerKind?> {
        Binding(get: { model.form.trigger?.kind }, set: { model.setTriggerKind($0) })
    }

    /// Resolves a trigger-type option label from the `TriggerConfigurator` string table.
    static func triggerLabel(_ option: TriggerOption<TriggerKind>) -> String {
        TCStrings.string(option.labelKey, option.fallback)
    }
}
