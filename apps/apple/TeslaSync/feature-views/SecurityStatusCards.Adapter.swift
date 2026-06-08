//
//  SecurityStatusCards.Adapter.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  The pure cached → card-grid projection (no SwiftUI, no networking) for the
//  Security Status Cards surface — the native port of
//  features/admin/components/security-access/SecurityStatusCards.tsx and its
//  ./helpers.ts (`doorClosed`, `parseWindowState`, `allWindowsClosed`,
//  `windowSummary`). The web type-narrows raw `signal.SignalValue` (`string |
//  boolean | null`) with `typeof` / `asNonEmptyString`; this file reproduces that
//  narrowing over `SecurityCardsSignalValue` so each card's icon, value, tone, and
//  VoiceOver summary match the web exactly. Unit tested branch-by-branch.
//

import Foundation

// MARK: - Signal value (web `string | boolean | null`)

/// One security signal as the API delivers it. The backend serializes raw
/// `signal.SignalValue` (`interface{}`), so a single field can arrive as a native
/// boolean OR a string enum (web `string | boolean | null`). The projection
/// type-narrows over these cases exactly like the web `typeof` / `asNonEmptyString`
/// checks.
public enum SecurityCardsSignalValue: Sendable, Equatable {
    case boolean(Bool)
    case text(String)
    case absent

    /// JavaScript truthiness (web `value ?`): a `true` boolean or a non-empty
    /// string is truthy; `false`, the empty string, and absent are falsy.
    public var isTruthy: Bool {
        switch self {
        case let .boolean(flag): flag
        case let .text(raw): !raw.isEmpty
        case .absent: false
        }
    }
}

// MARK: - Latest event (web `SecurityEvent` subset the grid reads)

/// The cached "latest security event" the grid renders (web `SecurityEvent`). Only
/// the fields the six cards read are modeled. `locked` / `homelinkNearby` /
/// `guestMode` are `boolean | null` in the web type; `sentryMode` / `doorState` /
/// the four window fields carry the raw `string | boolean | null` union so the
/// projection can reproduce the web parsing rather than trusting a pre-coalesced
/// flag.
public struct SecurityCardsLatest: Sendable, Equatable {
    public var locked: Bool?
    public var sentryMode: SecurityCardsSignalValue
    public var doorState: SecurityCardsSignalValue
    public var frontDriverWindow: SecurityCardsSignalValue
    public var frontPassengerWindow: SecurityCardsSignalValue
    public var rearDriverWindow: SecurityCardsSignalValue
    public var rearPassengerWindow: SecurityCardsSignalValue
    public var homelinkNearby: Bool?
    public var guestMode: Bool?
    public var createdAt: Date?

    public init(
        locked: Bool? = nil,
        sentryMode: SecurityCardsSignalValue = .absent,
        doorState: SecurityCardsSignalValue = .absent,
        frontDriverWindow: SecurityCardsSignalValue = .absent,
        frontPassengerWindow: SecurityCardsSignalValue = .absent,
        rearDriverWindow: SecurityCardsSignalValue = .absent,
        rearPassengerWindow: SecurityCardsSignalValue = .absent,
        homelinkNearby: Bool? = nil,
        guestMode: Bool? = nil,
        createdAt: Date? = nil
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
        self.homelinkNearby = homelinkNearby
        self.guestMode = guestMode
        self.createdAt = createdAt
    }

    /// The four window fields in web order (fd, fp, rd, rp) — the order the web
    /// `windows` array is built in, kept stable for the open-window count.
    public var windows: [SecurityCardsSignalValue] {
        [frontDriverWindow, frontPassengerWindow, rearDriverWindow, rearPassengerWindow]
    }
}

// MARK: - Window state (web `WindowState`)

/// The parsed window position (web `WindowState`).
public enum SecurityCardsWindowState: Sendable, Equatable {
    case closed
    case venting
    case open
    case unknown
}

// MARK: - Tone (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic color role for a card's icon + value. Kept free of SwiftUI so the
/// projection stays pure and testable; `SecurityStatusCards.Views` maps each case
/// to a `Color.TS` design token. `.homelink` carries the web purple accent.
public enum SecurityCardsTone: Sendable, Equatable {
    case success
    case danger
    case info
    case warning
    case neutral
    case homelink
}

// MARK: - Card view-model (one of the six grid cells)

