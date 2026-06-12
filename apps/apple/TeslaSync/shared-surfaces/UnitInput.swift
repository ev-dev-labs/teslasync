//
//  UnitInput.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  The unit-field surface — the SwiftUI parity of `components/forms/UnitInput.tsx`. The web component
//  is a controlled, settings-aware number field: it stores its value in TeslaSync's canonical metric
//  (miles, mph, °C, kWh, percent, currency-as-typed), renders it in the user's preferred display unit
//  derived from `useSettings()`, parses typed text on blur / Enter (locale-aware separators + a
//  tolerated unit symbol), and re-syncs from the parent's `value` WITHOUT clobbering in-progress
//  typing. This surface reproduces that field and adds the P4 leaf states (loading / error / stale /
//  offline) so it never collapses to a blank box. It binds through `UnitInputFieldModel` (P1/S8); no
//  networking lives here.
//
//  Type-name note: the view is `UnitInputField` (not `UnitInput`) to leave the bare `UnitInput` name
//  free for the value domain; the diagnostics slug stays "UnitInput" (the web source name).
//
//  States (every one renders — no hidden surface):
//    • loading  — the bound value's fetch in flight → skeleton field.
//    • ready    — the editable field; renders whether the value is empty (with a "not set" hint) or
//                 populated, never a blank box.
//    • error    — the parent's settings fetch failed → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the field with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - UnitInputField (the shared surface)

/// The unit-field surface — the SwiftUI parity of `components/forms/UnitInput.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through `UnitInputFieldModel`.
public struct UnitInputField: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = UnitInputFieldMeta.surfaceSlug

    @State private var model: UnitInputFieldModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8
    /// source through it; previews + tests inject an in-memory source).
    public init(model: UnitInputFieldModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<UnitInput value={…} unit="energy" label={…} onChange={…} />`. Wires a
    /// `LiveUnitInputFieldSource` over the value snapshot and forwards commits to `onChange`.
    public init(
        value: Double?,
        unit: UnitInputFieldKind,
        label: String,
        settings: UnitInputFieldSettings = UnitInputFieldSettings(),
        parseStrict: Bool = false,
        isRequired: Bool = false,
        isDisabled: Bool = false,
        telemetry: any UnitInputFieldTelemetry = OSLogUnitInputFieldTelemetry(),
        onChange: @escaping @MainActor (Double?) -> Void
    ) {
        let input = UnitInputFieldInput(
            value: value,
            kind: unit,
            settings: settings,
            label: label,
            parseStrict: parseStrict,
            isRequired: isRequired,
            isDisabled: isDisabled
        )
        let source = LiveUnitInputFieldSource(value: input, onCommit: onChange)
        _model = State(initialValue: UnitInputFieldModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            content
            if model.connection != .live {
                UnitInputFieldFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            UnitInputFieldLoadingView()
        case let .error(message):
            UnitInputFieldErrorView(message: message) { model.refresh() }
        case .ready:
            UnitInputFieldReadyView(model: model, resolved: model.resolved)
        }
    }
}
