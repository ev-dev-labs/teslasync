//
//  DateRangeFilter.Adapter.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The Foundation-only core for the inline date-range filter — the SwiftUI parity of
//  `components/forms/DateRangeFilter.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam (the native shape of the web `t(key, default)`), the resolved-range value type (the web
//  `{ start, end }` handed to `onRangeChange`), the props value type (``DateRangeFilterInput``), the
//  view-ready ``DateRangeFilterProjection``, the local-day ISO date helpers (``DateRangeFilterDates`` — the
//  parity of the web `<input type="date">` `YYYY-MM-DD` value), the active-preset matcher (the port of
//  `matchPresetId` the web component calls through `useMemo`), and the pure ``DateRangeFilterProjector`` that
//  derives the rendered output from the props. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<DateRangeFilter>` is a PURE presentational component. Its only hook is
//  `useTranslation`; it takes `startDate` / `endDate` / the change callbacks / `onApply` / `presets` /
//  `presetIds` as plain props and renders two `<input type="date">` fields, an optional Apply `<Button>`, and
//  the composed `<DatePresetChips>` row — there is no fetch, no React-Query cache, and no Promise. It
//  therefore has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — exactly as the in-tree siblings DatePresetChips (0151) and
//  ActiveFilterChips (0147) do. The real branches are: the always-present date-range field, the optional
//  Apply action (web `onApply &&`), and the optional preset row (web `presets &&`) — itself populated or a
//  friendly empty state, delegated to the composed ``DatePresetChips``.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DateRangeFilterSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DateRangeFilter"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias DateRangeFilterResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - DateRangeFilterRange (web `{ start, end }` handed to `onRangeChange`)

/// A resolved, inclusive ISO date range (`YYYY-MM-DD` strings) — the native peer of the web `{ start, end }`
/// object the component passes to `onRangeChange`. A value type so the surface, the state-holder, and the
/// tests all agree on one shape.
public struct DateRangeFilterRange: Sendable, Equatable {
    /// Inclusive start day (`YYYY-MM-DD`, web `start`).
    public let start: String
    /// Inclusive end day (`YYYY-MM-DD`, web `end`).
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

// MARK: - DateRangeFilterInput (web props, closure-free)

/// The component's props — the native peer of `DateRangeFilterProps`, minus the change/apply closures (held
/// by the state-holder so this value stays `Equatable`/`Sendable`). A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when a page rebinds a new range.
public struct DateRangeFilterInput: Sendable, Equatable {
    /// The selected inclusive start day (`YYYY-MM-DD`, web `startDate`); empty until the page binds one.
    public let startDate: String
    /// The selected inclusive end day (`YYYY-MM-DD`, web `endDate`); empty until the page binds one.
    public let endDate: String
    /// Whether the quick-select preset row is shown (web `presets`, default `true`).
    public let showPresets: Bool
    /// The subset of preset ids the row renders (web `presetIds`, default ``DatePresetChipsCatalog/defaultIDs``).
    public let presetIDs: [String]
    /// Whether the Apply action is shown — the native peer of the web `onApply &&` guard (the button renders
    /// only when the page supplies an `onApply`).
    public let showApply: Bool

    public init(
        startDate: String,
        endDate: String,
        showPresets: Bool = true,
        presetIDs: [String] = DatePresetChipsCatalog.defaultIDs,
        showApply: Bool = false
    ) {
        self.startDate = startDate
        self.endDate = endDate
        self.showPresets = showPresets
        self.presetIDs = presetIDs
        self.showApply = showApply
    }
}

// MARK: - DateRangeFilterProjection (view-ready)

/// The resolved, view-ready output — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view). `activePresetID` is the web `useMemo(() => matchPresetId(startDate, endDate))`
/// highlight; `showPresets` / `showApply` mirror the web conditional renders; `presetIDs` is forwarded to the
/// composed ``DatePresetChips``.
public struct DateRangeFilterProjection: Sendable, Equatable {
    /// The id of the preset whose resolved range equals `(startDate, endDate)` at "now", else `nil` (web
    /// `activeId`) — forwarded to the chip row to highlight the active chip.
    public let activePresetID: String?
    /// The ids forwarded to the composed preset row (web `presetIds`).
    public let presetIDs: [String]
    /// Whether to render the preset row (web `presets`).
    public let showPresets: Bool
    /// Whether to render the Apply action (web `onApply &&`).
    public let showApply: Bool

