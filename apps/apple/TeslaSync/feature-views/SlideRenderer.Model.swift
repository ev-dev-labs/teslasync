//
//  SlideRenderer.Model.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + surface identity + i18n
//  facade (P1/S10) for the SwiftUI parity of
//  features/analytics/components/review/SlideRenderer.tsx. Vendor-agnostic and SwiftUI-free so the
//  dispatch / projection logic compiles and runs on a plain host and is pinned by unit tests; the
//  surface view layers the SwiftUI chrome on top in SlideRenderer.swift. The view binds through
//  `SlideRendererModel`; no networking lives in the view.
//
//  Parity target: the web `SlideRenderer` is a composition/dispatch surface. It receives one resolved
//  `YearReview`, a `SlideDefinition` (`type` + gradient `bg` + optional `field`), and a `slideIndex`,
//  then `AnimatePresence`-wraps a gradient `motion.div` keyed by the index and `switch`-dispatches on
//  `slide.type` to one of ten child slide surfaces (each its own P4 prompt). The ONLY `t()` calls the
//  web renderer itself owns are the two drive-highlight labels (`yearReview.longestDrive` /
//  `yearReview.mostEfficient`) plus the variant emoji + which drive it forwards. Everything else it
//  forwards verbatim. The native surface reproduces that dispatch + the gradient + the keyed
//  transition, exposes the load / empty / error / stale / offline chrome the parent story shell owns
//  on the web (so every P4 state renders), and forwards each slide's body through a parent-supplied
//  renderer (the real child surfaces) — exactly the `DashboardGrid<WidgetBody>` registry pattern.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug) — kept SwiftUI-free

/// Stable, non-identifying identity for the `SlideRenderer` feature view. The slug is the value
/// emitted with the P1/S11 `view.opened` diagnostics contract and is referenced by both the view and
/// its tests so the two never drift. `SlideRenderer` re-exposes it as `surfaceSlug`.
public enum SlideRendererSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "SlideRenderer"

    /// Reports the surface becoming visible. Factored out of the view so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any SlideRendererTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there. `Sendable`
/// (members non-isolated) so the view can emit without a main-actor hop.
public protocol SlideRendererTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant logged verbatim; no recap payload is recorded.
public struct OSLogSlideRendererTelemetry: SlideRendererTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the view holds no hardcoded
/// literals. Keys live in the "SlideRenderer" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. The first block reproduces the EXACT keys the web `SlideRenderer`
/// owns (`yearReview.longestDrive` / `yearReview.mostEfficient`); the `slideRenderer.*` keys back the
/// renderer's own chrome + its built-in default slide composition. `string` is Foundation-only so the
/// adapter's accessibility summaries can use it; the SwiftUI `text(_:_:)` helper lives in the view.
public enum SlideRendererStrings {
    public static let table = "SlideRenderer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web template literal `${value}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Slide kind (web `slide.type`)

/// The dispatch tag — the native enum parity of the web `SlideDefinition.type` string the renderer
/// `switch`es over. `unknown` carries the raw string so the renderer can mirror the web `default:`
/// arm (which renders the gradient with no slide body) without losing the value.
public enum SlideKind: Equatable, Sendable {
    case title
    case statHero
    case statChart
    case driveHighlight
    case chargingBreakdown
    case savings
    case environment
    case patterns
    case comparisons
    case summary
    case unknown(String)

    /// Parses the web `slide.type` wire string. Unrecognized values fold to `.unknown(raw)`,
    /// reproducing the web `switch`'s `default` branch.
    public init(type: String) {
        self = SlideKind.known[type] ?? .unknown(type)
    }

    /// The wire string this kind parses from (round-trips `init(type:)`).
    public var rawType: String {
        if case let .unknown(raw) = self { return raw }
        return SlideKind.known.first { $0.value == self }?.key ?? ""
    }

    /// The static `type` → kind table (the web `SLIDE_DEFS` `type` strings). A lookup table rather
    /// than a `switch` so the dispatch stays a single, low-complexity expression.
    private static let known: [String: SlideKind] = [
        "title": .title,
        "stat-hero": .statHero,
        "stat-chart": .statChart,
        "drive-highlight": .driveHighlight,
        "charging-breakdown": .chargingBreakdown,
        "savings": .savings,
        "environment": .environment,
        "patterns": .patterns,
        "comparisons": .comparisons,
        "summary": .summary
    ]
}

/// Which drive a `drive-highlight` slide forwards — the native parity of the web arm's
/// `slide.field === 'longest' ? data.longest_drive : data.most_efficient_drive` branch (with the
/// matching label key + emoji). Any non-`"longest"` field resolves to `.mostEfficient`, exactly like
/// the web ternary's `else`.
public enum DriveHighlightVariant: Equatable, Sendable {
    case longest
    case mostEfficient

    public init(field: String?) {
        self = field == "longest" ? .longest : .mostEfficient
    }

    /// The decorative emoji the web arm passes (`🏔️` / `🌿`).
    public var emoji: String {
        switch self {
        case .longest: "🏔️"
        case .mostEfficient: "🌿"
        }
    }

