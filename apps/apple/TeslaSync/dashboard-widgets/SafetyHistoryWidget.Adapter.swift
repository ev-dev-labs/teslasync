//
//  SafetyHistoryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  The testable projection core: cached `SafetyEventInput` DTOs → the view-ready
//  `SafetyFeedItem` rows + the 30-day `SafetyStats` summary. Reproduces the web
//  `classifySnapshot` precedence ladder (aeb → fcw → lane → bsw → elda → general),
//  the exact feed dot colors (web hex), the `buildSubtitle` composition
//  (web `parts.join(' · ') || '—'`, raw `String(value)` echoes), the
//  `cleanSafetyEnum` / `isSafetyEnumActive` normalization (web `lib/safetyEnum`),
//  the 30/60-day total + most-common + trend stats, the size-derived compact gate
//  (web `isCompact = size.cols <= 1`), the relative-time formatter, and the
//  VoiceOver summaries. All pure + dependency-free so the adapter can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Heterogeneous enum value (web raw `signal.SignalValue` → `unknown`)

/// One ADAS enum field as it actually arrives from `/safety` — the backend
/// serializes raw `signal.SignalValue` (`interface{}`), so a "string" enum can be a
/// native `bool` (a disabled toggle), a native `number` (legacy `signal_log` rows),
/// or the typed enum string. Mirrors the web `unknown` the `lib/safetyEnum` helpers
/// narrow. `.null` models JS `null`/`undefined` (the web `!= null` gate).
public enum SafetyEnumValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)

    /// Web `value == null` — whether the field was absent (so the subtitle skips it).
    public var isNull: Bool {
        self == .null
    }
}

// MARK: - Enum field identity (web `SAFETY_ENUM_PREFIXES`)

/// The four ADAS enum fields that carry a Tesla raw-enum prefix to strip for old
/// `signal_log` rows — the native port of the web `SAFETY_ENUM_PREFIXES` map.
public enum SafetyHistoryEnumField: Sendable {
    case forwardCollisionWarning
    case laneDepartureAvoidance
    case speedLimitWarning
    case cruiseFollowDistance

    /// Web `SAFETY_ENUM_PREFIXES[field]` — stripped from raw enum strings.
    public var prefix: String {
        switch self {
        case .forwardCollisionWarning: "ForwardCollisionSensitivity"
        case .laneDepartureAvoidance: "LaneAssistLevel"
        case .speedLimitWarning: "SpeedAssistLevel"
        case .cruiseFollowDistance: "FollowDistance"
        }
    }
}

// MARK: - Enum normalization (port of web `lib/safetyEnum`)

/// The single choke point for normalizing a raw ADAS enum value — the native port
/// of the web `cleanSafetyEnum` / `isSafetyEnumActive`. NEVER coerces a non-string
/// to a string (web invariant: `String(false) === "false"` would mis-classify a
/// disabled-by-bool feature as active).
public enum SafetyHistoryEnum {
    /// Web `String(num)` for the number branch + the raw subtitle echo: a finite
    /// integral value renders without a decimal (`3.0 → "3"`), otherwise verbatim.
    public static func numberString(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// Web `cleanSafetyEnum`: booleans → On/Off, finite numbers → their decimal
    /// form, typed strings → prefix-stripped (with the `speed_limit_warning` "None"
    /// → "Off" special case), and null/empty → `fallback`.
    public static func clean(
        _ value: SafetyEnumValue,
        field: SafetyHistoryEnumField,
        fallback: String = "—"
    ) -> String {
        switch value {
        case let .bool(flag):
            return flag ? "On" : "Off"
        case let .number(num):
            return numberString(num)
        case let .string(raw):
            guard !raw.isEmpty else { return fallback }
            let prefix = field.prefix
            if !prefix.isEmpty, raw.hasPrefix(prefix) {
                let stripped = String(raw.dropFirst(prefix.count))
                if field == .speedLimitWarning, stripped == "None" { return "Off" }
                return stripped.isEmpty ? raw : stripped
            }
            return raw
        case .null:
            return fallback
        }
    }

    /// Web `isSafetyEnumActive`: whether the value represents an ENABLED feature.
    /// Centralizes the "off / none / disabled / 0" classification so callers don't
    /// reinvent it (and don't reinvent it WRONG via `String()` coercion).
    public static func isActive(_ value: SafetyEnumValue, field: SafetyHistoryEnumField) -> Bool {
        switch value {
        case .null:
            return false
        case let .bool(flag):
            return flag
        case .number, .string:
            let cleaned = clean(value, field: field, fallback: "")
            guard !cleaned.isEmpty else { return false }
            let lower = cleaned.lowercased()
            if lower == "off" || lower == "none" || lower == "disabled" || lower == "0" {
                return false
            }
            return true
        }
    }

    /// Web `String(value)` for the subtitle echo — the raw stringification used by
    /// `buildSubtitle` (NOT the prefix-stripped `cleanSafetyEnum`).
    public static func rawString(_ value: SafetyEnumValue) -> String {
        switch value {
        case .null: "null"
        case let .bool(flag): flag ? "true" : "false"
        case let .number(num): numberString(num)
        case let .string(raw): raw
        }
    }
}

// MARK: - Severity (web `EventFeedItem['severity']`)

/// Event severity carried through the projection, mapped to a shared `TSTone` for
/// any tinting / VoiceOver. Mirrors the web `'info' | 'warning' | 'critical'`.
public enum SafetySeverity: Sendable, Equatable {
    case info
    case warning
    case critical