/// One resolved grid card (web `GlassPanel` cell). Strings are already localized;
/// `accessibilityLabel` is the composed VoiceOver summary; `tone` is mapped to a
/// design-token color at the view layer.
public struct SecurityCardViewModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let value: String
    public let detail: String
    public let systemImage: String
    public let tone: SecurityCardsTone
    public let accessibilityLabel: String

    public init(
        id: String,
        title: String,
        value: String,
        detail: String,
        systemImage: String,
        tone: SecurityCardsTone,
        accessibilityLabel: String
    ) {
        self.id = id
        self.title = title
        self.value = value
        self.detail = detail
        self.systemImage = systemImage
        self.tone = tone
        self.accessibilityLabel = accessibilityLabel
    }
}

public extension SecurityCardViewModel {
    /// Builds a card with the composed VoiceOver summary (`title: value. detail`).
    init(id: String, title: String, value: String, detail: String, systemImage: String, tone: SecurityCardsTone) {
        self.init(
            id: id,
            title: title,
            value: value,
            detail: detail,
            systemImage: systemImage,
            tone: tone,
            accessibilityLabel: "\(title): \(value). \(detail)"
        )
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection (web em-dash).
public enum SecurityCardsFormat {
    /// The em-dash shown when a value is unknown (web `'—'`).
    public static let dash = "—"
}

// MARK: - Parsing logic (port of ./helpers.ts)

/// The pure parsing helpers ported from the web `./helpers.ts`. Each function
/// mirrors its web counterpart's branches so the cards render identically.
public enum SecurityCardsLogic {
    /// Web `asNonEmptyString`: the string when it is non-empty (`length > 0`,
    /// untrimmed), else `nil`. Booleans / absent are never strings.
    public static func asNonEmptyString(_ value: SecurityCardsSignalValue) -> String? {
        switch value {
        case let .text(raw): raw.isEmpty ? nil : raw
        case .boolean, .absent: nil
        }
    }

    /// Web `doorClosed`: absent / `false` boolean / the closed-like string set /
    /// an all-falsy JSON object → closed; anything else → open.
    public static func doorClosed(_ value: SecurityCardsSignalValue) -> Bool {
        switch value {
        case .absent:
            return true
        case let .boolean(flag):
            return !flag
        case let .text(raw):
            let lower = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if lower.isEmpty || lower == "closed" || lower == "closedall" || lower == "0" || lower == "false" {
                return true
            }
            if lower.hasPrefix("{") {
                return jsonObjectAllFalsy(raw)
            }
            return false
        }
    }

    /// Web `parseWindowState`: `closed`/`0` → Closed, contains `vent` → Venting,
    /// any other non-empty value → Open, absent → Unknown.
    public static func parseWindowState(_ value: SecurityCardsSignalValue) -> SecurityCardsWindowState {
        guard let raw = asNonEmptyString(value) else { return .unknown }
        let lower = raw.lowercased()
        if lower == "closed" || lower == "0" { return .closed }
        if lower.contains("vent") { return .venting }
        if lower.contains("open") || lower != "0" { return .open }
        return .unknown
    }

    /// Web `allWindowsClosed`: every window parses to Closed (an absent event is
    /// treated as all-closed).
    public static func allWindowsClosed(_ windows: [SecurityCardsSignalValue]) -> Bool {
        windows.map(parseWindowState).allSatisfy { $0 == .closed }
    }

    /// The number of windows not in the Closed state (web `windowSummary` count).
    public static func openWindowCount(_ windows: [SecurityCardsSignalValue]) -> Int {
        windows.map(parseWindowState).count(where: { $0 != .closed })
    }

    /// Web `JSON.parse(raw)` + `Object.values(...).every(v => v === false || v == null)`.
    /// Only real JSON booleans (`CFBoolean`) and `null` count as falsy; numbers /
    /// strings / `true` make the object non-falsy. A parse failure → not closed.
    private static func jsonObjectAllFalsy(_ raw: String) -> Bool {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return false
        }
        return object.values.allSatisfy { value in
            if value is NSNull { return true }
            if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
                return !number.boolValue
            }
            return false
        }
    }
}

// MARK: - Projection (web render branches → the six cards)

