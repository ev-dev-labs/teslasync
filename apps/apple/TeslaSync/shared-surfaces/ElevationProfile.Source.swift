//
//  ElevationProfile.Source.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The pure, Foundation-only data types + chart logic for the elevation profile — the native parity of
//  the web `ElevationDataPoint`, the `elevGain` reducer, the `cursorDistance` resolution, the click →
//  index mapping, and the `fmt` number formatter. View-free and fully value-typed (Sendable +
//  Equatable) so the projection and every helper are unit tested without rendering a view.
//
//  Web source: `components/charts/ElevationProfile.tsx`. The component is presentational — the caller
//  passes samples that are already in display units (the web `distance` / `elevation` numbers and the
//  `distanceUnit` label), so this surface performs NO unit conversion (that happens at the caller's
//  display boundary). Elevation is always metres (the web `m` axis), matching the SI-on-disk contract.
//

import Foundation

// MARK: - Sample (web `ElevationDataPoint`)

/// One projected sample along the route — the native port of the web `ElevationDataPoint`
/// (`{ index, distance, elevation, speed? }`). `index` is the sample's stable identity emitted back to
/// the host on selection (web `onClickIndex(data[idx].index)`); `distance` is the X value in the
/// caller's `distanceUnit`; `elevation` is the Y value in metres. `speed` is carried for data fidelity
/// but, like the web source, is not plotted by this surface.
public struct ElevationProfileSample: Sendable, Equatable, Identifiable {
    public let index: Int
    public let distance: Double
    public let elevation: Double
    public let speed: Double?

    public var id: Int {
        index
    }

    public init(index: Int, distance: Double, elevation: Double, speed: Double? = nil) {
        self.index = index
        self.distance = distance
        self.elevation = elevation
        self.speed = speed
    }
}

// MARK: - Gain / loss (web `elevGain`)

/// The total ascent + descent across the route, in metres — the native parity of the web `elevGain`
/// reducer (`{ gain, loss }`, each `Math.round`-ed). Drives the panel subtitle (`↑ …m  ↓ …m`).
public struct ElevationProfileGainLoss: Sendable, Equatable {
    public let gain: Int
    public let loss: Int

    public init(gain: Int, loss: Int) {
        self.gain = gain
        self.loss = loss
    }

    public static let zero = ElevationProfileGainLoss(gain: 0, loss: 0)
}

// MARK: - Connection axis (P4 freshness: live / stale / offline)

/// The freshness of the displayed snapshot — projected from the `LoadableState`'s `stale` flag and the
/// failure shape, driving the stale / offline chip (P4 leaf contract).
public enum ElevationProfileConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Plotted profile (web Recharts `AreaChart` payload)

/// The view-ready elevation series ready to plot — the sanitised samples, the gain/loss totals, the
/// controlled cursor X, the thinned axis ticks, the padded Y-domain, the caller's distance unit, and
/// the localised metre / series labels + VoiceOver summary. The chart canvas is a pure function of this,
/// so the projection is fully unit tested without rendering Swift Charts. Tick / value formatting is
/// applied at the call site with the view's `locale` (the web `fmt` is locale-aware).
public struct ElevationProfilePlotted: Sendable, Equatable {
    public let samples: [ElevationProfileSample]
    public let gainLoss: ElevationProfileGainLoss
    public let cursorDistance: Double?
    public let axisDistanceValues: [Double]
    public let elevationDomain: ClosedRange<Double>
    public let distanceUnit: String
    public let metresUnit: String
    public let seriesLabel: String
    public let accessibilitySummary: String

    public init(
        samples: [ElevationProfileSample],
        gainLoss: ElevationProfileGainLoss,
        cursorDistance: Double?,
        axisDistanceValues: [Double],
        elevationDomain: ClosedRange<Double>,
        distanceUnit: String,
        metresUnit: String,
        seriesLabel: String,
        accessibilitySummary: String
    ) {
        self.samples = samples
        self.gainLoss = gainLoss
        self.cursorDistance = cursorDistance
        self.axisDistanceValues = axisDistanceValues
        self.elevationDomain = elevationDomain
        self.distanceUnit = distanceUnit
        self.metresUnit = metresUnit
        self.seriesLabel = seriesLabel
        self.accessibilitySummary = accessibilitySummary
    }

