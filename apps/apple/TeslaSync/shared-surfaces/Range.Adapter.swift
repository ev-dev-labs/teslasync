//
//  Range.Adapter.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  The testable, dependency-light core for the "preferred range" renderer — the SwiftUI parity of
//  `components/data-display/format/Range.tsx`. Everything here is pure (Foundation + the in-module
//  `UnitPreferences` value type): the two preferences the web reads (the distance unit via `useUnits()`
//  and the rated-vs-ideal `rangeType` via `useSettings()`), the preferred-range selection (the port of
//  `lib/preferredRange.ts` `selectPreferredRange`), the SI distance formatter (the port of
//  `lib/unitConversion.ts` `formatDistance`, the exact function the web `Range` calls — NOT the manual
//  `convertDistanceFromSI` + `fmtNumber` path the sibling `Distance` surface uses), and the
//  VoiceOver builders. No store, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is a synchronous formatter: it reads its `state` prop plus the
//  synchronous `useUnits()` + `useSettings().rangeType` preference bags (settings reads, not a fetch)
//  and returns a `<span>`. It has no loading / error / stale / offline axis, so synthesising network
//  chrome here would invent state the web source does not have (the same disposition as the 0085
//  Distance and 0075 AnimatedNumber surfaces). The genuine render branches this core models are
//  exactly the ones the web has: the formatted value (`{formatDistance(meters, {precision})}`) and the
//  em-dash sentinel (`—`) when the selected range is missing / non-finite. The rated-vs-ideal LABEL is
//  always resolvable (the parity of `useRangeLabel` returning a stable label even while `state` is
//  null), so it is carried alongside both branches.
//
//  Parity note — i18n. The web `Range` value renders no translatable copy (a locale-formatted number
//  plus the user's distance-unit symbol). The companion `useRangeLabel` resolves
//  `t('common.ratedRange'|'common.idealRange', …)`; those two keys are reproduced verbatim here
//  through the injected resolver, plus a native empty-state VoiceOver label (web reads a bare "—").
//  See Range.strings.
//

import Foundation

// MARK: - Range type preference (web `useSettings().rangeType`)

/// Which of the two Tesla range estimates the user treats as "the" range — the parity of the
/// `preferred_range` General-Settings preference (`lib/preferredRange.ts` `RangeType`). The raw value
/// round-trips with the settings string so it can be seeded directly from a stored preference.
public enum RangeType: String, Sendable, Equatable, CaseIterable {
    case rated
    case ideal

    /// The web `rangeType === 'ideal' ? 'ideal' : 'rated'` coercion: anything that is not exactly
    /// "ideal" (including `nil` and a mistyped value) falls back to `rated`, matching the backend
    /// default in `useSettings`.
    public static func from(_ raw: String?) -> RangeType {
        raw == RangeType.ideal.rawValue ? .ideal : .rated
    }
}

// MARK: - Range state snapshot (web `PreferredRangeFields`)

/// The vehicle/charge state fields the selection reasons over — the parity of the web
/// `PreferredRangeFields` (`rated_range` + `ideal_range`, both in SI metres). Both are optional to
/// mirror `rated_range?: number | null`; a `nil` snapshot (the surface's `state == null`) is the
/// loading case where no figure is available but the label is still resolvable.
public struct RangeState: Sendable, Equatable {
    /// EPA/rated range estimate in SI metres (web `rated_range`).
    public var ratedRangeMeters: Double?
    /// Ideal/typical range estimate in SI metres (web `ideal_range`).
    public var idealRangeMeters: Double?

    public init(ratedRangeMeters: Double? = nil, idealRangeMeters: Double? = nil) {
        self.ratedRangeMeters = ratedRangeMeters
        self.idealRangeMeters = idealRangeMeters
    }
}

// MARK: - Input (web `RangeProps` + the `useUnits` + `useSettings().rangeType` reads)

