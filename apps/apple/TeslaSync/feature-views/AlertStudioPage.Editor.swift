//
//  AlertStudioPage.Editor.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The right-column rule builder (web editor `GlassPanel`) and the snooze sheet. It
//  composes the full typed-rule form section by section: identity (name + status),
//  targeting (vehicles + rule kind), the signal/operator OR computed-metric operand
//  panel, severity + the allowed-operators hint, the kind-aware typed-value editor
//  (range / text / bool / any-change / numeric / choose-a-signal), cooldown + the
//  alert-behavior force-choose with its recommendation banner, the repeat-only max-
//  fires + escalation controls, the per-rule message template + include-title toggle,
//  the test-delivery-target channel picker (rendering every channels-source state),
//  and the Save / Delete / Test / Reset action row. Every control binds editor state
//  through the view-model; all strings resolve through the injected localizer.
//

import SwiftUI

// MARK: - View-model editor helpers

extension AlertStudioViewModel {
    /// A `String` binding over an `Int` editor field (web `<UiInput type="number">`,
    /// where `Number('')` is `0`).
    func editorIntBinding(_ keyPath: WritableKeyPath<EditorState, Int>) -> Binding<String> {
        Binding(
            get: { String(self.editor[keyPath: keyPath]) },
            set: { str in
                let parsed = Int(str.trimmingCharacters(in: .whitespaces)) ?? 0
                self.updateEditor { $0[keyPath: keyPath] = parsed }
            }
        )
    }

    var isAllVehicles: Bool {
        if case .allSticky = editor.vehicleSelection { return true }
        return false
    }

    var vehicleSelectionEmpty: Bool {
        if case let .specific(ids) = editor.vehicleSelection { return ids.isEmpty }
        return false
    }

    func isVehicleSelected(_ id: Int64) -> Bool {
        if case let .specific(ids) = editor.vehicleSelection { return ids.contains(id) }
        return false
    }

    func selectAllVehicles() {
        updateEditor { $0.vehicleSelection = .allSticky }
    }

    func selectSpecificVehicles() {
        updateEditor { state in
            if case .specific = state.vehicleSelection { return }
            state.vehicleSelection = .specific(vehicleIDs: [])
        }
    }

    func toggleVehicle(_ id: Int64) {
        updateEditor { state in
            switch state.vehicleSelection {
            case .allSticky:
                state.vehicleSelection = .specific(vehicleIDs: [id])
            case let .specific(ids):
                var next = ids
                if let index = next.firstIndex(of: id) { next.remove(at: index) } else { next.append(id) }
                state.vehicleSelection = .specific(vehicleIDs: next)
            }
        }
    }
}

extension View {
    /// Applies the decimal keypad on iOS for numeric editor fields; a no-op on macOS.
    @ViewBuilder
    func asNumericKeyboard() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }
}

// MARK: - Field label (web uppercase field label)

/// A small uppercase field label (web `<label>` with `uppercase tracking-wider`).
struct ASFieldLabel: View {
    let text: ASText
    let localize: ASLocalizer

    var body: some View {
        TSLabel(localize.key(text))
    }
}

// MARK: - Rule editor container

struct ASRuleEditor: View {
    @Bindable var viewModel: AlertStudioViewModel

    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                headerRow
                if viewModel.hasDraft {
                    TSDraftRecoveryBanner(onRestore: {}, onDiscard: { viewModel.discardDraft() })
                }
                if let formError = viewModel.formError {
                    TSAlertBanner(
                        tone: .danger,
                        systemImage: "exclamationmark.triangle.fill",
                        title: localize.key(ASCopy.formsValidationFailed),
                        message: ASView.key(formError)
                    )
                }
                ASEditorIdentitySection(viewModel: viewModel)
                ASEditorTargetingSection(viewModel: viewModel)
                operandPanel
                ASEditorSeveritySection(viewModel: viewModel)
                if viewModel.editor.kind != .computedMetric {
                    ASTypedValueEditor(viewModel: viewModel)
                }
                ASEditorBehaviorSection(viewModel: viewModel)
                ASMessageEditorPanel(viewModel: viewModel)
                ASTestTargetSection(viewModel: viewModel)
                ASEditorActions(viewModel: viewModel)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "square.and.pencil").foregroundStyle(Color.TS.accent)
            Text(localize.key(viewModel.isEditing ? ASCopy.editorEditTitle : ASCopy.editorNewTitle))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var operandPanel: some View {
        if viewModel.editor.kind == .computedMetric {
            ASComputedMetricPanel(viewModel: viewModel)
        } else {
            ASEditorSignalSection(viewModel: viewModel)
        }
    }
}

// MARK: - Identity (name + status)

struct ASEditorIdentitySection: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        ASResponsivePair {
            TSTextField(
                localize.key(ASCopy.editorNamePrompt),
                text: viewModel.editorBinding(\.name),
                label: localize.key(ASCopy.editorNameLabel)
            )
        } trailing: {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ASFieldLabel(text: ASCopy.editorEnabledLabel, localize: localize)
                TSSelect(
                    selection: viewModel.editorBinding(\.enabled),
                    options: [
                        TSSelectOption(true, localize.key(ASCopy.editorEnabled)),
                        TSSelectOption(false, localize.key(ASCopy.editorDisabled))
                    ]
                )
            }
        }
    }
}

// MARK: - Targeting (vehicles + kind)

struct ASEditorTargetingSection: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            vehicles
            kindControl
        }
    }

    private var vehicles: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorVehiclesLabel, localize: localize)
            HStack(spacing: TSSpacing.sm) {
                segment(ASCopy.kindAllLabel, isOn: viewModel.isAllVehicles) { viewModel.selectAllVehicles() }
                segment(ASCopy.kindSpecificLabel, isOn: !viewModel.isAllVehicles) {
                    viewModel.selectSpecificVehicles()
                }
            }
            if !viewModel.isAllVehicles { vehicleChips }
            if viewModel.vehicleSelectionEmpty {
                TSErrorText(localize.key(ASCopy.editorVehiclesEmptyError))
            }
        }
    }

    @ViewBuilder
    private var vehicleChips: some View {
        if viewModel.vehicles.isEmpty {
            TSCaption(localize.key(ASCopy.vehiclesNone))
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(viewModel.vehicles) { vehicle in
                        chip(
                            title: vehicle.displayName,
                            isOn: viewModel.isVehicleSelected(vehicle.id),
                            action: { viewModel.toggleVehicle(vehicle.id) }
                        )
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var kindControl: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorKindLabel, localize: localize)
            HStack(spacing: TSSpacing.sm) {
                segment(ASCopy.kindSignal, isOn: viewModel.editor.kind == .signal) {
                    viewModel.updateEditor { $0.kind = .signal }
                }
                segment(ASCopy.kindComputedMetric, isOn: viewModel.editor.kind == .computedMetric) {
                    viewModel.updateEditor { $0.kind = .computedMetric }
                }
            }
            TSCaption(localize.key(
                viewModel.editor.kind == .computedMetric ? ASCopy.kindComputedMetricHint : ASCopy.kindSignalHint
            ))
        }
    }

    private func segment(_ text: ASText, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(localize.key(text))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(isOn ? Color.TS.textPrimary : Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(
                    isOn ? Color.TS.surface : Color.clear,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }

    private func chip(title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 11))
                Text(verbatim: title).font(Font.TS.caption)
            }
            .foregroundStyle(isOn ? Color.TS.accent : Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(isOn ? Color.TS.accent.opacity(0.12) : Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(isOn ? Color.TS.accent.opacity(0.3) : Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}
