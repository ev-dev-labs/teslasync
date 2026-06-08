//
//  TriggerConfigurator.Views.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The shared presentational primitives composed by the per-kind editors: the freshness /
//  connectivity chip, the labeled menu select (the web `Select` mapped to a native menu
//  `Picker` resolved through the P1/S10 facade), the labeled text field (the web `Input`),
//  the weekday toggle row (the web day buttons), and the geofence picker field that renders
//  every loading / error / empty / data + stale / offline state the web `useGeofences`
//  query implies. All consume the P1/S10 facade + the shared P1/S9 tokens — no Tailwind
//  ports, no networking.
//

import SwiftUI

// MARK: - Freshness / connectivity chip (runtime string)

/// A small tinted capsule mirroring the shared `TSBadge` styling, but taking the runtime
/// string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs the stale / offline
/// overlays the geofence query produces.
struct TCChip: View {
    let text: String
    let systemImage: String
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.caption2)
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Labeled menu select (web `Select`)

/// The web `Select` mapped to a native menu `Picker`. Option labels resolve through the
/// surface i18n facade and render verbatim (the house convention — `TSSelect` is
/// `LocalizedStringKey`-bound and cannot express the per-surface table).
struct TCSelectRow<Value: Hashable & Sendable>: View {
    let labelKey: String
    let labelFallback: String
    let options: [TriggerOption<Value>]
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: TCStrings.string(labelKey, labelFallback))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: TCStrings.string(option.labelKey, option.fallback)).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: TCStrings.string(labelKey, labelFallback)))
        }
    }
}

// MARK: - Labeled text field (web `Input`)

/// The web `Input` mapped to a native `TextField` with the shared field chrome, an optional
/// prompt + hint, and an optional numeric keyboard. Label + prompt + hint resolve through
/// the facade.
struct TCField: View {
    let labelKey: String
    let labelFallback: String
    @Binding var text: String
    var promptKey: String?
    var promptFallback: String?
    var hintKey: String?
    var hintFallback: String?
    var numeric = false

    private var promptText: Text {
        if let promptKey, let promptFallback {
            return Text(verbatim: TCStrings.string(promptKey, promptFallback))
        }
        return Text(verbatim: "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: TCStrings.string(labelKey, labelFallback))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField(text: $text, prompt: promptText) {
                Text(verbatim: TCStrings.string(labelKey, labelFallback))
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .tcNumericKeyboard(numeric)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: TCStrings.string(labelKey, labelFallback)))
            if let hintKey, let hintFallback {
                Text(verbatim: TCStrings.string(hintKey, hintFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

// MARK: - Weekday toggle row (web day buttons)

/// The simple-schedule weekday selector — seven toggle chips (web `DAYS.map(...)`). An empty
/// selection renders every day active (web `selectedDays.length === 0 || includes`).
struct DaysToggleRow: View {
    let selectedDays: [Int]
    let onToggle: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: TCStrings.string("automations.builder.days", "Days"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< TriggerAdapter.weekdayCount, id: \.self) { index in
                    dayButton(index)
                }
            }
        }
    }

    private func dayButton(_ index: Int) -> some View {
        let active = TriggerAdapter.isDayActive(selectedDays, index)
        let title = TCStrings.string(WeekdayCatalog.shortKey(index), WeekdayCatalog.shortFallbacks[index])
        return Button {
            onToggle(index)
        } label: {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .frame(width: 40, height: 40)
                .background(
                    active ? Color.TS.accent.opacity(0.2) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(
                            active ? Color.TS.accent.opacity(0.5) : Color.TS.border,
                            lineWidth: 1
                        )
                )
                .foregroundStyle(active ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TriggerConfiguratorAccessibility.dayLabel(
            day: title,
            active: active,
            localize: TCStrings.string
        )))
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Geofence picker field (web geofence `Select` + the query states)

/// The geofence dropdown (web `geofenceOptions`) wired to the resolved geofence query
/// state. The web maps `geofences ?? []` silently; the production native surface renders the
/// loading / error / empty / data branches + the stale / offline overlays the P4 states
/// contract requires, never a blank control.
struct TriggerConfiguratorGeofencePickerField: View {
    let phase: GeofenceResolved.Phase
    let geofences: [Geofence]
    let isStale: Bool
    let isOffline: Bool
    @Binding var selection: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: TCStrings.string("automations.builder.geofence", "Geofence"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if isStale {
                TCChip(
                    text: TCStrings.string("automations.builder.geofenceStale", "Stale"),
                    systemImage: "clock.arrow.circlepath",
                    tone: .warning
                )
            }
            if isOffline {
                TCChip(
                    text: TCStrings.string("automations.builder.geofenceOffline", "Offline"),
                    systemImage: "wifi.slash",
                    tone: .neutral
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            loadingRow
        case let .error(message):
            GeofenceErrorRow(message: message, onRetry: onRetry)
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                picker
                Text(verbatim: TCStrings.string("automations.builder.geofenceEmpty", "No geofences defined yet."))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        case .data:
            picker
        }
    }

    private var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: TCStrings.string("automations.builder.geofenceLoading", "Loading geofences…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: TCStrings.string(
            "automations.builder.geofenceLoading", "Loading geofences…"
        )))
    }

    private var picker: some View {
        Picker(selection: $selection) {
            Text(verbatim: TCStrings.string("automations.builder.selectGeofence", "Select geofence..."))
                .tag("")
            ForEach(geofences) { geofence in
                Text(verbatim: geofence.name).tag(geofence.id)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: TCStrings.string("automations.builder.geofence", "Geofence")))
        .accessibilityValue(Text(verbatim: TriggerConfiguratorAccessibility.geofenceValue(
            selectedName: geofences.first { $0.id == selection }?.name,
            localize: TCStrings.string
        )))
    }
}

/// The geofence query failure box with a retry affordance (the P4 `QueryError` equivalent),
/// wired to the model's refresh.
struct GeofenceErrorRow: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: TCStrings.string(
                    "automations.builder.geofenceError",
                    "Could not load geofences."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                Text(verbatim: TCStrings.string("automations.builder.geofenceRetry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: TCStrings.string("automations.builder.geofenceRetry", "Retry")))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Numeric keyboard helper (iOS only)

extension View {
    /// Applies the numeric keyboard on iOS; a no-op on macOS (no `keyboardType`).
    @ViewBuilder
    func tcNumericKeyboard(_ numeric: Bool) -> some View {
        #if os(iOS)
            if numeric {
                keyboardType(.numbersAndPunctuation)
            } else {
                self
            }
        #else
            self
        #endif
    }
}