    public init(activePresetID: String?, presetIDs: [String], showPresets: Bool, showApply: Bool) {
        self.activePresetID = activePresetID
        self.presetIDs = presetIDs
        self.showPresets = showPresets
        self.showApply = showApply
    }
}

// MARK: - DateRangeFilterProjector (web render decision)

/// The pure projection from the props to the view-ready output — the surface's adapter in the "props →
/// projection" sense. It resolves the active preset against "now" (web `matchPresetId`) and forwards the
/// conditional-render flags, so the SwiftUI body holds no logic. No clock and no fetch live in the view.
public enum DateRangeFilterProjector {
    /// Resolves the whole surface from the props — the native peer of the web component's render decision.
    public static func resolve(
        _ input: DateRangeFilterInput,
        now: Date,
        calendar: Calendar
    ) -> DateRangeFilterProjection {
        DateRangeFilterProjection(
            activePresetID: DateRangeFilterMatcher.matchPresetID(
                start: input.startDate,
                end: input.endDate,
                now: now,
                calendar: calendar
            ),
            presetIDs: input.presetIDs,
            showPresets: input.showPresets,
            showApply: input.showApply
        )
    }
}

// MARK: - DateRangeFilterMatcher (web `matchPresetId`)

/// The active-preset resolver — the port of `matchPresetId` from `web/src/lib/datePresets.ts` that the web
/// component computes inside `useMemo(() => matchPresetId(startDate, endDate), [startDate, endDate])`. It
/// reuses the shared ``DatePresetChipsCatalog`` (the same catalog the composed chip row renders) so the two
/// surfaces resolve identical ranges; returning the first preset whose inclusive range equals `(start, end)`
/// at `now`, else `nil`.
public enum DateRangeFilterMatcher {
    /// The id of the preset whose resolved range equals `(start, end)` at `now`, else `nil` (web
    /// `matchPresetId`). Empty `(start, end)` never matches a resolved preset, so the active chip clears.
    public static func matchPresetID(start: String, end: String, now: Date, calendar: Calendar) -> String? {
        for preset in DatePresetChipsCatalog.all {
            guard let range = DatePresetChipsCatalog.resolve(preset.id, now: now, calendar: calendar) else {
                continue
            }
            if range.start == start, range.end == end {
                return preset.id
            }
        }
        return nil
    }
}

// MARK: - DateRangeFilterDates (web `<input type="date">` `YYYY-MM-DD` value)

/// The pure ISO date helpers bridging the web `<input type="date">` `YYYY-MM-DD` string value and the native
/// `DatePicker`'s `Date`. Local-calendar construction (a fixed noon anchor) keeps `YYYY-MM-DD` from shifting
/// across timezones or DST, matching the web `iso()` reading local calendar fields.
public enum DateRangeFilterDates {
    /// A Gregorian calendar in the supplied zone (default the user's) — the single source of calendar truth so
    /// the field bindings and the preset matcher agree; tests inject a fixed zone for determinism.
    public static func gregorian(timeZone: TimeZone = .current) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// `YYYY-MM-DD` from a date's local calendar fields (web `e.target.value` after a pick).
    public static func iso(from date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 1, parts.day ?? 1)
    }

    /// A local-noon `Date` for a `YYYY-MM-DD` string (web `value={startDate}`); `nil` when the string is empty
    /// or malformed. Noon anchoring means a day never rolls into its neighbour under a DST transition.
    public static func date(from iso: String, calendar: Calendar) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        return calendar.date(from: components)
    }
}
