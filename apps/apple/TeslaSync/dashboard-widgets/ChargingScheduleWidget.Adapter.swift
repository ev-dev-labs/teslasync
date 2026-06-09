//
//  ChargingScheduleWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  The pure, SwiftUI-free, Shared-free projection layer: the parsed signals +
//  cached state (modeled in ChargingScheduleWidget.Signals.swift) folded into the
//  view's render model — the mode badge (`modeLabel` / `modeBadgeVariant`), the
//  scheduled-times timeline (the `timelineItems` `useMemo`), the `hasScheduleData`
//  gate, the compact charge-limit hero, and the tall current-level / status
//  detail. A 1:1 port of `features/dashboard/widgets/ChargingScheduleWidget.tsx`,
//  kept free of SwiftUI + the KMP `Shared` framework so it is unit-testable on the
//  host without rendering or the Kotlin/Native toolchain.
//

import Foundation

// MARK: - Mode (port of `modeLabel` + `modeBadgeVariant`)

/// The badge tone for the schedule mode — the web `modeBadgeVariant` mapping
/// (`StartAt`/`DepartBy` → success, `Off` → neutral, anything else → warning).
public enum ChargingScheduleModeTone: Sendable, Equatable {
    case success
    case neutral
    case warning
}

/// The resolved schedule mode presentation: the localized (or verbatim-raw)
/// label plus its badge tone — the web `modeLabel(mode, t)` + `modeBadgeVariant`.
public struct ChargingScheduleMode: Sendable, Equatable {
    public var label: String
    public var tone: ChargingScheduleModeTone

    public init(label: String, tone: ChargingScheduleModeTone) {
        self.label = label
        self.tone = tone
    }

    /// Resolves a raw `ScheduledChargingMode` value into its label + tone. The
    /// known modes localize through the surface table; an unrecognized non-nil
    /// mode shows verbatim (web `mode ?? 'Unknown'`), and `nil` localizes to
    /// "Unknown".
    public static func resolve(_ raw: String?) -> ChargingScheduleMode {
        switch raw {
        case "StartAt":
            ChargingScheduleMode(
                label: ChargingScheduleStrings.string("widget.chargingSchedule.modeStartAt", "Start At"),
                tone: .success
            )
        case "DepartBy":
            ChargingScheduleMode(
                label: ChargingScheduleStrings.string("widget.chargingSchedule.modeDepartBy", "Depart By"),
                tone: .success
            )
        case "Off":
            ChargingScheduleMode(
                label: ChargingScheduleStrings.string("widget.chargingSchedule.modeOff", "Off"),
                tone: .neutral
            )
        case let .some(value):
            ChargingScheduleMode(label: value, tone: .warning)
        case .none:
            ChargingScheduleMode(
                label: ChargingScheduleStrings.string("widget.chargingSchedule.modeUnknown", "Unknown"),
                tone: .warning
            )
        }
    }
}

// MARK: - Timeline item (port of the web `timelineItems`)

/// One scheduled-event row in the timeline — the native projection of a single
/// web `timelineItems` entry. Already formatted for display (`time` = "3:30 PM"
/// or "80%"); the optional `subtitle` carries the "Pending" hint on the start
/// row, and `tone` selects the dot/icon accent.
public struct ChargingScheduleTimelineItem: Sendable, Equatable, Identifiable {
    /// Which scheduled event the row represents (also the stable list id).
    public enum Kind: String, Sendable, Equatable {
        case start
        case departure
        case limit
    }

    /// The accent applied to the row's icon + connector dot — the web per-item
    /// `color` (`#22c55e` green / `#3b82f6` blue / `#f59e0b` amber).
    public enum Tone: Sendable, Equatable {
        case start
        case departure
        case limit
    }

