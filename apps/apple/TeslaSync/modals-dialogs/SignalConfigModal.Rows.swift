//
//  SignalConfigModal.Rows.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The category section + signal row leaf views `SignalConfigPopulatedView` composes (split from the
//  chrome for the lint file-length budget): the collapsible category header (expand chevron,
//  tri-state checkbox, category icon, name + tally, and the per-category "Set all…" interval menu),
//  the per-signal row (checkbox + monospaced name + per-signal interval picker), and the shared
//  checkbox + interval-tone helpers. Category + field names are Tesla-domain data rendered verbatim;
//  all chrome copy resolves through P1/S10. Binds through `SignalConfigModel` (P1/S8).
//

import SwiftUI

// MARK: - Category section (web category group)

/// One collapsible category section (web category `<div>`): the header (expand chevron, tri-state
/// checkbox, icon, name + "(selected/total)", and the per-category interval menu) over the signal
/// rows shown while expanded.
struct SignalConfigCategorySection: View {
    @Bindable var model: SignalConfigModel
    let group: SignalConfigGroup

    private var expanded: Bool {
        model.isExpanded(group.category)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if expanded {
                VStack(spacing: 0) {
                    ForEach(group.rows) { row in
                        SignalConfigSignalRow(model: model, row: row)
                        if row.id != group.rows.last?.id {
                            Divider().overlay(Color.TS.border).padding(.leading, TSSpacing.x3xl)
                        }
                    }
                }
            }
        }
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            SignalConfigCategoryCheckbox(
                state: model.categoryState(group.category),
                label: checkboxLabel
            ) {
                model.toggleCategory(group.category)
            }
            expandButton
            Spacer(minLength: TSSpacing.sm)
            SignalConfigCategoryIntervalMenu(model: model, category: group.category)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
    }

    private var expandButton: some View {
        Button {
            model.toggleExpanded(group.category)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(expanded ? 0 : -90))
                Image(systemName: SignalConfigProjection.iconSystemName(for: group.category))
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: group.category)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Text(verbatim: tally)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.categoryAccessibilityLabel(group)))
        .accessibilityHint(Text(verbatim: SignalConfigStrings.string(
            "signals.config.expandHint", "Expands or collapses this category"
        )))
    }

    private var tally: String {
        let counts = SignalConfigProjection.categoryTally(rows: group.rows)
        return "(\(counts.selected)/\(counts.total))"
    }

    private var checkboxLabel: String {
        SignalConfigStrings.string(
            "signals.config.toggleCategory", "Toggle all {{category}} signals", "{{category}}", group.category
        )
    }
}

// MARK: - Signal row (web signal `<div>`)

/// One signal row (web `catSignals.map` row): the selection checkbox, the monospaced field name, and
/// the per-signal interval picker. The whole row dims when unselected (web `opacity-40`).
struct SignalConfigSignalRow: View {
    @Bindable var model: SignalConfigModel
    let row: SignalConfigRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            SignalConfigCheckbox(
                selected: row.selected,
                label: model.rowAccessibilityLabel(row)
            ) {
                model.toggleSignal(row.name)
            }
            Text(verbatim: row.name)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(row.selected ? Color.TS.textPrimary : Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            SignalConfigRowIntervalPicker(model: model, row: row)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .opacity(row.selected ? 1 : 0.55)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Checkboxes

/// A binary selection checkbox (web per-signal checkbox).
struct SignalConfigCheckbox: View {
    let selected: Bool
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: selected ? "checkmark.square.fill" : "square")
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A tri-state category checkbox (web category checkbox: all / some / none).
struct SignalConfigCategoryCheckbox: View {
    let state: SignalConfigCategoryState
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(state == .none ? Color.TS.textMuted : Color.TS.accent)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(state == .all ? .isSelected : [])
    }

    private var symbol: String {
        switch state {
        case .all: "checkmark.square.fill"
        case .some: "minus.square.fill"
        case .none: "square"
        }
    }
}

// MARK: - Interval pickers

/// The per-signal interval picker (web per-signal `<Select>`): sets one row's cadence, tinted by the
/// cadence band.
struct SignalConfigRowIntervalPicker: View {
    @Bindable var model: SignalConfigModel
    let row: SignalConfigRow

    var body: some View {
        Picker(selection: selection) {
            ForEach(SignalConfigCatalog.intervals) { option in
                Text(verbatim: option.label).tag(option.value)
            }
        } label: {
            EmptyView()
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .tint(SignalConfigToneColor.color(for: SignalConfigCatalog.interval(for: row.interval).tone))
        .fixedSize()
        .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(
            "signals.config.rowIntervalA11y", "Streaming interval for {{name}}", "{{name}}", row.name
        )))
    }

    private var selection: Binding<Int> {
        Binding(get: { row.interval }, set: { model.setSignalInterval(row.name, interval: $0) })
    }
}

/// The per-category "Set all…" interval menu (web per-category `<Select>` that applies on change):
/// sets every signal in the category to the chosen cadence.
struct SignalConfigCategoryIntervalMenu: View {
    @Bindable var model: SignalConfigModel
    let category: String

    var body: some View {
        Menu {
            ForEach(SignalConfigCatalog.intervals) { option in
                Button {
                    model.setCategoryInterval(category, interval: option.value)
                } label: {
                    Text(verbatim: "\(option.label) · \(model.localize(option.descKey, option.descFallback))")
                }
            }
        } label: {
            HStack(spacing: 2) {
                Text(verbatim: SignalConfigStrings.string("signals.config.setAll", "Set all…"))
                    .font(Font.TS.caption)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .fixedSize()
        .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(
            "signals.config.setAllA11y", "Set the interval for all {{category}} signals", "{{category}}", category
        )))
    }
}

// MARK: - Interval tone → token tint

/// Maps a cadence band to a semantic token tint (web `INTERVAL_OPTIONS[i].color`, toned to the
/// design system so neon is reserved for chips).
enum SignalConfigToneColor {
    static func color(for tone: SignalConfigIntervalTone) -> Color {
        switch tone {
        case .realtime, .fast: Color.TS.accent
        case .medium, .standard: Color.TS.textSecondary
        case .slow, .rare: Color.TS.textMuted
        }
    }
}
