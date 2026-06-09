//
//  VehicleSpecsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  Domain value types ported from the web source + its API types
//  (features/dashboard/widgets/VehicleSpecsWidget.tsx, api/types.ts): the raw
//  specs / options / config-snapshot envelopes the backend returns
//  (/vehicles/{id}/specs, /vehicles/{id}/options, /vehicle-config/latest), the
//  localized label context, the normalized detail row, and the merged projection
//  the view renders. No SwiftUI / transport here.
//

import Foundation

// MARK: - Scalar coercion (the untyped values `asString` consumes)

/// One candidate field value inside a raw specs / options / config object. The
/// web `asString` helper accepts `unknown` and keeps a non-empty string,
/// stringifies a number, and otherwise yields `null`; this enum models exactly
/// those three inbound kinds so the Swift adapter reproduces that coercion
/// byte-for-byte.
public enum SpecScalar: Sendable, Equatable {
    case text(String)
    case number(Double)
    case absent

    /// Web `asString(val)` — a non-empty string stays, a number is stringified
    /// (JS `String(n)`), everything else (incl. the empty string) becomes `nil`.
    public var asString: String? {
        switch self {
        case let .text(value):
            value.isEmpty ? nil : value
        case let .number(value):
            SpecScalar.jsNumberString(value)
        case .absent:
            nil
        }
    }

    /// JS `String(Number)` semantics: integral values print without a fractional
    /// part, fractional values keep their shortest decimal form.
    static func jsNumberString(_ value: Double) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : (value > 0 ? "Infinity" : "-Infinity") }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - Raw envelopes (the untyped shapes the web body reads)

/// The fields the web body reads off the `useVehicleSpecs` envelope `.data`
/// (`Record<string, unknown>`). Each candidate is a `SpecScalar` so the adapter
/// can apply the web `??` fallback chains (`car_type ?? model`,
/// `trim_badging ?? trim`, `interior ?? interior_color`).
public struct RawVehicleSpecs: Sendable, Equatable {
    public var carType: SpecScalar
    public var model: SpecScalar
    public var trimBadging: SpecScalar
    public var trim: SpecScalar
    public var exteriorColor: SpecScalar
    public var wheelType: SpecScalar
    public var interior: SpecScalar
    public var interiorColor: SpecScalar
    public var auxBatteryType: SpecScalar
    public var carVersion: SpecScalar

    public init(
        carType: SpecScalar = .absent,
        model: SpecScalar = .absent,
        trimBadging: SpecScalar = .absent,
        trim: SpecScalar = .absent,
        exteriorColor: SpecScalar = .absent,
        wheelType: SpecScalar = .absent,
        interior: SpecScalar = .absent,
        interiorColor: SpecScalar = .absent,
        auxBatteryType: SpecScalar = .absent,
        carVersion: SpecScalar = .absent
    ) {
        self.carType = carType
        self.model = model
        self.trimBadging = trimBadging
        self.trim = trim
        self.exteriorColor = exteriorColor
        self.wheelType = wheelType
        self.interior = interior
        self.interiorColor = interiorColor
        self.auxBatteryType = auxBatteryType
        self.carVersion = carVersion
    }
}

/// The fields the web body reads off the `useVehicleConfigLatest`
/// `VehicleConfigSnapshot`. Only the keys the widget consults are modeled
/// (`car_type`, `trim`, `exterior_color`, `wheel_type`, `version`).
public struct RawVehicleConfig: Sendable, Equatable {
    public var carType: SpecScalar
    public var trim: SpecScalar
    public var exteriorColor: SpecScalar
    public var wheelType: SpecScalar
    public var version: SpecScalar

    public init(
        carType: SpecScalar = .absent,
        trim: SpecScalar = .absent,
        exteriorColor: SpecScalar = .absent,
        wheelType: SpecScalar = .absent,
        version: SpecScalar = .absent
    ) {
        self.carType = carType
        self.trim = trim
        self.exteriorColor = exteriorColor
        self.wheelType = wheelType
        self.version = version
    }
}

/// One decoded option-code entry from the `useVehicleOptions` envelope, keeping
/// the key so the adapter can fall back to it when the value does not coerce
/// (web `asString(options[key]) ?? key`). Insertion order is preserved so the
/// rendered list matches the web `Object.keys(options)` iteration order.
public struct SpecOption: Sendable, Equatable, Identifiable {
    public let key: String
    public var value: SpecScalar

