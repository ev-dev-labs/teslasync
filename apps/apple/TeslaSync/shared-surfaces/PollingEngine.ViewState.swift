//
//  PollingEngine.ViewState.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The resolved, view-ready value types produced by `PollingProjection` and consumed by the
//  PollingEngine views — the localized peers of the web render branches (the `SavingsCard` metrics +
//  stacked breakdown + legend, the `VehicleActivity` collapsed header + expanded detail + prediction,
//  the ready panel, and the resolved phase). Pure Foundation, `Sendable` + `Equatable`, so the view
//  is a pure function of these values and every projection branch is asserted without SwiftUI.
//

import Foundation

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// One savings metric tile — a formatted value, its label, the tint, and the combined VoiceOver
/// string (web `SavingsCard` tile: `<AnimatedNumber/>` + caption).
public struct PollingMetricVM: Sendable, Equatable, Identifiable {
    public let id: String
    public let value: String
    public let label: String
    public let tone: PollingTone
    public let accessibilityLabel: String

    public init(id: String, value: String, label: String, tone: PollingTone, accessibilityLabel: String) {
        self.id = id
        self.value = value
        self.label = label
        self.tone = tone
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One rendered breakdown-bar segment — its fraction of the bar width, its tint, and the
/// "{label}: {value}" string surfaced as the pointer tooltip + VoiceOver label (web inline `title`).
public struct PollingSegmentVM: Sendable, Equatable, Identifiable {
    public let id: String
    public let fraction: Double
    public let tone: PollingTone
    public let accessibilityLabel: String

    public init(id: String, fraction: Double, tone: PollingTone, accessibilityLabel: String) {
        self.id = id
        self.fraction = fraction
        self.tone = tone
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One breakdown legend entry — a tinted dot + a label (web legend row).
public struct PollingLegendItemVM: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let tone: PollingTone

    public init(id: String, label: String, tone: PollingTone) {
        self.id = id
        self.label = label
        self.tone = tone
    }
}

/// The fully-resolved savings card — the four metrics, the (possibly empty) breakdown segments, and
/// the legend (shown only when there is a positive total, web `total > 0 &&`).
public struct PollingSavingsVM: Sendable, Equatable {
    public let metrics: [PollingMetricVM]
    public let segments: [PollingSegmentVM]
    public let legend: [PollingLegendItemVM]
    public let accessibilityLabel: String

    /// Whether the stacked bar + legend render (web `total > 0`).
    public var showBreakdown: Bool {
        !segments.isEmpty
    }

    public init(
        metrics: [PollingMetricVM],
        segments: [PollingSegmentVM],
        legend: [PollingLegendItemVM],
        accessibilityLabel: String
    ) {
        self.metrics = metrics
        self.segments = segments
        self.legend = legend
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One reason line in the expanded vehicle detail (web `last_decision.reasons.map`).
public struct PollingReasonVM: Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String

    public init(id: String, text: String) {
        self.id = id
        self.text = text
    }
}

/// The resolved prediction block (web `last_decision.prediction` lines).
public struct PollingPredictionVM: Sendable, Equatable {
    public let summary: String
    public let basedOn: String
    public let accessibilityLabel: String

    public init(summary: String, basedOn: String, accessibilityLabel: String) {
        self.summary = summary
        self.basedOn = basedOn
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The expanded vehicle detail — shown only when a `last_decision` exists (web `expanded &&
/// status.last_decision &&`).
public struct PollingVehicleDetailVM: Sendable, Equatable {
    public let interval: String
    public let consecIdle: String
    public let battery: String
    public let reasons: [PollingReasonVM]
    public let prediction: PollingPredictionVM?

    public init(
        interval: String,
        consecIdle: String,
        battery: String,
        reasons: [PollingReasonVM],
        prediction: PollingPredictionVM?
    ) {
        self.interval = interval
        self.consecIdle = consecIdle
        self.battery = battery
        self.reasons = reasons
        self.prediction = prediction
    }
}

/// One resolved vehicle row — the collapsed header (icon + short VIN + activity chip + next-poll) and
/// the optional expanded detail (web `VehicleActivity`).
public struct PollingVehicleVM: Sendable, Equatable, Identifiable {
    public let id: String
    public let vinShort: String
    public let activityChip: String
    public let tone: PollingTone
    public let symbolName: String
    public let pulses: Bool
    public let nextLabel: String
    public let detail: PollingVehicleDetailVM?
    public let accessibilityLabel: String

    public init(
        id: String,
        vinShort: String,
        activityChip: String,
        tone: PollingTone,
        symbolName: String,
        pulses: Bool,
        nextLabel: String,
        detail: PollingVehicleDetailVM?,
        accessibilityLabel: String
    ) {
        self.id = id
        self.vinShort = vinShort
        self.activityChip = activityChip
        self.tone = tone
        self.symbolName = symbolName
        self.pulses = pulses
        self.nextLabel = nextLabel
        self.detail = detail
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully-resolved "ready" panel — the localized header, the optional savings card, and the
/// vehicle list (or the empty message). The view is a pure function of this value.
public struct PollingReady: Sendable, Equatable {
    public let title: String
    public let activeBadge: String
    public let savings: PollingSavingsVM?
    public let vehiclesTitle: String
    public let vehicles: [PollingVehicleVM]
    public let emptyMessage: String

    /// Web `vehicles.length === 0` → the friendly empty message renders instead of the list.
    public var isEmpty: Bool {
        vehicles.isEmpty
    }

    public init(
        title: String,
        activeBadge: String,
        savings: PollingSavingsVM?,
        vehiclesTitle: String,
        vehicles: [PollingVehicleVM],
        emptyMessage: String
    ) {
        self.title = title
        self.activeBadge = activeBadge
        self.savings = savings
        self.vehiclesTitle = vehiclesTitle
        self.vehicles = vehicles
        self.emptyMessage = emptyMessage
    }
}

/// The resolved view-state — `phase` selects the body, `ready` carries the localized panel when
/// polling is enabled and the status read has resolved.
public struct PollingResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `!status.enabled → null` → the surface renders nothing.
        case disabled
        /// The status read resolving → skeleton chrome.
        case loading
        /// The status read failed → a retryable error.
        case error(String)
        /// Polling enabled → the panel (header + savings + vehicles / empty).
        case ready
    }

    public let phase: Phase
    public let ready: PollingReady?

    public init(phase: Phase, ready: PollingReady?) {
        self.phase = phase
        self.ready = ready
    }
}