    public var tone: TSTone {
        switch self {
        case .info: .info
        case .warning: .warning
        case .critical: .danger
        }
    }
}

// MARK: - Event kind (port of the web `classifySnapshot` precedence ladder)

/// The resolved safety-snapshot kind, in the exact precedence the web
/// `classifySnapshot` applies: AEB activation wins, then an active forward-collision
/// warning, an active lane-departure avoidance, a blind-spot warning, an emergency
/// lane-departure avoidance, and finally the neutral "safety state update" fallback.
/// The FCW/lane cases carry the cleaned enum detail echoed in the title.
public enum SafetyEventKind: Equatable, Sendable {
    case aeb
    case forwardCollision(detail: String)
    case laneDeparture(detail: String)
    case blindSpot
    case emergencyLaneDeparture
    case general
}

// MARK: - Event → visual catalog (port of the web `classifySnapshot` icon/color)

/// Resolves a safety snapshot to its kind + the kind's SF Symbol, exact web dot
/// color, severity, English-fallback title, and stats `type` slug + label — the
/// native port of the web `classifySnapshot` switch + the `typeLabels` map. The dot
/// colors reproduce the exact web hex so the feed reads identically on both apps.
public enum SafetyEventCatalog {
    /// One resolved event presentation (icon + color + severity).
    public struct Visual: Sendable {
        public let systemImage: String
        public let dotColor: Color
        public let severity: SafetySeverity
    }

    // Web hex parity (classifySnapshot `color`).
    private static let red = Color(red: 0.937, green: 0.267, blue: 0.267) // #ef4444
    private static let amber = Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
    private static let blue = Color(red: 0.231, green: 0.510, blue: 0.965) // #3b82f6
    private static let slate = Color(red: 0.420, green: 0.447, blue: 0.502) // #6b7280

    /// The native port of the web `classifySnapshot` precedence ladder.
    public static func derive(from event: SafetyEventInput) -> SafetyEventKind {
        if event.automaticEmergencyBrakingOff == true { return .aeb }
        if SafetyHistoryEnum.isActive(event.forwardCollisionWarning, field: .forwardCollisionWarning) {
            let detail = SafetyHistoryEnum.clean(event.forwardCollisionWarning, field: .forwardCollisionWarning)
            return .forwardCollision(detail: detail)
        }
        if SafetyHistoryEnum.isActive(event.laneDepartureAvoidance, field: .laneDepartureAvoidance) {
            let detail = SafetyHistoryEnum.clean(event.laneDepartureAvoidance, field: .laneDepartureAvoidance)
            return .laneDeparture(detail: detail)
        }
        if event.blindSpotCollisionWarning == true { return .blindSpot }
        if event.emergencyLaneDepartureAvoidance == true { return .emergencyLaneDeparture }
        return .general
    }

    /// The icon + color + severity for a resolved kind (web `classifySnapshot`).
    public static func visual(for kind: SafetyEventKind) -> Visual {
        switch kind {
        case .aeb:
            Visual(systemImage: "exclamationmark.octagon.fill", dotColor: red, severity: .critical)
        case .forwardCollision:
            Visual(systemImage: "exclamationmark.shield.fill", dotColor: amber, severity: .warning)
        case .laneDeparture:
            Visual(systemImage: "road.lanes", dotColor: blue, severity: .warning)
        case .blindSpot:
            Visual(systemImage: "car.fill", dotColor: amber, severity: .warning)
        case .emergencyLaneDeparture:
            Visual(systemImage: "exclamationmark.triangle.fill", dotColor: red, severity: .critical)
        case .general:
            Visual(systemImage: "exclamationmark.octagon.fill", dotColor: slate, severity: .info)
        }
    }

    /// The stats bucket slug for a kind (web `classifySnapshot` `type`).
    public static func typeSlug(for kind: SafetyEventKind) -> String {
        switch kind {
        case .aeb: "aeb"
        case .forwardCollision: "fcw"
        case .laneDeparture: "lane"
        case .blindSpot: "bsw"
        case .emergencyLaneDeparture: "elda"
        case .general: "general"
        }
    }

