//
//  AutopilotSection.Adapter.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The testable projection core for the "Autopilot & Cruise" section — the faithful port of
//  features/driving/components/driving-dynamics/AutopilotSection.tsx. `AutopilotUnitMath` mirrors the
//  web `lib/unitConversion.ts` `convertSpeedFromSI` + `lib/numberFormat.ts` `fmtNumber`;
//  `parseFollowDistance` mirrors the source's enum-suffix peeler; `AutopilotProjector` reproduces the
//  component's value pipeline VERBATIM (SI m/s → display speed at 0 dp, the `'—'` em-dash fallback, the
//  no-unit Follow Distance tile). Foundation-only so it is unit-tested without a bundle or a rendered
//  view.
//

import Foundation

// MARK: - SI conversion + number formatting (web parity)

/// Pure SI → display speed conversion + the `safe()` / `fmtNumber()` helpers, reproducing the web
/// `lib/unitConversion.ts` constants and `lib/numberFormat.ts` formatting so every platform shows
/// identical numbers. `VehicleSpeed` and `CruiseSetSpeed` are stored as SI m/s by the Tesla pipeline,
/// so the value goes DIRECTLY through the SI → display converter — there is no km/h intermediate (see
/// the web source's unit-policy note).
public enum AutopilotUnitMath {
    /// 1 mile = 1609.344 m exactly (international yard, NIST) — web `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — web `METERS_PER_KM`.
    public static let metersPerKm = 1000.0
    /// Seconds in an hour — web `SECONDS_PER_HOUR`.
    public static let secondsPerHour = 3600.0

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertSpeedFromSI(mps, to)`: m/s → the display speed unit. `"mph"` divides the per-hour
    /// metres by the metres-per-mile; any other label (the canonical `"km/h"`) divides by the
    /// metres-per-kilometre.
    public static func speedFromSI(_ mps: Double, _ unit: String) -> Double {
        switch unit {
        case "mph": (mps * secondsPerHour) / metersPerMile
        default: (mps * secondsPerHour) / metersPerKm
        }
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of fraction
    /// digits, with the JS `toLocaleString` half-away-from-zero rounding and the `safeNumber`
    /// non-finite → 0 guard. `locale` defaults to en-US (the web default).
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(max(0, decimals))f", safe(value))
    }
}

// MARK: - Follow-distance enum peeler (web `parseFollowDistance`)

/// Mirrors the web `parseFollowDistance`: Tesla emits `CruiseFollowDistance` as a proto enum string
/// such as `"FollowDistance7"` (a 7-bar follow gap). The only useful bit for display is the trailing
/// number, so peel it off rather than rendering the enum raw — falling back to the original string when
/// the schema has no trailing digits. Returns `nil` only when the input is `nil`.
public enum AutopilotFollowDistance {
    /// Web `const m = /(\d+)\s*$/.exec(raw); return m ? m[1] : raw` (with the leading `nil` guard).
    public static func parse(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = String(raw.reversed().drop { $0 == " " || $0 == "\t" }.reversed())
        let digits = trimmed.reversed().prefix { $0.isASCII && $0.isNumber }
        guard !digits.isEmpty else { return raw }
        return String(digits.reversed())
    }
}

// MARK: - Projector (pure)

/// The dependency-free projection from a cached `AutopilotInput` + the user's speed-unit preference to
/// the three view-ready stat tiles. Every value uses the same conversion + formatting as the web
/// component so the web and native sections render identical strings for identical input.
public enum AutopilotProjector {
    /// Builds the projection. Each value is independently optional: a present value renders its
    /// localized number (speeds) or peeled enum suffix (follow distance); an absent value renders the
    /// em-dash sentinel — exactly the web `value != null ? fmtNumber(...) : '—'` / `followDistance ?? '—'`
    /// guards. `hasAny` reproduces the web content-vs-empty switch.
    public static func project(
        input: AutopilotInput?,
        prefs: AutopilotUnitPrefs,
        copy: AutopilotCopy = .fallback
    ) -> AutopilotProjection {
        guard let input else { return .empty }
        let locale = prefs.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
        let speedUnit = prefs.speed
        let parsedFollow = AutopilotFollowDistance.parse(input.followDistanceRaw)

        let currentSpeed = stat(
            kind: .currentSpeed,
            label: copy.currentSpeedLabel,
            value: speedValue(input.speedMetersPerSecond, speedUnit, locale, copy.emDash),
            unit: speedUnit
        )
        let cruiseSetSpeed = stat(
            kind: .cruiseSetSpeed,
            label: copy.cruiseSetSpeedLabel,
            value: speedValue(input.cruiseSetMetersPerSecond, speedUnit, locale, copy.emDash),
            unit: speedUnit
        )
        let followDistance = stat(
            kind: .followDistance,
            label: copy.followDistanceLabel,
            value: parsedFollow ?? copy.emDash,
            unit: nil
        )

        let hasAny = input.speedMetersPerSecond != nil
            || input.cruiseSetMetersPerSecond != nil
            || input.followDistanceRaw != nil
        return AutopilotProjection(stats: [currentSpeed, cruiseSetSpeed, followDistance], hasAny: hasAny)
    }

    /// Resolves the surface phase, mirroring the web parent precedence (loading → error → body): a
    /// resolved payload with at least one value is content; a resolved payload with none is the empty
    /// state (web `EmptyState`); a `nil` payload before the first resolve is also empty.
    public static func resolvePhase(_ status: AutopilotLoadStatus, hasAny: Bool) -> AutopilotPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasAny ? .content : .empty
        }
    }

    // MARK: Tile builders

    /// Web `value != null ? fmtNumber(convertSpeedFromSI(value, unit), 0) : '—'` — the two speed tiles
    /// (0 dp). A `nil` SI value renders the em-dash sentinel.
    private static func speedValue(_ mps: Double?, _ unit: String, _ locale: Locale, _ emDash: String) -> String {
        guard let mps else { return emDash }
        let display = AutopilotUnitMath.speedFromSI(AutopilotUnitMath.safe(mps), unit)
        return AutopilotUnitMath.fmtNumber(display, decimals: 0, locale: locale)
    }

    private static func stat(kind: AutopilotStatKind, label: String, value: String, unit: String?) -> AutopilotStat {
        let spoken = unit.map { "\(label), \(value) \($0)" } ?? "\(label), \(value)"
        return AutopilotStat(kind: kind, label: label, value: value, unit: unit, accessibilityLabel: spoken)
    }
}