/// One coalesced snapshot of the surface's inputs. `state` is the optional range snapshot (web `state`
/// prop); `precision` is the optional fraction-digit override (web `precision` prop, default 0);
/// `rangeType` is the resolved rated/ideal preference (web `useSettings().rangeType`); `units` is the
/// resolved `useUnits().unitPrefs` bag that drives the target distance unit, the precision fallback,
/// the empty sentinel, and the formatting locale. Equatable + Sendable so the view can re-sync the
/// model when the props or either active preference changes.
public struct RangeInput: Sendable, Equatable {
    public var state: RangeState?
    public var precision: Int?
    public var rangeType: RangeType
    public var units: UnitPreferences

    public init(
        state: RangeState?,
        precision: Int? = nil,
        rangeType: RangeType = .rated,
        units: UnitPreferences
    ) {
        self.state = state
        self.precision = precision
        self.rangeType = rangeType
        self.units = units
    }
}

// MARK: - Surface metadata (diagnostics slug + canonical SI factors + lib defaults)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`, the
/// canonical SI conversion factors (mirroring `unitConversion.ts`), the lib `formatDistance` default
/// fraction digits for distance, and the em-dash sentinel the web renders for a nullish selection.
public enum RangeMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Range"

    /// Canonical SI factors (web `METERS_PER_MILE` / `METERS_PER_KM` / `METERS_PER_FOOT`).
    public static let metersPerMile = 1609.344
    public static let metersPerKm = 1000.0
    public static let metersPerFoot = 0.3048

    /// Web `unitConversion.ts` `DEFAULT_PRECISION.distance` — the `formatDistance` fallback fraction
    /// digits when neither a per-call override nor a user precision preference is supplied.
    public static let defaultDistancePrecision = 1

    /// The em-dash sentinel the web renders for a `null` selection (`<span>—</span>`) and the
    /// `unitConversion.ts` `DEFAULT_EMPTY_DISPLAY` fallback.
    public static let emptyDisplay = "—"

    /// The deterministic locale tag the web number formatting falls back to for a blank/invalid
    /// locale preference (`setGlobalLocale` → "en-US").
    public static let fallbackLocaleIdentifier = "en-US"
}

// MARK: - Preferred-range selection (web `selectPreferredRange`)

/// The selected range value + its label metadata — the parity of the web `PreferredRangeResult`. The
/// `meters` is the SI value of the chosen field (`nil` when missing); `source` is which field won;
/// `labelKey` / `defaultLabel` drive the localized rated/ideal label.
public struct PreferredRange: Sendable, Equatable {
    /// The selected range in SI metres, or `nil` when the chosen field is missing.
    public let meters: Double?
    /// Which field was selected.
    public let source: RangeType
    /// The i18n key suffix used as `common.<labelKey>` (`ratedRange` / `idealRange`).
    public let labelKey: String
    /// The English fallback label, suitable as a resolver default.
    public let defaultLabel: String

    public init(meters: Double?, source: RangeType, labelKey: String, defaultLabel: String) {
        self.meters = meters
        self.source = source
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
    }
}

/// Pure preferred-range selection — the verbatim port of `lib/preferredRange.ts` `selectPreferredRange`.
/// Picks `ideal_range` / `rated_range` per the resolved `rangeType` (defaulting to rated), preserving
/// the field's own nullability, and returns the matching label key + English fallback regardless of
/// whether the value is present (so a loading `state == nil` still yields a stable label).
public enum RangeSelection {
    public static func selectPreferredRange(state: RangeState?, rangeType: RangeType) -> PreferredRange {
        switch rangeType {
        case .ideal:
            PreferredRange(
                meters: state?.idealRangeMeters,
                source: .ideal,
                labelKey: "idealRange",
                defaultLabel: "Ideal Range"
            )
        case .rated:
            PreferredRange(
                meters: state?.ratedRangeMeters,
                source: .rated,
                labelKey: "ratedRange",
                defaultLabel: "Rated Range"
            )
        }
    }
}

