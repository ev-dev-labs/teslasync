//
//  RangePicker.Projector.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The props value type (``RangePickerInput``, the native peer of `RangePickerProps`), the view-ready
//  ``RangePickerProjection``, and the pure ``RangePickerProjector`` that maps one into the other — the
//  surface's "cached → projection" data adapter. The projector reproduces the web render decisions: the
//  active-preset match (web `matchPresetId` → `activePresetId`), the trigger's active label (web
//  `activeLabel`, falling back to "Custom range"), the formatted sub-label (web `triggerSubLabel`), the
//  inclusive day count (web `totalDays`), the resolved preset rows (web `presets.map`), and the staged
//  dirty/day-count helpers (web `stagedDirty` / `stagedDays`). No SwiftUI, fully unit-tested.
//

import Foundation

// MARK: - Trigger size / popover alignment (web `size` / `align`)

/// Trigger control size (web `size: 'sm' | 'md'`).
public enum RangePickerSize: String, Sendable, Equatable {
    case small
    case medium
}

/// Popover alignment relative to the trigger (web `align: 'start' | 'end'`).
public enum RangePickerAlign: String, Sendable, Equatable {
    case start
    case end
}

// MARK: - RangePickerInput (web props, closure-free)

/// The component's props — the native peer of `RangePickerProps`, minus the `onChange` / `onCompareChange`
/// closures (held by the state-holder). A value type so the view, the holder, the source seam, and the pure
/// projection agree on one shape and a `.onChange` can detect a prop change cheaply.
public struct RangePickerInput: Sendable, Equatable {
    /// The current committed range (web `value`).
    public let value: RangePickerValue
    /// The subset of preset ids to render (web `presetIds`, default ``RangePickerPresets/defaultIDs``).
    public let presetIDs: [String]
    /// Floor for "All time" + selectable dates (web `minDate`).
    public let minDate: String?
    /// Inclusive upper bound for selectable dates (web `maxDate`, default today).
    public let maxDate: String?
    /// Show the "Compare to previous period" toggle (web `enableCompare`).
    public let enableCompare: Bool
    /// Current compare flag (web `compare`).
    public let compare: Bool
    /// Hide the calendar grid + Apply/Cancel footer (web `presetsOnly`).
    public let presetsOnly: Bool
    /// Trigger size (web `size`).
    public let size: RangePickerSize
    /// Popover alignment (web `align`).
    public let align: RangePickerAlign

    public init(
        value: RangePickerValue,
        presetIDs: [String] = RangePickerPresets.defaultIDs,
        minDate: String? = nil,
        maxDate: String? = nil,
        enableCompare: Bool = false,
        compare: Bool = false,
        presetsOnly: Bool = false,
        size: RangePickerSize = .small,
        align: RangePickerAlign = .start
    ) {
        self.value = value
        self.presetIDs = presetIDs
        self.minDate = minDate
        self.maxDate = maxDate
        self.enableCompare = enableCompare
        self.compare = compare
        self.presetsOnly = presetsOnly
        self.size = size
        self.align = align
    }
}

// MARK: - RangePickerPresetRow (web one `<button role="option">`)

/// One resolved, view-ready preset row — the native peer of the web preset `<button role="option">`: its id,
/// its i18n'd label, and whether it is the active match (web `aria-selected`).
public struct RangePickerPresetRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let isActive: Bool

    public init(id: String, label: String, isActive: Bool) {
        self.id = id
        self.label = label
        self.isActive = isActive
    }
}

// MARK: - RangePickerProjection (view-ready)

/// The resolved, view-ready picker — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view): the active preset id, the trigger's label + sub-label + day count, the resolved
/// preset rows, and the calendar/compare/empty flags.
public struct RangePickerProjection: Sendable, Equatable {
    /// The active preset id, or `nil` for a custom range (web `activePresetId`).
    public let activePresetID: String?
    /// The trigger's primary label — the active preset, else "Custom range" (web `triggerLabel`).
    public let triggerLabel: String
    /// The trigger's formatted range sub-label (web `triggerSubLabel`).
    public let triggerSubLabel: String
    /// The committed range's inclusive day count (web `totalDays`).
    public let dayCount: Int
    /// The resolved preset rows (web `presets.map`).
    public let presets: [RangePickerPresetRow]
    /// Whether the calendar grid + footer render (web `!presetsOnly`).
    public let showsCalendar: Bool
    /// Whether the compare toggle renders (web `enableCompare`).
    public let enableCompare: Bool
    /// Whether the popover has nothing to offer — `presetsOnly` with no resolvable presets (native empty).
    public let isEmpty: Bool

