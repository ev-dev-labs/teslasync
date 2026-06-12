//
//  RangePicker.Views.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The presentational pieces of the date-range filter — the native peers of the web elements: the trigger
//  button (web calendar glyph + active-preset label + formatted range + chevron), the popover body (web
//  preset listbox + calendar + footer), the preset rows (web `role="option"`), the footer (web compare
//  toggle / staged day-count + Cancel / Apply), one calendar day cell, and the P4 leaf chrome (loading
//  skeleton trigger, error tile with retry, friendly empty popover, freshness chip). All chrome is token-
//  driven (P1/S9); every string resolves through the P1/S10 facade; every interactive element carries a
//  VoiceOver label. No networking — every affordance routes back through the state-holder.
//

import SwiftUI

// MARK: - Trigger (web trigger button)

/// The trigger — a calendar glyph, the active-preset label, the formatted range, and a chevron. Its
/// accessible name is the static "Date range" (web `aria-label`); its value is the range + day count.
struct RangePickerTrigger: View {
    let projection: RangePickerProjection
    let size: RangePickerSize
    let action: () -> Void

    private var font: Font {
        size == .medium ? Font.TS.body : Font.TS.caption
    }

    private var height: CGFloat {
        size == .medium ? 40 : 32
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                    .font(.system(size: size == .medium ? 14 : 12))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: projection.triggerLabel)
                    .font(font).fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(verbatim: "· \(projection.triggerSubLabel)")
                    .font(font)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, TSSpacing.md)
            .frame(height: height)
            .background(Color.TS.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(RoundedRectangle(cornerRadius: TSRadius.md).strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: RangePickerStrings.triggerLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .accessibilityHint(Text(verbatim: RangePickerStrings.popoverLabel))
    }

    private var accessibilityValue: String {
        "\(projection.triggerSubLabel) · \(RangePickerStrings.summaryDays(projection.dayCount))"
    }
}

// MARK: - Popover content (web popover body)

/// The popover body — the preset listbox beside the calendar + footer (web `flex md:flex-row`), collapsing
/// to a single column on a narrow popover. Shows the friendly empty content when there is nothing to pick.
struct RangePickerPopoverContent: View {
    @Bindable var model: RangePickerModel

    var body: some View {
        let projection = model.projection
        Group {
            if projection.isEmpty {
                RangePickerEmptyContent()
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: TSSpacing.md) { sections(projection) }
                    VStack(alignment: .leading, spacing: TSSpacing.md) { sections(projection) }
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 640)
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RangePickerStrings.popoverLabel))
    }

    @ViewBuilder
    private func sections(_ projection: RangePickerProjection) -> some View {
        RangePickerPresetList(presets: projection.presets) { model.selectPreset($0) }
            .frame(minWidth: 150, alignment: .leading)
        if projection.showsCalendar {
            VStack(spacing: TSSpacing.sm) {
                RangePickerCalendarView(
                    stagedStart: model.stagedStart,
                    stagedEnd: model.stagedEnd,
                    endISO: model.input.value.end,
                    minISO: model.minISO,
                    maxISO: model.maxISO,
                    firstWeekday: model.firstWeekday,
                    calendar: model.calendar,
                    onPick: { model.pickDay($0) }
                )
                Divider().overlay(Color.TS.border)
                RangePickerFooter(model: model)
            }
        }
    }
}

// MARK: - Preset list (web `role="listbox"`)

/// The preset listbox — one row per resolvable preset; a tap commits + closes (web preset `onClick`). The
/// active preset is highlighted and carries the selected trait (web `aria-selected`).
struct RangePickerPresetList: View {
    let presets: [RangePickerPresetRow]
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(presets) { row in
                Button { onSelect(row.id) } label: {
                    Text(verbatim: row.label)
                        .font(Font.TS.caption).fontWeight(.medium)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .foregroundStyle(row.isActive ? Color.white : Color.TS.textPrimary)
                        .background(
                            row.isActive ? Color.TS.accent : Color.clear,
                            in: RoundedRectangle(cornerRadius: TSRadius.sm)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(row.isActive ? [.isButton, .isSelected] : .isButton)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RangePickerStrings.presetGroupLabel))
    }
}

// MARK: - Footer (web compare toggle / staged day-count + Cancel / Apply)