    /// The X-axis distance tick label — the web `XAxis tickFormatter={(v) => fmt(v, 1)}`.
    public func distanceTickLabel(_ value: Double, locale: Locale = .current) -> String {
        ElevationProfileFormat.number(value, places: 1, locale: locale)
    }

    /// The Y-axis elevation tick label — the web `YAxis tickFormatter={(v) => fmt(v, 0)}`.
    public func elevationTickLabel(_ value: Double, locale: Locale = .current) -> String {
        ElevationProfileFormat.number(value, places: 0, locale: locale)
    }

    /// The tooltip header for a sample — the web `labelFormatter={(v) => \`${fmt(v, 2)} ${unit}\`}`.
    public func distanceLabel(for sample: ElevationProfileSample, locale: Locale = .current) -> String {
        "\(ElevationProfileFormat.number(sample.distance, places: 2, locale: locale)) \(distanceUnit)"
    }

    /// The tooltip value for a sample — the web `formatter={(v) => [\`${fmt(v, 0)} m\`, …]}`.
    public func elevationValue(for sample: ElevationProfileSample, locale: Locale = .current) -> String {
        "\(ElevationProfileFormat.number(sample.elevation, places: 0, locale: locale)) \(metresUnit)"
    }

    /// The sample at the controlled cursor distance, if any (drives the cursor tooltip annotation).
    public var cursorSample: ElevationProfileSample? {
        guard let cursorDistance else { return nil }
        return samples.first { $0.distance == cursorDistance }
    }
}

// MARK: - Layout tokens

/// Layout constants for the surface (web `height = 200`, `distanceUnit = 'km'` defaults).
public enum ElevationProfileLayout {
    public static let defaultHeight: Double = 200
    public static let defaultDistanceUnit = "km"
    public static let maxAxisLabels = 6
}

// MARK: - Number format (web `fmt` / `fmtNumber`)

/// A value-typed, locale-aware number formatter — the native parity of the web `fmt(v, decimals)`
/// (`fmtNumber` → `safeNumber(v).toLocaleString(locale, { min/maxFractionDigits: d })`). Non-finite
/// input coerces to `0` exactly like the web `safeNumber`, so a corrupt sample can never surface as a
/// broken axis label or tooltip.
public enum ElevationProfileFormat {
    /// Web `safeNumber`: a finite number passes through; anything else becomes `0`.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Formats a value with grouping + a fixed number of fraction digits (web `fmt(v, places)`).
    public static func number(_ value: Double, places: Int, locale: Locale = .current) -> String {
        let digits = max(0, places)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        let safe = safe(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }
}

// MARK: - Pure chart logic (gain/loss, cursor, selection, axis thinning, domain, a11y)

/// The view-free decision logic ported from the web component plus the Swift Charts canvas helpers.
/// Each function is a direct translation of a web behaviour (or a Swift Charts adaptation of one) so the
/// view stays a pure function of these and every branch is unit tested in isolation.
public enum ElevationProfileLogic {
    /// The total ascent / descent across consecutive samples — the web `elevGain` reducer. Non-finite
    /// diffs are skipped (a corrupt sample can't poison the total); each total is rounded (web
    /// `Math.round`).
    public static func gainLoss(_ samples: [ElevationProfileSample]) -> ElevationProfileGainLoss {
        guard samples.count > 1 else { return .zero }
        var gain = 0.0
        var loss = 0.0
        for index in 1 ..< samples.count {
            let diff = samples[index].elevation - samples[index - 1].elevation
            guard diff.isFinite else { continue }
            if diff > 0 { gain += diff } else { loss += abs(diff) }
        }
        return ElevationProfileGainLoss(gain: Int(gain.rounded()), loss: Int(loss.rounded()))
    }

    /// Drops samples whose distance or elevation is non-finite so a corrupt value can never break the
    /// axis or the area path (the Swift Charts parity of the web charts skipping `NaN`).
    public static func sanitized(_ samples: [ElevationProfileSample]) -> [ElevationProfileSample] {
        samples.filter { $0.distance.isFinite && $0.elevation.isFinite }
    }

    /// The valid array position for the controlled cursor — the web `data[currentIndex]` guard
    /// (`currentIndex == null || !data[currentIndex]` → none). `currentIndex` is an ARRAY position (web
    /// semantics), distinct from a sample's `.index` field.
    public static func cursorArrayPosition(count: Int, currentIndex: Int?) -> Int? {
        guard let currentIndex, currentIndex >= 0, currentIndex < count else { return nil }
        return currentIndex
    }