    public var id: String {
        key
    }

    public init(key: String, value: SpecScalar = .absent) {
        self.key = key
        self.value = value
    }
}

// MARK: - Localized label context (web `t(key, default)` for the row labels)

/// The localized labels threaded into the projection so the builder stays a pure
/// data adapter while the view holds no English literal. The production model
/// fills this from `SpecsStrings`; previews / tests pass `.default`. Mirrors how
/// the sibling surfaces thread their display context into the builder.
public struct SpecsLabels: Sendable, Equatable {
    public var model: String
    public var trim: String
    public var paint: String
    public var wheels: String
    public var interior: String
    public var auxBattery: String
    public var carVersion: String
    /// Badge text rendered on every decoded option row (web `<Badge>Option</Badge>`).
    public var option: String

    public init(
        model: String,
        trim: String,
        paint: String,
        wheels: String,
        interior: String,
        auxBattery: String,
        carVersion: String,
        option: String
    ) {
        self.model = model
        self.trim = trim
        self.paint = paint
        self.wheels = wheels
        self.interior = interior
        self.auxBattery = auxBattery
        self.carVersion = carVersion
        self.option = option
    }

    /// English fallbacks (the web `t(key, default)` defaults) — used by previews,
    /// the empty projection, and the deterministic adapter tests.
    public static let `default` = SpecsLabels(
        model: "Model",
        trim: "Trim",
        paint: "Paint Color",
        wheels: "Wheels",
        interior: "Interior",
        auxBattery: "Aux Battery",
        carVersion: "Car Version",
        option: "Option"
    )
}

// MARK: - Projection (the merged view-model the view renders)

/// One normalized detail row (web `DetailEntry`): a resolved label, the resolved
/// value (already `'—'`-filled when missing), an optional badge text (the
/// `"Option"` chip on decoded option rows), and the mono flag (web `mono: true`
/// on the car-version row).
public struct SpecEntry: Sendable, Equatable, Identifiable {
    public var label: String
    public var value: String
    public var badge: String?
    public var mono: Bool

    /// Stable identity for `ForEach` — the web keys rows by `entry.label`.
    public var id: String {
        label
    }

    public init(label: String, value: String, badge: String? = nil, mono: Bool = false) {
        self.label = label
        self.value = value
        self.badge = badge
        self.mono = mono
    }
}

/// The headline pair the 1-column compact layout renders (web `CompactView`):
/// the resolved model name + trim, each already `'—'`-filled when missing.
public struct SpecsCompact: Sendable, Equatable {
    public var model: String
    public var trim: String

    public init(model: String, trim: String) {
        self.model = model
        self.trim = trim
    }
}

/// The fully-projected widget content — the single value the view switches over
/// (web `entries` + `CompactView` inputs + `hasAnyData`).
public struct SpecsProjection: Sendable, Equatable {
    /// The full detail-card rows (7 fixed + up to 8 decoded option rows).
    public var entries: [SpecEntry]
    /// The headline model + trim for the compact layout.
    public var compact: SpecsCompact
    /// Web `hasAnyData = specs !== null || options !== null || configData !== null`.
    public var hasData: Bool

    public init(entries: [SpecEntry], compact: SpecsCompact, hasData: Bool) {
        self.entries = entries
        self.compact = compact
        self.hasData = hasData
    }

    /// Whether any detail row resolved (the full view always has the 7 fixed rows
    /// once any envelope is present).
    public var hasEntries: Bool {
        !entries.isEmpty
    }

    /// The resolved-but-empty projection (web all-null → top-level empty state).
    public static let empty = SpecsProjection(
        entries: [],
        compact: SpecsCompact(model: SpecsProjectionConstants.dash, trim: SpecsProjectionConstants.dash),
        hasData: false
    )
}

/// Shared constants for the specs projection so the view, builder, and accessibility
/// summary agree on the missing-value glyph (web literal `'—'`).
public enum SpecsProjectionConstants {
    /// Web `?? '—'` — the em-dash shown for any unresolved field.
    public static let dash = "—"
    /// Web option slice limit (`optionKeys.slice(0, 8)` in the non-compact view).
    public static let optionLimit = 8
}
