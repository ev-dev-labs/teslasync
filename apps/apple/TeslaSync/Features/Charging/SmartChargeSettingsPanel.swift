//
//  SmartChargeSettingsPanel.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Settings panel
//
//  GlassPanel2 — the "Charge Settings" form (web Settings section): the rate-plan
//  picker, the target-SOC slider, the depart-by date/time picker, the max-amps
//  stepper, the battery-capacity stepper, the Optimize action, and the inline
//  optimize-error surface. Two-way bound to the page model through `@Bindable`;
//  the controls are the shared P3 inputs styled from the design tokens.
//

import SwiftUI

struct SmartChargeSettingsPanel: View {
    @Bindable var model: SmartChargePageModel

    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.lg, alignment: .top)]
    }

    var body: some View {
        SmartChargePanel(icon: "bolt.fill", titleKey: "chargePlanner.settings", titleFallback: "Charge Settings") {
            LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.lg) {
                ratePlanField
                targetSocField
                departByField
                maxAmpsField
                batteryCapacityField
            }
            optimizeRow
            if let message = model.optimizeErrorMessage {
                Text(verbatim: message)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
    }

    // MARK: - Fields

    private var ratePlanField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(SmartChargeStrings.key("chargePlanner.ratePlan"))
            Picker(selection: $model.ratePlanID) {
                ForEach(model.ratePlanChoices) { choice in
                    Text(verbatim: choice.label).tag(choice.id)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(SmartChargeStrings.key("chargePlanner.ratePlan"))
        }
    }

    private var targetSocField: some View {
        TSSlider(
            SmartChargeStrings.key("chargePlanner.targetSoc"),
            value: Binding(
                get: { Double(model.targetSoc) },
                set: { model.targetSoc = Int(($0 / 5).rounded() * 5) }
            ),
            in: 20 ... 100,
            format: { "\(Int($0))%" }
        )
    }

    private var departByField: some View {
        TSDatePickerBridge(
            SmartChargeStrings.key("chargePlanner.departBy"),
            date: $model.departBy,
            components: [.date, .hourAndMinute]
        )
    }

    private var maxAmpsField: some View {
        TSStepper(
            SmartChargeStrings.key("chargePlanner.maxAmps"),
            value: $model.maxAmps,
            in: 8 ... 80
        )
    }

    private var batteryCapacityField: some View {
        TSStepper(
            SmartChargeStrings.key("chargePlanner.batteryCapacity"),
            value: Binding(
                get: { Int(model.batteryCapacity) },
                set: { model.batteryCapacity = Double($0) }
            ),
            in: 40 ... 200,
            step: 5
        )
    }

    // MARK: - Optimize action (web `flex justify-end` button)

    private var optimizeRow: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(
                isLoading: model.isOptimizing,
                action: { Task { await model.optimize() } },
                label: {
                    Label(SmartChargeStrings.key("chargePlanner.optimize"), systemImage: "calendar.badge.clock")
                }
            )
            .disabled(!model.canOptimize)
        }
    }
}