    public let kind: Kind
    public let iconSystemName: String
    public let title: String
    public let subtitle: String?
    public let time: String
    public let tone: Tone

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, iconSystemName: String, title: String, subtitle: String?, time: String, tone: Tone) {
        self.kind = kind
        self.iconSystemName = iconSystemName
        self.title = title
        self.subtitle = subtitle
        self.time = time
        self.tone = tone
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed render model the view switches over. Every value is
/// already resolved into display strings so the SwiftUI layer performs no
/// parsing or formatting — only layout. This is the output the adapter tests
/// assert for parity with the web computation.
public struct ChargingScheduleProjection: Sendable, Equatable {
    public var mode: ChargingScheduleMode
    public var pending: Bool
    public var timelineItems: [ChargingScheduleTimelineItem]
    public var compactLimitText: String
    public var hasScheduleData: Bool
    public var hasState: Bool
    public var batteryLevel: Int
    public var isCharging: Bool

    public init(
        mode: ChargingScheduleMode,
        pending: Bool,
        timelineItems: [ChargingScheduleTimelineItem],
        compactLimitText: String,
        hasScheduleData: Bool,
        hasState: Bool,
        batteryLevel: Int,
        isCharging: Bool
    ) {
        self.mode = mode
        self.pending = pending
        self.timelineItems = timelineItems
        self.compactLimitText = compactLimitText
        self.hasScheduleData = hasScheduleData
        self.hasState = hasState
        self.batteryLevel = batteryLevel
        self.isCharging = isCharging
    }

    /// Whether there is at least one scheduled-time row — the web
    /// `timelineItems.length > 0` switch (else "No scheduled times set").
    public var hasTimes: Bool {
        !timelineItems.isEmpty
    }
}

// MARK: - Adapter (cached inputs → projection)

/// Pure transforms from the cached signals + vehicle state to the render model.
/// The state holder calls these; the view never recomputes them.
public enum ChargingScheduleAdapter {
    /// The em-dash the compact hero shows when there is no charge limit
    /// (web `schedule.chargeLimit != null ? … : '—'`).
    static let dash = "—"

    /// Projects the parsed signals + cached state into the render model: the mode
    /// badge, the scheduled-times timeline, the compact charge-limit hero, and the
    /// tall current-level / status detail.
    public static func project(
        signals: ChargingScheduleSignals,
        state: ChargingScheduleStateDTO?,
        options: ChargingScheduleFormatOptions = ChargingScheduleFormatOptions()
    ) -> ChargingScheduleProjection {
        ChargingScheduleProjection(
            mode: ChargingScheduleMode.resolve(signals.mode),
            pending: signals.pending,
            timelineItems: timeline(from: signals, options: options),
            compactLimitText: signals.chargeLimitSoc.map(ChargingScheduleFormat.percent) ?? dash,
            hasScheduleData: signals.mode != nil || signals.startTime != nil || signals.chargeLimitSoc != nil,
            hasState: state != nil,
            batteryLevel: state?.batteryLevel ?? 0,
            isCharging: state?.isCharging ?? false
        )
    }

    /// Builds the ordered timeline rows — the web `timelineItems` `useMemo`: the
    /// start-charging row (with the optional "Pending" subtitle), the departure
    /// row, and the target-limit row, each included only when its signal is set.
    static func timeline(
        from signals: ChargingScheduleSignals,
        options: ChargingScheduleFormatOptions
    ) -> [ChargingScheduleTimelineItem] {
        var items: [ChargingScheduleTimelineItem] = []

        if let startTime = signals.startTime {
            items.append(
                ChargingScheduleTimelineItem(
                    kind: .start,
                    iconSystemName: "bolt.fill",
                    title: ChargingScheduleStrings.string("widget.chargingSchedule.startCharging", "Start Charging"),
                    subtitle: signals.pending
                        ? ChargingScheduleStrings.string("widget.chargingSchedule.pending", "Pending")
                        : nil,
                    time: ChargingScheduleFormat.time(startTime, options: options),
                    tone: .start
                )
            )
        }

        if let departureTime = signals.departureTime {
            items.append(
                ChargingScheduleTimelineItem(
                    kind: .departure,
                    iconSystemName: "clock",
                    title: ChargingScheduleStrings.string("widget.chargingSchedule.departure", "Departure"),
                    subtitle: nil,
                    time: ChargingScheduleFormat.time(departureTime, options: options),
                    tone: .departure
                )
            )
        }

        if let soc = signals.chargeLimitSoc {
            items.append(
                ChargingScheduleTimelineItem(
                    kind: .limit,
                    iconSystemName: "battery.100",
                    title: ChargingScheduleStrings.string("widget.chargingSchedule.targetLimit", "Target Limit"),
                    subtitle: nil,
                    time: ChargingScheduleFormat.percent(soc),
                    tone: .limit
                )
            )
        }

        return items
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the widget. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum ChargingScheduleAccessibility {
    /// The full-size summary: title · mode (+ pending) · each scheduled row, or
    /// the empty-state message when there is no schedule data.
    public static func summary(for projection: ChargingScheduleProjection) -> String {
        let title = ChargingScheduleStrings.string("widget.chargingSchedule.title", "Charging Schedule")
        guard projection.hasScheduleData else {
            let empty = ChargingScheduleStrings.string("widget.chargingSchedule.noData", "No schedule data")
            return "\(title). \(empty)"
        }

        var parts = [title, projection.mode.label]
        if projection.pending {
            parts.append(ChargingScheduleStrings.string("widget.chargingSchedule.pending", "Pending"))
        }
        if projection.hasTimes {
            for item in projection.timelineItems {
                parts.append("\(item.title) \(item.time)")
            }
        } else {
            parts.append(ChargingScheduleStrings.string("widget.chargingSchedule.noTimes", "No scheduled times set"))
        }
        return parts.joined(separator: ". ")
    }

    /// The compact summary: the charge-limit hero ("Charge Limit. 80%").
    public static func compactSummary(limitText: String) -> String {
        let label = ChargingScheduleStrings.string("widget.chargingSchedule.limit", "Charge Limit")
        return "\(label). \(limitText)"
    }
}
