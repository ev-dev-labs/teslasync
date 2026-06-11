//
//  TirePressurePanel.Projector.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  The pure (Foundation-only) computational core for the telemetry-panels "Tire Pressure"
//  surface: the SI(Pa)→display projector, the `formatPressure` number port, the
//  render-phase resolver, the live-state freshness enum, the diagnostics slug, and the
//  VoiceOver summary. Split out of TirePressurePanel.Adapter.swift (which holds the value
//  types) to keep each file within the lint budget; both are dependency-free so every
//  number can be pinned by unit tests without a bundle or a rendered view.
//

import Foundation

// MARK: - Number formatting (ported 1:1 from lib/unitConversion.ts `formatPressure`)

/// Locale-aware pressure formatting — the port of `formatPressure(paToKpa(pa), pref)`:
/// non-finite input yields the `—` empty display; otherwise the pascals are converted to
/// the display unit and rendered at `DEFAULT_PRECISION.pressure` (one fraction digit),
/// locale-grouped, with the unit symbol appended after a space. Bundle-free.
public enum TPPanelFormat {
    /// The web `DEFAULT_PRECISION.pressure`.
    public static let pressureFractionDigits = 1
    /// The web `DEFAULT_EMPTY_DISPLAY` (`'—'`), used when no override is supplied.
    public static let defaultEmptyDisplay = "—"

    /// `formatNumber(value, locale, fractionDigits)`: fixed fraction digits, grouped,
    /// half-away-from-zero — the Foundation analogue of `Intl.NumberFormat`.
    public static func number(
        _ value: Double,
        fractionDigits: Int = pressureFractionDigits,
        localeIdentifier: String = "en_US"
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        let digits = max(0, fractionDigits)
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }

    /// One tile's display value — the 1:1 port of `formatPressure(paToKpa(value))`: the `—`
    /// empty display for a null / non-finite corner, else the converted pascals at one
    /// fraction digit with the unit symbol (e.g. "289.5 kPa").
    public static func pressure(
        pascals: Double?,
        unit: TPPanelUnit,
        localeIdentifier: String = "en_US",
        emptyDisplay: String = defaultEmptyDisplay
    ) -> String {
        guard let pascals, pascals.isFinite else { return emptyDisplay }
        let value = unit.convert(fromSI: pascals)
        return "\(number(value, localeIdentifier: localeIdentifier)) \(unit.symbol)"
    }
}

// MARK: - Projector (pure, web-parity)

/// The dependency-free projection from a SI snapshot + the display unit to the view-ready
/// `TPPanelProjection`. A faithful port of the web `tires.map`: build one tile per corner
/// (FL → FR → RL → RR), each carrying the formatted value and the band tone, plus the
/// overall summary chip; a `nil` snapshot yields no tiles (the empty gate).
public enum TPPanelProjector {
    /// Projects the SI snapshot into the converted, view-ready projection.
    public static func project(
        snapshot: TPPanelSnapshot?,
        unit: TPPanelUnit,
        localeIdentifier: String = "en_US",
        emptyDisplay: String = TPPanelFormat.defaultEmptyDisplay
    ) -> TPPanelProjection {
        guard let snapshot else {
            return TPPanelProjection(
                readings: [],
                overall: .check,
                hasSnapshot: false,
                unitSymbol: unit.symbol
            )
        }
        let readings = TPPanelCorner.ordered.map { corner -> TPPanelReading in
            let pascals = snapshot.pascals(for: corner)
            return TPPanelReading(
                corner: corner,
                pascals: pascals,
                valueText: TPPanelFormat.pressure(
                    pascals: pascals,
                    unit: unit,
                    localeIdentifier: localeIdentifier,
                    emptyDisplay: emptyDisplay
                ),
                variant: TPPanelVariant.classify(pascals)
            )
        }
        return TPPanelProjection(
            readings: readings,
            overall: TPPanelOverallStatus.classify(snapshot.orderedPressures),
            hasSnapshot: true,
            unitSymbol: unit.symbol
        )
    }
}

// MARK: - Render phase

/// What the surface should render. The web source distinguishes only content vs the "No
/// tire pressure data available" empty state; the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the web parent page's
/// `isLoading` / error wiring that feeds the leaf its `tireData` prop.
public enum TPPanelPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web `isLoading` / resolved / failure), projected into a
/// phase by `resolvePhase`.
public enum TPPanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a
/// cached grid is clearly labeled while reconnecting / offline.
public enum TPPanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension TPPanelProjector {
    /// Resolves the render phase from the bound load status + whether a snapshot cleared the
    /// web content gate. Cached content stays visible across refresh / transient failures so
    /// an offline or stale pod still shows the last-known grid.
    static func resolvePhase(_ status: TPPanelLoadStatus, hasContent: Bool) -> TPPanelPhase {
        switch status {
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            hasContent ? .content : .empty
        case let .failed(message):
            hasContent ? .content : .error(message)
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum TPPanelSurface {
    public static let slug = "TirePressurePanel"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary through an injected localizer
/// (`(key, fallback) -> String`), so it is bundle-free testable. Speaks the title, then the
/// overall status, then each corner's value, or the no-data sentence when the snapshot is
/// absent.
public enum TPPanelAccessibility {
    /// The panel-level summary: the title, the overall status, and each corner's spoken
    /// name + value (e.g. "Tire Pressure: All Normal. Front Left 289.5 kPa, …"), or the
    /// empty sentence when no snapshot is present.
    public static func summary(
        projection: TPPanelProjection,
        localize: (String, String) -> String,
        localeIdentifier _: String = "en_US"
    ) -> String {
        let title = localize("common.tirePressure", "Tire Pressure")
        guard projection.hasContent else {
            let empty = localize("tirePanel.noData", "No tire pressure data available")
            return "\(title): \(empty)"
        }
        let overall = localize(projection.overall.labelKey, projection.overall.labelFallback)
        let parts = projection.readings.map { reading -> String in
            let label = localize(reading.corner.accessibilityKey, reading.corner.accessibilityFallback)
            return "\(label) \(reading.valueText)"
        }
        return "\(title): \(overall). \(parts.joined(separator: ", "))"
    }
}