    public init(
        activePresetID: String?,
        triggerLabel: String,
        triggerSubLabel: String,
        dayCount: Int,
        presets: [RangePickerPresetRow],
        showsCalendar: Bool,
        enableCompare: Bool,
        isEmpty: Bool
    ) {
        self.activePresetID = activePresetID
        self.triggerLabel = triggerLabel
        self.triggerSubLabel = triggerSubLabel
        self.dayCount = dayCount
        self.presets = presets
        self.showsCalendar = showsCalendar
        self.enableCompare = enableCompare
        self.isEmpty = isEmpty
    }
}

// MARK: - RangePickerProjector (web render body)

/// The pure projection from props to the view-ready model — the surface's data adapter. Takes the props a
/// page already holds (no fetch) plus the clock + locale + i18n resolver and derives the rendered picker.
public enum RangePickerProjector {
    /// Resolve the whole picker from the props (web component's render decision).
    public static func resolve(
        _ input: RangePickerInput,
        now: Date,
        calendar: Calendar,
        locale: Locale,
        strings: RangePickerResolve
    ) -> RangePickerProjection {
        let value = input.value
        let activeID = RangePickerPresets.matchPresetID(
            start: value.start, end: value.end, now: now, calendar: calendar
        )
        let rows = presetRows(input.presetIDs, activeID: activeID, strings: strings)
        let triggerLabel = activeID
            .flatMap { RangePickerPresets.preset(for: $0) }
            .map { strings($0.i18nKey, $0.fallback) }
            ?? strings("date.range.pickRange", "Custom range")
        return RangePickerProjection(
            activePresetID: activeID,
            triggerLabel: triggerLabel,
            triggerSubLabel: RangePickerDates.formatRange(
                start: value.start, end: value.end, locale: locale, calendar: calendar
            ),
            dayCount: RangePickerDates.diffDaysInclusive(start: value.start, end: value.end, calendar: calendar),
            presets: rows,
            showsCalendar: !input.presetsOnly,
            enableCompare: input.enableCompare,
            isEmpty: input.presetsOnly && rows.isEmpty
        )
    }

    /// The resolved preset rows — the web `presets.filter(...).map(...)` (unknown ids are dropped).
    public static func presetRows(
        _ presetIDs: [String],
        activeID: String?,
        strings: RangePickerResolve
    ) -> [RangePickerPresetRow] {
        presetIDs.compactMap { id in
            guard let preset = RangePickerPresets.preset(for: id) else { return nil }
            return RangePickerPresetRow(
                id: preset.id,
                label: strings(preset.i18nKey, preset.fallback),
                isActive: preset.id == activeID
            )
        }
    }

    // MARK: Staged-range helpers (web `stagedDirty` / `stagedDays`)

    /// Whether the staged calendar range differs from the committed value (web `stagedDirty`) — gates Apply.
    /// A staged range must be complete (both ends) and not already equal to the committed range.
    public static func isStagedDirty(stagedStart: String?, stagedEnd: String?, value: RangePickerValue) -> Bool {
        guard let stagedStart, let stagedEnd else { return false }
        return stagedStart != value.start || stagedEnd != value.end
    }

    /// The staged range's inclusive day count, or `nil` when incomplete (web `stagedDays`).
    public static func stagedDays(stagedStart: String?, stagedEnd: String?, calendar: Calendar) -> Int? {
        guard let stagedStart, let stagedEnd else { return nil }
        return RangePickerDates.diffDaysInclusive(start: stagedStart, end: stagedEnd, calendar: calendar)
    }
}