/// Projects the cached latest event into the six localized cards. An absent event
/// (`latest == nil`) reproduces the web's optional-chaining fallbacks (Unlocked /
/// Inactive / Closed / — / Away / Disabled), so the grid never renders blank.
public enum SecurityCardsProjection {
    /// Builds the ordered card grid. `localize` is the P1/S10 `t(key, fallback)`
    /// facade; passing an echo (returns the fallback) yields the web English copy.
    public static func cards(
        latest: SecurityCardsLatest?,
        localize: (String, String) -> String
    ) -> [SecurityCardViewModel] {
        [
            lockCard(latest, localize),
            sentryCard(latest, localize),
            doorsCard(latest, localize),
            windowsCard(latest, localize),
            homelinkCard(latest, localize),
            guestCard(latest, localize)
        ]
    }

    private static func lockCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let locked = latest?.locked ?? false
        return SecurityCardViewModel(
            id: "lock",
            title: localize("admin.security.card.lockStatus", "Lock Status"),
            value: locked
                ? localize("admin.security.locked", "Locked")
                : localize("admin.security.unlocked", "Unlocked"),
            detail: localize("admin.security.card.lockDesc", "Vehicle lock state"),
            systemImage: locked ? "lock.fill" : "lock.open.fill",
            tone: locked ? .success : .danger
        )
    }

    private static func sentryCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let active = (latest?.sentryMode ?? .absent).isTruthy
        return SecurityCardViewModel(
            id: "sentry",
            title: localize("admin.security.card.sentryMode", "Sentry Mode"),
            value: active
                ? localize("admin.security.active", "Active")
                : localize("admin.security.inactive", "Inactive"),
            detail: localize("admin.security.card.sentryDesc", "Camera surveillance system"),
            systemImage: active ? "checkmark.shield.fill" : "exclamationmark.shield.fill",
            tone: active ? .info : .neutral
        )
    }

    private static func doorsCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let door = latest?.doorState ?? .absent
        let closed = SecurityCardsLogic.doorClosed(door)
        let value = closed
            ? localize("admin.security.closed", "Closed")
            : (SecurityCardsLogic.asNonEmptyString(door) ?? localize("admin.security.open", "Open"))
        return SecurityCardViewModel(
            id: "doors",
            title: localize("admin.security.card.doors", "Doors"),
            value: value,
            detail: localize("admin.security.card.doorsDesc", "All vehicle doors"),
            systemImage: closed ? "door.left.hand.closed" : "door.left.hand.open",
            tone: closed ? .success : .warning
        )
    }

    private static func windowsCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let value: String
        let allClosed: Bool
        if let latest {
            let windows = latest.windows
            allClosed = SecurityCardsLogic.allWindowsClosed(windows)
            if allClosed {
                value = localize("admin.security.windows.allClosed", "All Closed")
            } else {
                let template = localize("admin.security.windows.openVenting", "%lld Open/Venting")
                value = String(format: template, SecurityCardsLogic.openWindowCount(windows))
            }
        } else {
            // Web `windowSummary(undefined)` → '—', `allWindowsClosed(undefined)` → true.
            allClosed = true
            value = SecurityCardsFormat.dash
        }
        return SecurityCardViewModel(
            id: "windows",
            title: localize("admin.security.card.windows", "Windows"),
            value: value,
            detail: localize("admin.security.card.windowsDesc", "Window positions"),
            systemImage: "rectangle.split.2x1",
            tone: allClosed ? .success : .warning
        )
    }

    private static func homelinkCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let nearby = latest?.homelinkNearby ?? false
        return SecurityCardViewModel(
            id: "homelink",
            title: localize("admin.security.card.homelink", "HomeLink"),
            value: nearby
                ? localize("admin.security.nearby", "Nearby")
                : localize("admin.security.away", "Away"),
            detail: localize("admin.security.card.homelinkDesc", "Garage door opener"),
            systemImage: "house.fill",
            tone: nearby ? .homelink : .neutral
        )
    }

    private static func guestCard(
        _ latest: SecurityCardsLatest?,
        _ localize: (String, String) -> String
    ) -> SecurityCardViewModel {
        let guest = latest?.guestMode ?? false
        return SecurityCardViewModel(
            id: "guest",
            title: localize("admin.security.card.guestMode", "Guest Mode"),
            value: guest
                ? localize("admin.security.enabled", "Enabled")
                : localize("admin.security.disabled", "Disabled"),
            detail: localize("admin.security.card.guestDesc", "Temporary access mode"),
            systemImage: "person.fill.checkmark",
            tone: guest ? .warning : .neutral
        )
    }
}
