//
//  NotificationFilterBar.Controls.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The interactive controls composed into the populated content: the severity chip
//  group (web multi-select severity buttons), the vehicle + rule pickers (web `Select`),
//  the search field (web `SearchInput`), the from/to date range (web `RangePicker`), and
//  the active-filter chips (web `ActiveFilterChips`). Token-driven (P1/S9); copy via the
//  P1/S10 facade. The view performs no networking — every edit routes through the model.
//

import SwiftUI

// MARK: - Severity chips (web multi-select severity buttons)

/// The severity chip group (web `SEVERITY_OPTIONS.map`): three multi-select toggles
/// wrapped in an accessibility group labeled "Severity" (web `role="group"`).
struct NotificationSeverityBar: View {
    @Bindable var model: NotificationFilterModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(NotificationSeverity.allCases) { severity in
                NotificationSeverityChip(
                    severity: severity,
                    isActive: model.filters.severity.contains(severity),
                    label: model.localize(severity.localizationKey, severity.fallback),
                    action: { model.toggleSeverity(severity) }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.localize("notifications.inbox.filter.severity", "Severity")))
    }
}

/// One severity chip (web ghost button with the active tint + ring). The active chip
/// reads as a selected trait for VoiceOver (web `aria-pressed`).
struct NotificationSeverityChip: View {
    let severity: NotificationSeverity
    let isActive: Bool
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: severity.iconSystemName)
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(isActive ? severity.tone : Color.TS.textSecondary)
            .background(isActive ? severity.tone.opacity(0.15) : Color.clear, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    isActive ? severity.tone.opacity(0.4) : Color.TS.border,
                    lineWidth: 1
                )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

private extension NotificationSeverity {
    /// The semantic tone mapped from the web Tailwind color (blue / amber / rose) to the
    /// design-token status colors, so light/dark themes stay correct.
    var tone: Color {
        switch self {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }
}

// MARK: - Option picker (web `Select`)

/// One selectable option for `NotificationOptionPicker`.
struct NotificationPickerOption: Identifiable, Equatable {
    let id: Int
    let label: String
}

/// A single-select picker over a native `Menu` (web `<Select>`): an "All …" entry plus
/// each option, with a checkmark on the current value and a bordered trigger showing it.
struct NotificationOptionPicker: View {
    let accessibilityLabel: String
    let allLabel: String
    let options: [NotificationPickerOption]
    let selectedID: Int?
    let onSelect: (Int?) -> Void

    private var currentLabel: String {
        guard let selectedID, let match = options.first(where: { $0.id == selectedID }) else {
            return allLabel
        }
        return match.label
    }

    var body: some View {
        Menu {
            Button { onSelect(nil) } label: { optionLabel(allLabel, selected: selectedID == nil) }
            ForEach(options) { option in
                Button { onSelect(option.id) } label: {
                    optionLabel(option.label, selected: option.id == selectedID)
                }
            }
        } label: {
            trigger
        }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: currentLabel))
    }

    private var trigger: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: currentLabel)
                .font(Font.TS.caption)
                .foregroundStyle(selectedID == nil ? Color.TS.textSecondary : Color.TS.textPrimary)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 116, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func optionLabel(_ title: String, selected: Bool) -> some View {
        if selected {
            Label(title, systemImage: "checkmark")
        } else {
            Text(verbatim: title)
        }
    }
}

// MARK: - Search field (web `SearchInput`)

/// The inline message search field — a magnifying glass, a bound text field whose web
/// key is the prompt, and a clear button when non-empty. Edits route through `setQuery`.
struct NotificationSearchField: View {
    @Bindable var model: NotificationFilterModel

    /// The web search prompt copy, isolated so the i18n key (a literal key name from the
    /// web source) stays an explicit, scanner-acknowledged constant rather than a stub.
    private enum SearchCopy {
        static let key = "notifications.inbox.filter.searchPlaceholder" // parity:allow web i18n key name, not a stub
        static let fallback = "Search messages…"
    }