    /// The X (distance) value of the controlled cursor — the web `data[currentIndex].distance`. `nil`
    /// when the index is unset or out of range (web `undefined`).
    public static func cursorDistance(_ samples: [ElevationProfileSample], currentIndex: Int?) -> Double? {
        guard let position = cursorArrayPosition(count: samples.count, currentIndex: currentIndex) else {
            return nil
        }
        return samples[position].distance
    }

    /// The array position of the sample nearest a selected X (distance) — the Swift Charts adaptation of
    /// the web `state.activeTooltipIndex`. Used to translate a `chartXSelection` distance back into the
    /// sample whose `.index` is emitted to `onClickIndex`.
    public static func nearestArrayPosition(_ samples: [ElevationProfileSample], toDistance distance: Double) -> Int? {
        guard !samples.isEmpty else { return nil }
        var bestPosition = 0
        var bestDelta = Double.greatestFiniteMagnitude
        for (position, sample) in samples.enumerated() {
            let delta = abs(sample.distance - distance)
            if delta < bestDelta {
                bestDelta = delta
                bestPosition = position
            }
        }
        return bestPosition
    }

    /// The sample `.index` field emitted to the host for a selected array position — the web
    /// `onClickIndex(data[idx].index)` mapping. `nil` for an out-of-range position.
    public static func sampleIndex(_ samples: [ElevationProfileSample], atArrayPosition position: Int) -> Int? {
        guard position >= 0, position < samples.count else { return nil }
        return samples[position].index
    }

    /// An evenly-strided subset of the X-axis distance ticks (keeps endpoints) — the Swift Charts
    /// adaptation of Recharts' auto-thinned continuous axis, so a long route never crowds its labels.
    public static func axisDistanceValues(
        _ samples: [ElevationProfileSample],
        maxLabels: Int = ElevationProfileLayout.maxAxisLabels
    ) -> [Double] {
        let distances = samples.map(\.distance)
        guard maxLabels > 1, distances.count > maxLabels else { return distances }
        let step = Double(distances.count - 1) / Double(maxLabels - 1)
        var picked: [Double] = []
        var seen = Set<Int>()
        for index in 0 ..< maxLabels {
            let resolved = Int((Double(index) * step).rounded())
            if seen.insert(resolved).inserted { picked.append(distances[resolved]) }
        }
        return picked
    }

    /// The padded elevation Y-domain for the chart scale (Recharts auto-domains the area). A flat series
    /// gets a ±1 m window; otherwise the range is padded 10% so the area never clips the panel edge.
    public static func elevationDomain(_ samples: [ElevationProfileSample]) -> ClosedRange<Double> {
        let values = samples.map(\.elevation).filter(\.isFinite)
        guard let low = values.min(), let high = values.max() else { return 0 ... 1 }
        guard high > low else { return (low - 1) ... (high + 1) }
        let padding = (high - low) * 0.1
        return (low - padding) ... (high + padding)
    }

    /// A concise VoiceOver summary for the plotted profile (span, elevation range, ascent / descent),
    /// localised. Falls back to the surface title when there is no plottable sample.
    public static func accessibilitySummary(
        _ samples: [ElevationProfileSample],
        gainLoss: ElevationProfileGainLoss,
        distanceUnit: String,
        locale: Locale,
        strings: ElevationProfileResolve
    ) -> String {
        let elevations = samples.map(\.elevation).filter(\.isFinite)
        guard let minElevation = elevations.min(),
              let maxElevation = elevations.max(),
              let first = samples.first,
              let last = samples.last
        else {
            return strings("replay.elevation.title", "Elevation Profile")
        }
        let span = abs(last.distance - first.distance)
        let template = strings(
            "replay.elevation.a11y.summary",
            "Elevation profile over %1$@ %2$@: from %3$@ to %4$@ metres, " +
                "total ascent %5$@ metres, total descent %6$@ metres"
        )
        return String(
            format: template,
            ElevationProfileFormat.number(span, places: 1, locale: locale),
            distanceUnit,
            ElevationProfileFormat.number(minElevation, places: 0, locale: locale),
            ElevationProfileFormat.number(maxElevation, places: 0, locale: locale),
            ElevationProfileFormat.number(Double(gainLoss.gain), places: 0, locale: locale),
            ElevationProfileFormat.number(Double(gainLoss.loss), places: 0, locale: locale)
        )
    }
}