// MARK: - Conversion + formatting (web `lib/unitConversion.ts` `formatDistance`)

/// The pure SI conversion + locale number formatting ported from the web `formatDistance` (the exact
/// function the web `Range` calls) so the rounding, grouping separators, unit label, precision
/// precedence, and empty fallback match the source. Value-type and deterministic — unit tested without
/// the Kotlin runtime or a view.
public enum RangeFormatting {
    /// Web `Number.isFinite(value)` — the guard `formatDistance` applies before formatting.
    public static func isFiniteValue(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }

    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi / ft, defaulting an unknown label to
    /// km (the SI-adjacent metric base) so a stray preference never crashes the renderer.
    public static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / RangeMeta.metersPerMile
        case "ft": meters / RangeMeta.metersPerFoot
        default: meters / RangeMeta.metersPerKm
        }
    }

    /// Web `resolvePrecision(pref, override, fallback)`: the per-call override wins when it is a finite
    /// non-negative number (floored), then the user's precision preference under the same guard, then
    /// the supplied fallback (`DEFAULT_PRECISION.distance` = 1 for distance). No upper clamp — the web
    /// lib formatter applies none.
    public static func resolvePrecision(
        override: Int?,
        units: UnitPreferences,
        fallback: Int = RangeMeta.defaultDistancePrecision
    ) -> Int {
        if let override, override >= 0 {
            return override
        }
        if let preference = units.precision, preference >= 0 {
            return preference
        }
        return fallback
    }

    /// The formatting locale — web `Intl.NumberFormat` locale read with the "en-US" fallback for a
    /// nil / blank preference (`setGlobalLocale`).
    public static func locale(for units: UnitPreferences) -> Locale {
        guard
            let tag = units.locale,
            !tag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return Locale(identifier: RangeMeta.fallbackLocaleIdentifier)
        }
        return Locale(identifier: tag)
    }

    /// Web `Intl.NumberFormat(locale, { min == max fraction digits })`: locale grouping, fixed
    /// fraction digits, half-away-from-zero rounding (the `Intl.NumberFormat` default, matched by
    /// `NumberFormatter.RoundingMode.halfUp`). The formatter is created locally so the surface holds
    /// no shared mutable formatter state.
    public static func formatNumber(_ value: Double, digits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Web `resolveEmpty(pref)` — the display fallback for a nullish / non-finite value
    /// (`pref.emptyDisplay ?? '—'`).
    public static func resolveEmpty(_ units: UnitPreferences) -> String {
        units.emptyDisplay ?? RangeMeta.emptyDisplay
    }

    /// Web `formatDistance(meters, pref, { precision })`: a non-finite / nil input returns the empty
    /// fallback; otherwise convert SI metres to the user's unit, format at the resolved precision /
    /// locale, and append the unit label (`{num} {unit}`).
    public static func formatDistance(meters: Double?, units: UnitPreferences, precision: Int?) -> String {
        guard isFiniteValue(meters), let meters else {
            return resolveEmpty(units)
        }
        let digits = resolvePrecision(override: precision, units: units)
        let value = convertDistanceFromSI(meters, to: units.distance)
        return "\(formatNumber(value, digits: digits, locale: locale(for: units))) \(units.distance)"
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings without rendering the view. The value branch voices the
/// formatted figure (self-describing, e.g. "320 km"); the empty branch voices a localized label
/// ("No range data") so VoiceOver never announces a bare "—" (a native refinement over the web, which
/// exposes no `aria-label`). The label element voices its own localized rated/ideal text.
public enum RangeAccessibility {
    /// The spoken label for the value branch — the displayed figure verbatim.
    public static func valueLabel(_ displayText: String) -> String {
        displayText
    }

    /// The spoken label for the empty branch — the localized "no data" copy.
    public static func emptyLabel(strings: RangeResolve = RangeStrings.string) -> String {
        strings("range.empty.accessibilityLabel", "No range data")
    }
}
