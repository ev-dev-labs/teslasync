//
//  SignalQueryControls.Views.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The presentational control subviews composed by `SignalQueryControls`: the signal multi-select
//  (web `SignalMultiSelect` — selected chips + search + filtered dropdown, with the available-signals
//  fetch loading / error / empty states), the From/To range + Quick-Range presets (web
//  `DateTimeRangeControls`), and the rows-per-page select + "Query" action (web `QueryControls`). All
//  consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Field label (web `metric-label`)

/// The small upper-cased muted control label shared by every control (web `metric-label`).
struct SignalQueryFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }
}

// MARK: - Signal multi-select (web `SignalMultiSelect`)

/// The searchable signal multi-select — the native parity of the web `SignalMultiSelect`: the
/// selected chips (each removable), the search field, and the filtered dropdown of available signals
/// (capped at 50 with a "+N more — refine search" footer). Renders the available-signals fetch leaf
/// states inline: the skeleton while loading, the error row with retry, and a friendly empty note
/// when the vehicle exposes no signals.
struct SignalMultiSelectView: View {
    let availableState: SignalQueryAvailableState
    let available: [String]
    let selected: [String]
    let maxSignals: Int?
    let onAdd: (String) -> Void
    let onRemove: (String) -> Void
    let onRetry: () -> Void

    @State private var search = ""
    @FocusState private var searchFocused: Bool

    private var label: String {
        let base = SignalQueryControlsStrings.string("signalQuery.signals", "Signals")
        guard let maxSignals else { return base }
        let suffix = SignalQueryControlsStrings.string("signalQuery.signalsMax", "max %d")
            .replacingOccurrences(of: "%d", with: String(maxSignals))
        return "\(base) (\(suffix))"
    }

    private var searchHint: String {
        selected.isEmpty
            ? SignalQueryControlsStrings.string("signalQuery.searchHint", "Search signals…")
            : SignalQueryControlsStrings.string("signalQuery.addMoreHint", "Add more signals…")
    }

    private var filtered: [String] {
        SignalAvailableFilter.filter(available: available, selected: selected, search: search)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            SignalQueryFieldLabel(text: label)
            if !selected.isEmpty {
                selectedChips
            }
            switch availableState {
            case .loading:
                loadingRows
            case let .error(message):
                SignalQueryInlineError(message: message, onRetry: onRetry)
            case .loaded:
                searchField
                if searchFocused {
                    dropdown
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var selectedChips: some View {
        SignalQueryFlowChips(signals: selected, onRemove: onRemove)
    }

    private var searchField: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: $search, prompt: Text(verbatim: searchHint))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .focused($searchFocused)
                .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
                    "signalQuery.searchLabel", "Search signals"
                )))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var dropdown: some View {
        let visible = SignalAvailableFilter.visible(filtered)
        if visible.rows.isEmpty {
            SignalQueryEmptyNote(text: SignalQueryControlsStrings.string(
                "signalQuery.noSignals", "No signals available"
            ))
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(visible.rows, id: \.self) { signal in
                    Button {
                        onAdd(signal)
                        search = ""
                    } label: {
                        Text(verbatim: signal)
                            .font(Font.TS.bodySm)
                            .monospaced()
                            .foregroundStyle(Color.TS.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, TSSpacing.md)
                            .padding(.vertical, TSSpacing.sm)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
                        "signalQuery.addSignalA11y", "Add signal"
                    ) + " \(signal)"))
                }
                if visible.overflow > 0 {
                    Text(verbatim: SignalQueryControlsStrings.string(
                        "signalQuery.moreResults", "%d more — refine search"
                    ).replacingOccurrences(of: "%d", with: String(visible.overflow)))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }

    private var loadingRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 36, cornerRadius: TSRadius.md)
            TSSkeleton(width: 180, height: 12)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
            "signalQuery.loadingSignals", "Loading available signals"
        )))
    }
}

// MARK: - Date/time range (web `DateTimeRangeControls`)

/// The From/To range + Quick-Range presets — the native parity of `DateTimeRangeControls`. The
/// pickers are native `DatePicker`s (date + time, HIG-idiomatic) and the preset chips highlight the
/// active range (web `aria-pressed`) with the spoken `"{{label}} time range"` label.
struct DateTimeRangeControlsView: View {
    @Binding var from: Date
    @Binding var to: Date
    let activePresetHours: Int?
    let onPreset: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            rangePickers
            presets
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var rangePickers: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            picker(label: SignalQueryControlsStrings.string("signalQuery.from", "From"), date: $from)
            picker(label: SignalQueryControlsStrings.string("signalQuery.to", "To"), date: $to)
        }
    }

    private func picker(label: String, date: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            SignalQueryFieldLabel(text: label)
            DatePicker("", selection: date, displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: label))
        }
    }

    private var presets: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            SignalQueryFieldLabel(text: SignalQueryControlsStrings.string(
                "signalQuery.quickRange", "Quick Range"
            ))
            HStack(spacing: TSSpacing.xs) {
                ForEach(SignalTimeRange.presets) { preset in
                    presetChip(preset)
                }
            }
        }
    }

    private func presetChip(_ preset: TimeRangePreset) -> some View {
        let active = activePresetHours == preset.hours
        return Button {
            onPreset(preset.hours)
        } label: {
            Text(verbatim: preset.label)
                .font(Font.TS.caption)
                .foregroundStyle(active ? Color.TS.textPrimary : Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    active ? Color.TS.accent.opacity(0.12) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(
                            active ? Color.TS.accent.opacity(0.4) : Color.TS.border,
                            lineWidth: 1
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.presetAria(label: preset.label)))
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Query controls (web `QueryControls`)

/// The rows-per-page select + "Query" action — the native parity of `QueryControls`. The select is a
/// native menu `Picker` over `PAGE_SIZES`; the button shows a play glyph when idle and a spinner while
/// the query is in flight (disabled computed, never literal).
struct QueryControlsView: View {
    @Binding var perPage: Int
    let disabled: Bool
    let loading: Bool
    let onQuery: () -> Void

    private var queryLabel: String {
        SignalQueryControlsStrings.string("signalQuery.query", "Query")
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                SignalQueryFieldLabel(text: SignalQueryControlsStrings.string("signalQuery.rows", "Rows"))
                Picker("", selection: $perPage) {
                    ForEach(SignalPaging.pageSizes, id: \.self) { size in
                        Text(verbatim: String(size)).tag(size)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
                    "signalQuery.rows", "Rows"
                )))
            }
            TSButton(variant: .primary, size: .small, isLoading: loading, action: onQuery) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: queryLabel)
                }
            }
            .disabled(disabled)
            .accessibilityLabel(Text(verbatim: queryLabel))
        }
    }
}
