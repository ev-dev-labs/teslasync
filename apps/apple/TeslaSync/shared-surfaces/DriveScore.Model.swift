//
//  DriveScore.Model.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8)
//  for the drive-quality score. The web component binds a single hook — `useTranslation` — and takes
//  its data as a plain `drive` prop; there is no fetcher, so the native peer needs no data
//  state-holder. What the holder DOES own is the surface lifecycle: it carries the current
//  ``DriveScoreSurfaceInputs``, derives the pure ``DriveScoreSurfaceProjection`` + the localized copy
//  and VoiceOver labels as observed reads (SwiftUI observation replaces the React re-render), and
//  emits the surface's single `view.opened` diagnostics event. No networking lives here; the
//  derivation is the pure projection, so the holder is a thin, testable shell.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The visible keys mirror the web `t()` calls verbatim (`driveScore.title`,
/// `driveScore.score`, and the four `driveScore.*` axis labels); two extra `driveScore.a11y.*`
/// formats compose the VoiceOver labels (the web relies on the visible text being read — the native
/// peer makes the gauge + rows first-class accessibility elements instead). Keys live in the
/// "DriveScore" table, folded into the app `Localizable.xcstrings` catalog at integration time; in
/// test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum DriveScoreSurfaceStrings {
    public static let table = "DriveScore"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The breakdown heading — web `t('driveScore.title', 'Drive Score')`.
    public static var title: String {
        string("driveScore.title", "Drive Score")
    }

    /// The caption under the gauge number — web `t('driveScore.score', 'Score')`.
    public static var scoreCaption: String {
        string("driveScore.score", "Score")
    }

    /// An axis label — web `t('driveScore.efficiency', 'Efficiency')` and its three peers.
    public static func categoryLabel(_ category: DriveScoreSurfaceCategory) -> String {
        string(category.localizationKey, category.fallbackLabel)
    }

    /// The gauge VoiceOver label — "Drive Score: {total} out of {max}". Positional (`%1$d` / `%2$d`)
    /// so a translation may reorder the operands.
    public static func scoreAccessibilityLabel(total: Int, maxScore: Int) -> String {
        let template = string("driveScore.a11y.score", "Drive Score: %1$d out of %2$d")
        return String(format: template, total, maxScore)
    }

    /// A breakdown-row VoiceOver label — "{axis}: {value} of {max} points". Positional so the axis
    /// name and the operands can be reordered by a translation.
    public static func breakdownAccessibilityLabel(label: String, value: Int, maxPoints: Int) -> String {
        let template = string("driveScore.a11y.breakdown", "%1$@: %2$d of %3$d points")
        return String(format: template, label, value, maxPoints)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DriveScoreSurfaceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDriveScoreSurfaceTelemetry: DriveScoreSurfaceTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DriveScoreSurfaceRowViewData (resolved breakdown row)

/// A breakdown row with its copy already resolved through the P1/S10 facade — the bundle the
/// presentational row renders. Keeping the localized `label` + `accessibilityLabel` next to the pure
/// ``DriveScoreSurfaceBreakdownItem`` lets the content view stay a pure, `Equatable` function of its
/// inputs (no facade calls in `body`), so each row is snapshot/preview testable in isolation.
public struct DriveScoreSurfaceRowViewData: Sendable, Equatable, Identifiable {
    /// The pure sub-score (value / max / fill fraction / category accent).
    public let item: DriveScoreSurfaceBreakdownItem
    /// The localized axis label (web `t('driveScore.efficiency')` etc.).
    public let label: String
    /// The localized VoiceOver label ("{axis}: {value} of {max} points").
    public let accessibilityLabel: String

    public var id: String {
        item.id
    }

    public init(item: DriveScoreSurfaceBreakdownItem, label: String, accessibilityLabel: String) {
        self.item = item
        self.label = label
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - DriveScoreSurfaceModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``DriveScoreSurfaceInputs`` (the web
/// `drive` prop), derives the pure ``DriveScoreSurfaceProjection`` + the localized copy and VoiceOver
/// labels as observed reads, and emits `view.opened` exactly once per instance. The web component has
/// no fetcher, so neither does this holder — `update(_:)` is the native peer of React re-rendering
/// with new props, reassigning only when the inputs actually change so an unrelated re-render does
/// not invalidate observers.
@MainActor
@Observable
public final class DriveScoreSurfaceModel {
    /// The current props (web `drive`). Reading it (or anything derived from it) registers an
    /// observation dependency, so the surface re-renders when the drive changes.
    public private(set) var inputs: DriveScoreSurfaceInputs

    @ObservationIgnored private let telemetry: any DriveScoreSurfaceTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        inputs: DriveScoreSurfaceInputs,
        telemetry: any DriveScoreSurfaceTelemetry = OSLogDriveScoreSurfaceTelemetry()
    ) {
        self.inputs = inputs
        self.telemetry = telemetry
    }

    public convenience init(
        distanceM: Double? = nil,
        durationS: Double? = nil,
        maxSpeedMps: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil,
        telemetry: any DriveScoreSurfaceTelemetry = OSLogDriveScoreSurfaceTelemetry()
    ) {
        self.init(
            inputs: DriveScoreSurfaceInputs(
                distanceM: distanceM,
                durationS: durationS,
                maxSpeedMps: maxSpeedMps,
                startBatteryPct: startBatteryPct,
                endBatteryPct: endBatteryPct
            ),
            telemetry: telemetry
        )
    }

    /// The resolved, view-ready score (web `computeDriveScore` output).
    public var projection: DriveScoreSurfaceProjection {
        DriveScoreSurfaceProjector.compute(inputs)
    }

    /// The breakdown heading (web `t('driveScore.title')`).
    public var title: String {
        DriveScoreSurfaceStrings.title
    }

    /// The gauge caption (web `t('driveScore.score')`).
    public var scoreCaption: String {
        DriveScoreSurfaceStrings.scoreCaption
    }

    /// The localized label for an axis (web `t('driveScore.efficiency')` etc.).
    public func label(for category: DriveScoreSurfaceCategory) -> String {
        DriveScoreSurfaceStrings.categoryLabel(category)
    }

    /// The gauge VoiceOver label — "Drive Score: {total} out of 100".
    public var scoreAccessibilityLabel: String {
        DriveScoreSurfaceStrings.scoreAccessibilityLabel(
            total: projection.total,
            maxScore: DriveScoreSurfaceConstants.maxTotalScore
        )
    }

    /// The VoiceOver label for a breakdown row — "{axis}: {value} of {max} points".
    public func accessibilityLabel(for item: DriveScoreSurfaceBreakdownItem) -> String {
        DriveScoreSurfaceStrings.breakdownAccessibilityLabel(
            label: label(for: item.category),
            value: item.value,
            maxPoints: item.maxPoints
        )
    }

    /// The four breakdown rows with their copy resolved — what the presentational breakdown renders.
    public var rows: [DriveScoreSurfaceRowViewData] {
        projection.breakdown.map { item in
            DriveScoreSurfaceRowViewData(
                item: item,
                label: label(for: item.category),
                accessibilityLabel: accessibilityLabel(for: item)
            )
        }
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when
    /// the inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ inputs: DriveScoreSurfaceInputs) {
        guard inputs != self.inputs else { return }
        self.inputs = inputs
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI
    /// appear/disappear churn — the event fires a single time per model instance, never again on a
    /// later re-appear.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DriveScoreSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()`` for the host's appear/disappear
    /// lifecycle; the once-only `view.opened` contract is preserved (a later ``start()`` does not
    /// re-emit).
    public func stop() {
        started = false
    }
}
