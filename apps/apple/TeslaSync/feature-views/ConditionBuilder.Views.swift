//
//  ConditionBuilder.Views.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The presentational pieces the surface composes: the per-row glass panel (web
//  `GlassPanel`) carrying the kind select + the per-kind field editor + the remove
//  affordance, the geofence picker that renders EVERY state of the `useGeofences`
//  source (loading / content / empty / error / stale / offline), the freshness chip,
//  and the day-of-week toggle. All strings resolve through the P1/S10 `CBStrings`
//  facade; all colors/spacing come from the P1/S9 tokens — no Tailwind ported.
//

import SwiftUI

// MARK: - SwiftUI i18n helpers (web `t(key, default)`)

/// Bridges the `CBStrings` facade into the SwiftUI text types the shared components
/// expect, so no view holds a hardcoded literal and runtime-resolved strings flow
/// into `LocalizedStringKey`-typed component parameters verbatim.
enum CBView {
    /// A `LocalizedStringKey` that renders an already-resolved string verbatim.
    static func key(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }

    /// A `LocalizedStringKey` for an `i18n` descriptor, resolved through the facade.
    static func key(_ descriptor: LocalizedText) -> LocalizedStringKey {
        key(CBStrings.string(descriptor))
    }

    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: CBStrings.string(key, fallback))
    }
}

// MARK: - Condition row panel (web per-condition `<GlassPanel>`)

/// One editable condition row (web `conditions.map(...) → <GlassPanel>`): the kind
/// select (labeled only on the first row, web `index === 0`), the per-kind field
/// editor, and the remove affordance.
struct ConditionRowPanel: View {
    @Binding var condition: AutomationConditionInput
    let isFirst: Bool
    let geofenceModel: GeofenceOptionsModel
    let onRemove: () -> Void

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    kindSelect
                    fields
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                removeButton
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var kindSelect: some View {
        TSSelect(
            selection: kindBinding,
            options: AutomationConditionKind.allCases.map { kind in
                TSSelectOption(kind, CBView.key(kind.label))
            },
            label: isFirst ? CBView.key("automations.builder.conditionType", "Condition Type") : nil
        )
    }

    @ViewBuilder
    private var fields: some View {
        switch condition.body {
        case .signal:
            SignalFields(condition: signalBinding)
        case .timeWindow:
            TimeWindowFields(condition: timeWindowBinding)
        case .geofence:
            GeofenceFields(condition: geofenceBinding, geofenceModel: geofenceModel)
        case .otherAutomation:
            OtherAutomationFields(condition: otherBinding)
        }
    }

    private var removeButton: some View {
        Button(action: onRemove) {
            Image(systemName: "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
        }
        .buttonStyle(.plain)
        .padding(.top, TSSpacing.xl)
        .accessibilityLabel(
            Text(verbatim: CBStrings.string("automations.builder.removeCondition", "Remove condition"))
        )
    }

    // MARK: Bindings (web `replaceCondition`)

    private var kindBinding: Binding<AutomationConditionKind> {
        Binding(
            get: { condition.body.kind },
            set: { condition.body = ConditionBuilderAdapter.defaultCondition(kind: $0) }
        )
    }

    private var signalBinding: Binding<SignalCondition> {
        Binding(
            get: { condition.body.asSignal ?? defaultSignal },
            set: { condition.body = .signal($0) }
        )
    }

    private var timeWindowBinding: Binding<TimeWindowCondition> {
        Binding(
            get: { condition.body.asTimeWindow ?? defaultTimeWindow },
            set: { condition.body = .timeWindow($0) }
        )
    }

    private var geofenceBinding: Binding<GeofenceCondition> {
        Binding(
            get: { condition.body.asGeofence ?? GeofenceCondition(placeId: 0, state: .inside) },
            set: { condition.body = .geofence($0) }
        )
    }

    private var otherBinding: Binding<OtherAutomationCondition> {
        Binding(
            get: { condition.body.asOtherAutomation ?? OtherAutomationCondition(otherAutomationId: 0, state: .enabled)
            },
            set: { condition.body = .otherAutomation($0) }
        )
    }

    private var defaultSignal: SignalCondition {
        ConditionBuilderAdapter.defaultCondition(kind: .signal).asSignal
            ?? SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20)
    }