    private var query: String {
        model.filters.query ?? ""
    }

    var body: some View {
        let binding = Binding(get: { model.filters.query ?? "" }, set: { model.setQuery($0) })
        let promptText = model.localize(SearchCopy.key, SearchCopy.fallback)
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: binding, prompt: Text(verbatim: promptText))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(Text(verbatim: promptText))
            if !query.isEmpty {
                Button { model.setQuery("") } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    Text(verbatim: model.localize("notifications.inbox.filter.clearSearch", "Clear search"))
                )
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Date range (web `RangePicker` over from/to ISO dates)

/// The ISO `yyyy-MM-dd` boundary the date fields read + write (web `from`/`to` strings,
/// sliced to 10 chars). Pure + bundle-free so the model's setters stay testable.
enum NotificationDateFormat {
    static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return formatter.date(from: String(value.prefix(10)))
    }

    static func string(_ date: Date) -> String {
        formatter.string(from: date)
    }
}

/// The from/to date range (web `RangePicker`): two labeled date fields that emit ISO
/// `yyyy-MM-dd` strings the model merges into `from` / `to`.
struct NotificationDateRangeField: View {
    @Bindable var model: NotificationFilterModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            NotificationDateField(
                label: model.localize("notifications.inbox.filter.from", "From"),
                value: model.filters.from,
                onSet: { model.setFrom($0) },
                onClear: { model.setFrom("") }
            )
            NotificationDateField(
                label: model.localize("notifications.inbox.filter.to", "To"),
                value: model.filters.to,
                onSet: { model.setTo($0) },
                onClear: { model.setTo("") }
            )
            Spacer(minLength: 0)
        }
    }
}

/// One labeled date field: a `DatePicker` + clear button when a date is set, or a
/// "set date" affordance when empty — so both states render, never a blank box.
struct NotificationDateField: View {
    let label: String
    let value: String?
    let onSet: (String) -> Void
    let onClear: () -> Void

    private var displayValue: String {
        guard let value, !value.isEmpty else { return "—" }
        return String(value.prefix(10))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            content
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: displayValue))
    }

    @ViewBuilder
    private var content: some View {
        if let date = NotificationDateFormat.parse(value) {
            HStack(spacing: TSSpacing.xs) {
                DatePicker(
                    "",
                    selection: Binding(get: { date }, set: { onSet(NotificationDateFormat.string($0)) }),
                    displayedComponents: .date
                )
                .labelsHidden()
                .accessibilityLabel(Text(verbatim: label))
                Button(action: onClear) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    Text(verbatim: NotificationFilterStrings.string(
                        "notifications.inbox.filter.removeFilter", "Remove filter"
                    ))
                )
            }
        } else {
            Button { onSet(NotificationDateFormat.string(Date())) } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "calendar").font(.system(size: 11, weight: .medium))
                    Text(verbatim: "—").font(Font.TS.caption)
                }
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Active-filter chips (web `ActiveFilterChips`)

/// The removable active-filter tokens + a "Clear all" affordance (web `ActiveFilterChips`).
/// Scrolls horizontally so many chips never clip.
struct NotificationActiveChips: View {
    let chips: [NotificationActiveChip]
    let onRemove: (NotificationActiveChip) -> Void
    let onClearAll: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                ForEach(chips) { chip in
                    NotificationActiveChipToken(chip: chip) { onRemove(chip) }
                }
                if !chips.isEmpty {
                    Button(action: onClearAll) {
                        NotificationFilterStrings.text("notifications.inbox.filter.clearAll", "Clear all")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, TSSpacing.xs)
        }
    }
}

/// One active-filter chip token: "{label}: {value}" with an x button (web removable chip).
struct NotificationActiveChipToken: View {
    let chip: NotificationActiveChip
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(chip.label): \(chip.value)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(
                NotificationFilterStrings.text("notifications.inbox.filter.removeFilter", "Remove filter")
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 4)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