    /// The localized row title for a resolved kind (web `classifySnapshot` `title`),
    /// including the FCW/lane cleaned-enum echo.
    public static func title(for kind: SafetyEventKind, localize: (String, String) -> String) -> String {
        switch kind {
        case .aeb:
            localize("widget.safetyAebTitle", "AEB Activation")
        case let .forwardCollision(detail):
            String(format: localize("widget.safetyFcwTitle", "FCW: %@"), detail)
        case let .laneDeparture(detail):
            String(format: localize("widget.safetyLaneTitle", "Lane Departure: %@"), detail)
        case .blindSpot:
            localize("widget.safetyBswTitle", "Blind Spot Warning")
        case .emergencyLaneDeparture:
            localize("widget.safetyEldaTitle", "Emergency Lane Departure Avoidance")
        case .general:
            localize("widget.safetyGeneralTitle", "Safety State Update")
        }
    }

    /// The localized "Most Common" label for a stats slug (web `typeLabels`),
    /// falling back to the slug itself (web `typeLabels[type] ?? type`).
    public static func typeLabel(forSlug slug: String, localize: (String, String) -> String) -> String {
        switch slug {
        case "aeb": localize("widget.safetyTypeAeb", "AEB")
        case "fcw": localize("widget.safetyTypeFcw", "FCW")
        case "lane": localize("widget.safetyTypeLane", "Lane Departure")
        case "bsw": localize("widget.safetyTypeBsw", "Blind Spot")
        case "elda": localize("widget.safetyTypeElda", "Emergency Lane")
        case "general": localize("widget.safetyTypeGeneral", "General")
        default: slug
        }
    }

    /// The localized subtitle line (web `buildSubtitle`): the speed-limit warning, the
    /// cruise follow distance (both raw-`String()` echoed), and the PIN-to-drive flag,
    /// each only present when its source field is non-null. `—` when none apply.
    public static func subtitle(for event: SafetyEventInput, localize: (String, String) -> String) -> String {
        var parts: [String] = []
        if !event.speedLimitWarning.isNull {
            let raw = SafetyHistoryEnum.rawString(event.speedLimitWarning)
            parts.append(String(format: localize("widget.safetySpeedLimit", "Speed Limit: %@"), raw))
        }
        if !event.cruiseFollowDistance.isNull {
            let raw = SafetyHistoryEnum.rawString(event.cruiseFollowDistance)
            parts.append(String(format: localize("widget.safetyFollow", "Follow: %@"), raw))
        }
        if let pin = event.pinToDriveEnabled {
            parts.append(pin ? localize("widget.safetyPinToDrive", "PIN to Drive") : "")
        }
        let filtered = parts.filter { !$0.isEmpty }
        return filtered.isEmpty ? "—" : filtered.joined(separator: " · ")
    }
}

// MARK: - Feed item projection (web `feedItems` map)

/// One row in the safety event feed — the native port of the web `EventFeedItem`,
/// carrying the resolved (localized) title/subtitle, the raw `kind` so the view can
/// re-derive icon + color, and the metadata for sorting + VoiceOver.
public struct SafetyFeedItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: SafetyEventKind
    public let title: String
    public let subtitle: String
    public let timestamp: Date
    public let severity: SafetySeverity

    public init(
        id: String,
        kind: SafetyEventKind,
        title: String,
        subtitle: String,
        timestamp: Date,
        severity: SafetySeverity
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.timestamp = timestamp
        self.severity = severity
    }
}

/// Builds the sorted, optionally-capped feed projection from the cached events,
/// resolving each label through the injected localizer (so it's bundle-free in
/// tests). Mirrors the web `list.map(...)` projection + the feed's newest-first sort
/// and `maxItems` slice.
public enum SafetyFeedBuilder {
    public static func build(
        events: [SafetyEventInput],
        limit: Int? = nil,
        localize: (String, String) -> String
    ) -> [SafetyFeedItem] {
        let sorted = events.sorted { $0.displayTimestamp > $1.displayTimestamp }
        let capped = limit.map { Array(sorted.prefix(max(0, $0))) } ?? sorted
        return capped.map { event in
            let kind = SafetyEventCatalog.derive(from: event)
            let visual = SafetyEventCatalog.visual(for: kind)
            return SafetyFeedItem(
                id: event.stableID,
                kind: kind,
                title: SafetyEventCatalog.title(for: kind, localize: localize),
                subtitle: SafetyEventCatalog.subtitle(for: event, localize: localize),
                timestamp: event.displayTimestamp,
                severity: visual.severity
            )
        }
    }
}