/// The footer — the compare toggle (web `enableCompare`) or the staged day-count summary, plus Cancel and an
/// Apply that is disabled until the staged range is dirty (web `disabled={!stagedDirty}`).
struct RangePickerFooter: View {
    @Bindable var model: RangePickerModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            leading
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small) { model.cancel() } label: {
                Text(verbatim: RangePickerStrings.cancel)
            }
            TSButton(variant: .primary, size: .small) { model.apply() } label: {
                Text(verbatim: RangePickerStrings.apply)
            }
            .disabled(!model.stagedDirty)
        }
    }

    @ViewBuilder
    private var leading: some View {
        if model.input.enableCompare {
            Toggle(isOn: Binding(get: { model.compare }, set: { model.setCompare($0) })) {
                Text(verbatim: RangePickerStrings.compareLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .toggleStyle(.switch)
            .fixedSize()
        } else {
            Text(verbatim: model.stagedDays.map { RangePickerStrings.summaryDays($0) } ?? "")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Day cell (one calendar day)

/// One calendar day — a tappable cell highlighted by its staged-range role, or an empty padding cell. The
/// VoiceOver label is the full date plus its range role; out-of-bounds days are disabled (web `disabled`).
struct RangePickerDayCell: View {
    let day: RangePickerDay
    let selection: RangePickerDaySelection
    let calendar: Calendar
    let onPick: (String) -> Void

    var body: some View {
        if let iso = day.iso, let number = day.dayNumber {
            Button { onPick(iso) } label: {
                Text(verbatim: String(number))
                    .font(Font.TS.caption)
                    .fontWeight(selection == .none ? .regular : .semibold)
                    .foregroundStyle(foreground)
                    .frame(width: 32, height: 32)
                    .background(background, in: RoundedRectangle(cornerRadius: TSRadius.sm))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(day.isDisabled)
            .accessibilityLabel(Text(verbatim: accessibilityLabel(iso)))
        } else {
            Color.clear.frame(width: 32, height: 32).accessibilityHidden(true)
        }
    }

    private var background: Color {
        switch selection {
        case .start, .end, .single: Color.TS.accent
        case .inRange: Color.TS.accent.opacity(0.18)
        case .none: Color.clear
        }
    }

    private var foreground: Color {
        switch selection {
        case .start, .end, .single: Color.white
        case .inRange: Color.TS.textPrimary
        case .none: day.isDisabled ? Color.TS.textMuted.opacity(0.4) : Color.TS.textPrimary
        }
    }

    private func accessibilityLabel(_ iso: String) -> String {
        guard let date = RangePickerDates.date(from: iso, calendar: calendar) else { return iso }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        let base = formatter.string(from: date)
        switch selection {
        case .start: return "\(base). \(RangePickerStrings.dayStart)"
        case .end: return "\(base). \(RangePickerStrings.dayEnd)"
        case .inRange: return "\(base). \(RangePickerStrings.dayInRange)"
        case .single, .none: return base
        }
    }
}

// MARK: - Loading trigger (initial fetch — skeleton chrome)

/// The initial-fetch trigger — a skeleton pill shaped like the trigger so the surface keeps its shape while
/// the page's range resolves (never a blank box).
struct RangePickerLoadingTrigger: View {
    let size: RangePickerSize

    var body: some View {
        TSSkeleton(width: 200, height: size == .medium ? 40 : 32, cornerRadius: TSRadius.md)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: RangePickerStrings.loadingA11y))
    }
}

// MARK: - Error (web has no QueryError peer — added so the surface never blanks)

/// The fetch-failure state — a compact error tile with a retry affordance. The message is the runtime
/// failure reason, rendered verbatim.
struct RangePickerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: RangePickerStrings.errorTitle)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: RangePickerStrings.retry)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (presetsOnly with no resolvable presets)

/// The friendly empty content — a labelled placeholder shown in the popover when there is nothing to pick
/// (web renders an empty group; the native HIG calls for a labelled placeholder, never a bare box).
struct RangePickerEmptyContent: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(RangePickerStrings.empty),
            systemImage: "calendar.badge.exclamationmark"
        )
        .frame(minWidth: 220)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the trigger when the page's range is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the range.
struct RangePickerFreshnessChip: View {
    let connection: RangePickerConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: RangePickerStrings.live
        case .stale: RangePickerStrings.stale
        case .offline: RangePickerStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: RangePickerStrings.live
        case .stale: RangePickerStrings.staleA11y
        case .offline: RangePickerStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