    private var defaultTimeWindow: TimeWindowCondition {
        ConditionBuilderAdapter.defaultCondition(kind: .timeWindow).asTimeWindow
            ?? TimeWindowCondition(startTime: "06:00", endTime: "09:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5])
    }
}

extension CBView {
    /// Overload that pairs a facade key with its English fallback for a `LocalizedStringKey`.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        self.key(CBStrings.string(key, fallback))
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// Header chip flagging live / stale / offline geofence options (web freshness hint).
struct CBFreshnessChip: View {
    let freshness: GeofenceFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: CBStrings.string("automations.builder.live", "Live")
        case .stale: CBStrings.string("automations.builder.stale", "Stale")
        case .offline: CBStrings.string("automations.builder.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Geofence picker (web geofence `<UiSelect>`, every source state)

/// The geofence select bound to the `useGeofences` source. Renders the placeholder + // parity:allow ui
/// loaded options (web `geofenceOptions`) and, per the P4 states contract, the
/// loading / empty / error / stale / offline chrome of the geofence query.
struct GeofencePickerField: View {
    @Binding var placeId: Int
    let geofenceModel: GeofenceOptionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content
        }
        .frame(maxWidth: 240, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            TSLabel(CBView.key("automations.builder.geofence", "Geofence"))
            Spacer(minLength: TSSpacing.sm)
            if case let .content(_, freshness, _) = geofenceModel.presentation, freshness != .live {
                CBFreshnessChip(freshness: freshness)
            } else if case let .empty(freshness) = geofenceModel.presentation, freshness != .live {
                CBFreshnessChip(freshness: freshness)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch geofenceModel.presentation {
        case .loading:
            loadingRow
        case let .content(options, _, refreshing):
            picker(options: options, refreshing: refreshing)
        case .empty:
            picker(options: [], refreshing: false)
                .overlay(alignment: .bottomLeading) { emptyHint.offset(y: 22) }
        case .offlineNoData:
            CBInlineState(
                symbol: "wifi.slash",
                message: CBStrings.string("automations.builder.geofenceOffline", "Offline — showing no saved places"),
                tone: .neutral
            ) { geofenceModel.refresh() }
        case let .error(retryable):
            CBInlineState(
                symbol: "exclamationmark.triangle.fill",
                message: CBStrings.string("automations.builder.geofenceError", "Couldn't load saved places"),
                tone: .danger,
                onRetry: retryable ? { geofenceModel.refresh() } : nil
            )
        }
    }

    private func picker(options: [GeofenceOption], refreshing: Bool) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSSelect(selection: selectionBinding, options: pickerOptions(options))
            if refreshing { ProgressView().controlSize(.mini) }
        }
    }

    private var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: CBStrings.string("automations.builder.geofenceLoading", "Loading saved places…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var emptyHint: some View {
        Text(verbatim: CBStrings.string("automations.builder.geofenceEmpty", "No saved places yet."))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func pickerOptions(_ options: [GeofenceOption]) -> [TSSelectOption<String>] {
        let placeholder = TSSelectOption( // parity:allow ui
            "", CBView.key("automations.builder.selectGeofence", "Select geofence...")
        )
        return [placeholder] + options.map { TSSelectOption($0.id, CBView.key($0.name)) } // parity:allow ui
    }

    private var selectionBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.geofenceSelection(placeId: placeId) },
            set: { placeId = ConditionBuilderAdapter.geofencePlaceId(from: $0) }
        )
    }
}

// MARK: - Inline state (error / offline) with optional retry

/// A compact inline state row (web `QueryError` / offline fallback) used by the
/// geofence picker's error + offline branches, with an optional retry affordance.
struct CBInlineState: View {
    let symbol: String
    let message: String
    let tone: TSTone
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let onRetry {
                Button(action: onRetry) {
                    Text(verbatim: CBStrings.string("automations.builder.retry", "Retry"))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: CBStrings.string("automations.builder.retry", "Retry")))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Day-of-week toggle (web day buttons)

/// One day toggle button (web `DAYS.map(...) → <UiButton aria-pressed>`).
struct CBDayToggle: View {
    let dayIndex: Int
    let isActive: Bool
    let onToggle: () -> Void

    private var title: String {
        CBStrings.string("common.days.short.\(dayIndex)", ConditionBuilderAdapter.dayShortNames[dayIndex])
    }

    var body: some View {
        Button(action: onToggle) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .frame(width: 36, height: 36)
                .background(
                    isActive ? Color.TS.accent.opacity(0.2) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(isActive ? Color.TS.accent.opacity(0.5) : Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}