    /// The i18n key the web arm resolves for the slide label.
    public var labelKey: String {
        switch self {
        case .longest: "yearReview.longestDrive"
        case .mostEfficient: "yearReview.mostEfficient"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .longest: "Longest Drive"
        case .mostEfficient: "Most Efficient Drive"
        }
    }
}

// MARK: - Slide definition (web `SlideDefinition`)

/// One entry of the web `SLIDE_DEFS` table — the slide `type`, its Tailwind gradient `bg` class, and
/// the optional `field`. Parsed into a `SlideKind`; the raw `background` string is consumed by the
/// gradient adapter (`SlideRendererGradient`). `Identifiable` by index is supplied by the model's
/// ordering, so this stays a pure value.
public struct SlideDefinitionInput: Equatable, Sendable {
    public let type: String
    public let field: String?
    public let background: String

    public init(type: String, field: String? = nil, background: String) {
        self.type = type
        self.field = field
        self.background = background
    }

    public var kind: SlideKind {
        SlideKind(type: type)
    }

    /// The drive-highlight variant when this is a `drive-highlight` slide (web `slide.field`).
    public var driveHighlightVariant: DriveHighlightVariant {
        DriveHighlightVariant(field: field)
    }
}

// MARK: - Year-in-review recap (web `YearReview` subset the renderer composes)

/// One drive highlight — the projection of the web `YearReviewDriveHighlight`. SI on the wire
/// (`distance_km`, `efficiency_wh_km`); the display boundary formats it.
public struct YearReviewRecapDrive: Equatable, Sendable {
    public let driveID: Int
    public let date: String
    public let distanceKm: Double
    public let durationMin: Int
    public let startAddress: String
    public let endAddress: String
    public let efficiencyWhKm: Double

    public init(
        driveID: Int,
        date: String,
        distanceKm: Double,
        durationMin: Int,
        startAddress: String,
        endAddress: String,
        efficiencyWhKm: Double
    ) {
        self.driveID = driveID
        self.date = date
        self.distanceKm = distanceKm
        self.durationMin = durationMin
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.efficiencyWhKm = efficiencyWhKm
    }
}

/// One fun-fact comparison — the projection of the web `YearReviewComparison` (`emoji` + `label` +
/// `value`).
public struct YearReviewRecapComparison: Equatable, Sendable, Identifiable {
    public let label: String
    public let value: String
    public let emoji: String

    public var id: String {
        label
    }

    public init(label: String, value: String, emoji: String) {
        self.label = label
        self.value = value
        self.emoji = emoji
    }
}

/// The resolved recap the renderer composes its built-in slide bodies from — the SI subset of the web
/// `YearReview` DTO each slide foregrounds. The parent maps the shared S8 `AnalyticsStore.yearReview`
/// resource into this; the renderer never touches the network. Everything is SI (km, kWh, kg, °C); the
/// display boundary applies the user's unit preference.
public struct YearReviewRecap: Equatable, Sendable {
    public let year: Int
    public let vehicleName: String

    // Headline stats
    public let totalDrives: Int
    public let totalDistanceKm: Double
    public let totalEnergyKwh: Double
    public let totalChargeSessions: Int
    public let gasSavings: Double
    public let co2OffsetKg: Double

    // Charging habits
    public let superchargerPct: Double
    public let dcFastPct: Double
    public let acOtherPct: Double
    public let avgChargeStartSoc: Double

    // Patterns
    public let mostActiveDayOfWeek: String
    public let mostActiveHour: Int
    public let avgDrivesPerWeek: Double

    // Extremes forwarded to the drive-highlight arm
    public let longestDrive: YearReviewRecapDrive?
    public let mostEfficientDrive: YearReviewRecapDrive?

    /// Fun facts
    public let comparisons: [YearReviewRecapComparison]

    public init(
        year: Int,
        vehicleName: String,
        totalDrives: Int,
        totalDistanceKm: Double,
        totalEnergyKwh: Double,
        totalChargeSessions: Int,
        gasSavings: Double,
        co2OffsetKg: Double,
        superchargerPct: Double,
        dcFastPct: Double,
        acOtherPct: Double,
        avgChargeStartSoc: Double,
        mostActiveDayOfWeek: String,
        mostActiveHour: Int,
        avgDrivesPerWeek: Double,
        longestDrive: YearReviewRecapDrive?,
        mostEfficientDrive: YearReviewRecapDrive?,
        comparisons: [YearReviewRecapComparison]
    ) {
        self.year = year
        self.vehicleName = vehicleName
        self.totalDrives = totalDrives
        self.totalDistanceKm = totalDistanceKm
        self.totalEnergyKwh = totalEnergyKwh
        self.totalChargeSessions = totalChargeSessions
        self.gasSavings = gasSavings
        self.co2OffsetKg = co2OffsetKg
        self.superchargerPct = superchargerPct
        self.dcFastPct = dcFastPct
        self.acOtherPct = acOtherPct
        self.avgChargeStartSoc = avgChargeStartSoc
        self.mostActiveDayOfWeek = mostActiveDayOfWeek
        self.mostActiveHour = mostActiveHour
        self.avgDrivesPerWeek = avgDrivesPerWeek
        self.longestDrive = longestDrive
        self.mostEfficientDrive = mostEfficientDrive
        self.comparisons = comparisons
    }

    /// The drive a `drive-highlight` slide forwards for `variant` — the web arm's
    /// `data.longest_drive` / `data.most_efficient_drive` selection.
    public func drive(for variant: DriveHighlightVariant) -> YearReviewRecapDrive? {
        switch variant {
        case .longest: longestDrive
        case .mostEfficient: mostEfficientDrive
        }
    }
}
