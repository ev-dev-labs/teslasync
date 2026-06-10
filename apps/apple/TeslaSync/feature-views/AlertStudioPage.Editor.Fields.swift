//
//  AlertStudioPage.Editor.Fields.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The AlertStudioPage rule-editor operand sections (part 2): the signal + operator
//  selects, the computed-metric panel (rendering every registry state), the severity +
//  allowed-operators hint, and the kind-aware typed-value editor (web `renderValueEditor`).
//

import SwiftUI

// MARK: - Signal + operator

struct ASEditorSignalSection: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        ASResponsivePair {
            signalField
        } trailing: {
            operatorField
        }
    }

    private var signalField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorSignalNameLabel, localize: localize)
            TSSelect(
                selection: Binding(
                    get: { viewModel.editor.signalName },
                    set: { viewModel.handleSignalChange($0) }
                ),
                options: signalOptions
            )
            if let signal = viewModel.selectedSignal {
                let type = localize.string(ASCopy.signalTypeLabel(signal.valueType))
                let category = viewModel.signalCategoryLabel(signal.category)
                Text(ASView.key(localize.format(
                    ASCopy.editorSignalTypeHint,
                    "type",
                    type
                ).replacingOccurrences(of: "{{category}}", with: category)))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var signalOptions: [TSSelectOption<String>] {
        var options: [TSSelectOption<String>] = [
            TSSelectOption("", localize.key(ASCopy.editorSignalNamePrompt))
        ]
        let selected = viewModel.selectedSignal
        if let selected, AlertStudioTemplates.signalCatalogByName[selected.name] == nil {
            let type = localize.string(ASCopy.signalTypeLabel(selected.valueType))
            let label = localize.format(ASCopy.signalCustomOptionLabel, "name", selected.name)
                .replacingOccurrences(of: "{{type}}", with: type)
            options.append(TSSelectOption(selected.name, ASView.key(label)))
        }
        for signal in AlertStudioTemplates.signalCatalog {
            let type = localize.string(ASCopy.signalTypeLabel(signal.valueType))
            let category = viewModel.signalCategoryLabel(signal.category)
            let label = localize.format(ASCopy.signalOptionLabel, "name", signal.name)
                .replacingOccurrences(of: "{{type}}", with: type)
                .replacingOccurrences(of: "{{category}}", with: category)
            options.append(TSSelectOption(signal.name, ASView.key(label)))
        }
        return options
    }

    private var operatorField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorOperatorLabel, localize: localize)
            TSSelect(
                selection: Binding(
                    get: { viewModel.editor.op },
                    set: { viewModel.handleOperatorChange($0) }
                ),
                options: viewModel.allowedOperators.map { op in
                    TSSelectOption(op, localize.key(ASCopy.operatorLabel(op)))
                }
            )
            .disabled(viewModel.editor.signalName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}

// MARK: - Computed-metric operand panel

struct ASComputedMetricPanel: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    private var selectedMetric: ASComputedMetricSummary? {
        viewModel.metrics.first { $0.id == viewModel.editor.metricID }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            switch viewModel.metricsModel.presentation {
            case .loading:
                metricLoading
            case .offlineNoData:
                TSCaption(localize.key(ASCopy.stateOfflineMessage))
            case let .error(retryable):
                TSErrorDisplay(
                    title: localize.key(ASCopy.stateErrorTitle),
                    onRetry: retryable ? { viewModel.metricsModel.start() } : nil
                )
            case .empty:
                TSCaption(localize.key(ASCopy.metricsEmpty))
            case .content:
                fields
            }
        }
    }

    private var metricLoading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 160, height: 14)
            TSSkeleton(height: 36, cornerRadius: TSRadius.md)
        }
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ASFieldLabel(text: ASCopy.metricLabel, localize: localize)
                TSSelect(selection: viewModel.editorBinding(\.metricID), options: metricOptions)
            }
            ASResponsivePair {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ASFieldLabel(text: ASCopy.metricWindowLabel, localize: localize)
                    TSSelect(selection: viewModel.editorBinding(\.metricWindow), options: windowOptions)
                }
            } trailing: {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ASFieldLabel(text: ASCopy.metricOpLabel, localize: localize)
                    TSSelect(selection: viewModel.editorBinding(\.metricOp), options: opOptions)
                }
            }
            TSTextField(
                localize.key(ASCopy.metricThresholdLabel),
                text: viewModel.editorBinding(\.metricThreshold),
                label: localize.key(ASCopy.metricThresholdLabel)
            )
            .asNumericKeyboard()
        }
    }

    private var metricOptions: [TSSelectOption<String>] {
        [TSSelectOption("", localize.key(ASCopy.metricPrompt))]
            + viewModel.metrics.map { TSSelectOption($0.id, ASView.key($0.label)) }
    }

    private var windowOptions: [TSSelectOption<String>] {
        [TSSelectOption("", localize.key(ASCopy.metricWindowPrompt))]
            + (selectedMetric?.windows ?? []).map { TSSelectOption($0, ASView.key($0)) }
    }

    private var opOptions: [TSSelectOption<ASComputedMetricOp>] {
        (selectedMetric?.ops ?? ASComputedMetricOp.allCases).map { op in
            TSSelectOption(op, ASView.key(op.rawValue))
        }
    }
}

// MARK: - Severity + allowed operators

struct ASEditorSeveritySection: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        ASResponsivePair {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ASFieldLabel(text: ASCopy.editorSeverityLabel, localize: localize)
                TSSelect(
                    selection: Binding(
                        get: { viewModel.editor.severity },
                        set: { viewModel.handleSeverityChange($0) }
                    ),
                    options: ASSeverity.allCases.map { severity in
                        TSSelectOption(severity, localize.key(ASCopy.severityLabel(severity)))
                    }
                )
            }
        } trailing: {
            if viewModel.editor.kind != .computedMetric { allowedOperators }
        }
    }

    private var allowedOperators: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ASFieldLabel(text: ASCopy.editorAllowedOperatorsLabel, localize: localize)
                Text(ASView.key(allowedOperatorsText))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
    }

    private var allowedOperatorsText: String {
        if viewModel.editor.signalName.trimmingCharacters(in: .whitespaces).isEmpty {
            return localize.string(ASCopy.editorAllowedOperatorsEmpty)
        }
        return viewModel.allowedOperators
            .map { localize.string(ASCopy.operatorLabel($0)) }
            .joined(separator: "  ")
    }
}

// MARK: - Typed value editor (web `renderValueEditor`)

struct ASTypedValueEditor: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ASFieldLabel(text: ASCopy.editorTypedValueLabel, localize: localize)
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.editor.signalName.trimmingCharacters(in: .whitespaces).isEmpty {
            TSEmptyState(
                title: localize.key(ASCopy.editorNoSignalTitle),
                message: localize.key(ASCopy.editorNoSignalDescription),
                systemImage: "info.circle"
            )
        } else {
            switch AlertStudioAdapter.valueKindForState(viewModel.editor) {
            case .range: rangeEditor
            case .text: textEditor
            case .bool: boolEditor
            case .none: anyChangeNote
            case .number: numberEditor
            }
        }
    }

    private var rangeEditor: some View {
        ASResponsivePair {
            TSTextField(
                localize.key(ASCopy.editorMinValueLabel),
                text: viewModel.editorBinding(\.valueMin),
                label: localize.key(ASCopy.editorMinValueLabel)
            )
            .asNumericKeyboard()
        } trailing: {
            TSTextField(
                localize.key(ASCopy.editorMaxValueLabel),
                text: viewModel.editorBinding(\.valueMax),
                label: localize.key(ASCopy.editorMaxValueLabel)
            )
            .asNumericKeyboard()
        }
    }

    private var textEditor: some View {
        TSTextField(
            localize.key(ASCopy.editorTextValuePrompt),
            text: viewModel.editorBinding(\.valueText),
            label: localize.key(ASCopy.editorTextValueLabel)
        )
    }

    private var boolEditor: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorBooleanValueLabel, localize: localize)
            TSSelect(
                selection: viewModel.editorBinding(\.valueBool),
                options: [
                    TSSelectOption(true, localize.key(ASCopy.booleanLabel(true))),
                    TSSelectOption(false, localize.key(ASCopy.booleanLabel(false)))
                ]
            )
        }
    }

    private var anyChangeNote: some View {
        TSGlassPanel {
            TSCaption(localize.key(ASCopy.editorAnyChangeDescription))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var numberEditor: some View {
        TSTextField(
            localize.key(ASCopy.editorNumericValueLabel),
            text: viewModel.editorBinding(\.valueNum),
            label: localize.key(ASCopy.editorNumericValueLabel)
        )
        .asNumericKeyboard()
    }
}
