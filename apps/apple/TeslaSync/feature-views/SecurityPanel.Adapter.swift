//
//  SecurityPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  The pure cached → panel projection (no SwiftUI, no networking) for the
//  SecurityPanel surface — the native port of
//  features/vehicles/components/telemetry-panels/SecurityPanel.tsx. The web
//  component is presentational: it reads the cached `SecurityEvent`
//  (`securityData`) plus the separate `remoteStartEnabled` flag and renders a
//  lock badge, a sentry chip, the door / window / user-present rows, an optional
//  detail line, and the always-present Remote Start row. This file reproduces
//  every one of those render branches — including the web optional-chaining
//  fallbacks (`?? Closed`, `locked ?` → Unlocked) and the `remoteStartEnabled ==
//  null ? '—'` ternary — over value types so each row's value, tone, icon, and
//  VoiceOver summary match the web exactly. Unit tested branch-by-branch.
//

import Foundation

// MARK: - Event (web `SecurityEvent` subset the panel reads)

/// The cached security event the panel renders (web `securityData: SecurityEvent`).
/// Only the fields the web panel reads are modeled: `locked` / `sentry_mode` /
/// `user_present` are `boolean | null`; `doors_open` / `windows_open` are the
/// aggregate `string | null` summary columns the panel shows verbatim; `detail`
/// is the optional `string | null` note rendered in italics.
public struct SecurityPanelEvent: Sendable, Equatable {
    public var locked: Bool?
    public var sentryMode: Bool?
    public var doorsOpen: String?
    public var windowsOpen: String?
    public var userPresent: Bool?
    public var detail: String?

    public init(
        locked: Bool? = nil,
        sentryMode: Bool? = nil,
        doorsOpen: String? = nil,
        windowsOpen: String? = nil,
        userPresent: Bool? = nil,
        detail: String? = nil
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorsOpen = doorsOpen
        self.windowsOpen = windowsOpen
        self.userPresent = userPresent
        self.detail = detail
    }
}

// MARK: - Panel data (web props `securityData` + `remoteStartEnabled`)

/// The two cached inputs the web panel takes as props. Bundled so the state
/// holder can push a single coalesced snapshot.
public struct SecurityPanelData: Sendable, Equatable {
    public var event: SecurityPanelEvent?
    public var remoteStartEnabled: Bool?

    public init(event: SecurityPanelEvent? = nil, remoteStartEnabled: Bool? = nil) {
        self.event = event
        self.remoteStartEnabled = remoteStartEnabled
    }

    /// Web `hasData = securityData != null || remoteStartEnabled != null`: the
    /// panel shows its rows when either input is present, otherwise the empty state.
    public var hasContent: Bool {
        event != nil || remoteStartEnabled != nil
    }
}

// MARK: - Tone (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic color role for a value. Kept free of SwiftUI so the projection
/// stays pure and testable; `SecurityPanel.Views` maps each case to a `Color.TS`
/// design token. `.primary` is the web `text-primary` mono value color; `.neutral`
/// is the web `text-muted`.
public enum SecurityPanelTone: Sendable, Equatable {
    case success
    case warning
    case danger
    case neutral
    case primary
}

// MARK: - Row kind (how the value renders — web style branches)

/// How a row's value renders, matching the three distinct web value styles: the
/// sentry pill (`chip`), the monospaced door / window value (`mono`), and the
/// colored user-present / remote-start text (`status`).
public enum SecurityPanelRowKind: Sendable, Equatable {
    case chip
    case mono
    case status
}

// MARK: - Lock badge (web tinted lock box)

/// The lock-status badge (web tinted box + icon + Locked/Unlocked + subtitle).
/// Strings are already localized; `accessibilityLabel` is the composed VoiceOver
/// summary; `tone` is mapped to a design-token color at the view layer.
public struct SecurityPanelLockModel: Sendable, Equatable {
    public let locked: Bool
    public let value: String
    public let subtitle: String
    public let systemImage: String
    public let tone: SecurityPanelTone
    public let accessibilityLabel: String

    public init(
        locked: Bool,
        value: String,
        subtitle: String,
        systemImage: String,
        tone: SecurityPanelTone,
        accessibilityLabel: String
    ) {
        self.locked = locked
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.tone = tone
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Row (web label / value rows)

/// One label → value row (web `flex items-center justify-between`). `labelSystemImage`
/// is the leading label glyph (nil for the Windows row, which has none in the web);
/// `valueSystemImage` is the chip's inner glyph (the web `ShieldAlert` inside the
/// sentry pill). Strings are localized; `accessibilityLabel` is the VoiceOver summary.
public struct SecurityPanelRowModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let labelSystemImage: String?
    public let value: String
    public let valueSystemImage: String?
    public let tone: SecurityPanelTone
    public let kind: SecurityPanelRowKind
    public let accessibilityLabel: String

    public init(
        id: String,
        label: String,
        labelSystemImage: String?,
        value: String,
        valueSystemImage: String? = nil,
        tone: SecurityPanelTone,
        kind: SecurityPanelRowKind,
        accessibilityLabel: String
    ) {
        self.id = id
        self.label = label
        self.labelSystemImage = labelSystemImage
        self.value = value
        self.valueSystemImage = valueSystemImage
        self.tone = tone
        self.kind = kind
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Content model (web `hasData` branch projection)

/// The projected panel content (web `hasData` branch). `lock` and `eventRows` are
/// present only when a `securityData` event exists (web `{securityData && …}`);
/// `detail` is the optional italic note; `remoteStart` is always rendered in the
/// content branch (web renders the Remote Start row outside the `securityData` guard).
public struct SecurityPanelContentModel: Sendable, Equatable {
    public let lock: SecurityPanelLockModel?
    public let eventRows: [SecurityPanelRowModel]
    public let detail: String?
    public let remoteStart: SecurityPanelRowModel

    public init(
        lock: SecurityPanelLockModel?,
        eventRows: [SecurityPanelRowModel],
        detail: String?,
        remoteStart: SecurityPanelRowModel
    ) {
        self.lock = lock
        self.eventRows = eventRows
        self.detail = detail
        self.remoteStart = remoteStart
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection (web em-dash).
public enum SecurityPanelFormat {
    /// The em-dash shown when remote-start access is unknown (web `'—'`).
    public static let dash = "—"
}

// MARK: - Projection (web render branches → the content model)

/// Projects the cached panel data into the localized content model. An absent
/// event reproduces the web's `{securityData && …}` guard (no lock / no event rows),
/// while the Remote Start row is always built from `remoteStartEnabled` exactly like
/// the web ternary. `localize` is the P1/S10 `t(key, fallback)` facade; passing an
/// echo (returns the fallback) yields the web English copy.
public enum SecurityPanelProjection {
    public static func content(
        data: SecurityPanelData?,
        localize: (String, String) -> String
    ) -> SecurityPanelContentModel {
        let event = data?.event
        return SecurityPanelContentModel(
            lock: event.map { lockModel($0, localize) },
            eventRows: event.map { eventRows($0, localize) } ?? [],
            detail: detailText(event),
            remoteStart: remoteStartRow(data?.remoteStartEnabled, localize)
        )
    }

    // MARK: Lock badge (web `securityData.locked ? Locked : Unlocked`)

    private static func lockModel(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> SecurityPanelLockModel {
        let locked = event.locked ?? false
        let value = locked
            ? localize("common.locked", "Locked")
            : localize("common.unlocked", "Unlocked")
        let subtitle = localize("telemetry.lockStatus", "Vehicle lock status")
        return SecurityPanelLockModel(
            locked: locked,
            value: value,
            subtitle: subtitle,
            systemImage: locked ? "lock.fill" : "lock.open.fill",
            tone: locked ? .success : .warning,
            accessibilityLabel: "\(value). \(subtitle)"
        )
    }

    // MARK: Event rows (sentry / doors / windows / user present)

    private static func eventRows(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> [SecurityPanelRowModel] {
        [
            sentryRow(event, localize),
            doorsRow(event, localize),
            windowsRow(event, localize),
            userPresentRow(event, localize)
        ]
    }

    /// Web sentry chip: `securityData.sentry_mode ? Active : Inactive`, danger pill
    /// when active else a muted pill, with the `ShieldAlert` glyph inside.
    private static func sentryRow(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> SecurityPanelRowModel {
        let active = event.sentryMode ?? false
        let label = localize("telemetry.sentryMode", "Sentry Mode")
        let value = active
            ? localize("common.active", "Active")
            : localize("common.inactive", "Inactive")
        return SecurityPanelRowModel(
            id: "sentry",
            label: label,
            labelSystemImage: "eye",
            value: value,
            valueSystemImage: "exclamationmark.shield.fill",
            tone: active ? .danger : .neutral,
            kind: .chip,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    /// Web doors row: `securityData.doors_open ?? 'Closed'`, shown as a mono value.
    private static func doorsRow(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> SecurityPanelRowModel {
        let label = localize("telemetry.doors", "Doors")
        // Web `securityData.doors_open ?? 'Closed'` — nullish, so only a nil value
        // falls back; a non-nil string (even empty) is shown verbatim.
        let value = event.doorsOpen ?? localize("common.closed", "Closed")
        return SecurityPanelRowModel(
            id: "doors",
            label: label,
            labelSystemImage: "door.left.hand.closed",
            value: value,
            tone: .primary,
            kind: .mono,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    /// Web windows row: `securityData.windows_open ?? 'Closed'`, mono value, no glyph.
    private static func windowsRow(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> SecurityPanelRowModel {
        let label = localize("telemetry.windows", "Windows")
        // Web `securityData.windows_open ?? 'Closed'` — nullish (see doors row).
        let value = event.windowsOpen ?? localize("common.closed", "Closed")
        return SecurityPanelRowModel(
            id: "windows",
            label: label,
            labelSystemImage: nil,
            value: value,
            tone: .primary,
            kind: .mono,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    /// Web user-present row: `securityData.user_present ? Yes : No`, success when
    /// present else muted.
    private static func userPresentRow(
        _ event: SecurityPanelEvent,
        _ localize: (String, String) -> String
    ) -> SecurityPanelRowModel {
        let present = event.userPresent ?? false
        let label = localize("telemetry.userPresent", "User Present")
        let value = present
            ? localize("common.yes", "Yes")
            : localize("common.no", "No")
        return SecurityPanelRowModel(
            id: "userPresent",
            label: label,
            labelSystemImage: "person.fill",
            value: value,
            tone: present ? .success : .neutral,
            kind: .status,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    /// Web Remote Start row: `remoteStartEnabled == null ? '—' : enabled ? Enabled :
    /// Disabled`, success only when explicitly enabled (null and false are muted).
    private static func remoteStartRow(
        _ enabled: Bool?,
        _ localize: (String, String) -> String
    ) -> SecurityPanelRowModel {
        let label = localize("telemetry.remoteStart", "Remote Start")
        let value: String
        let tone: SecurityPanelTone
        switch enabled {
        case .none:
            value = SecurityPanelFormat.dash
            tone = .neutral
        case .some(true):
            value = localize("common.enabled", "Enabled")
            tone = .success
        case .some(false):
            value = localize("common.disabled", "Disabled")
            tone = .neutral
        }
        return SecurityPanelRowModel(
            id: "remoteStart",
            label: label,
            labelSystemImage: "key.fill",
            value: value,
            tone: tone,
            kind: .status,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Detail (web `securityData.detail && …`)

    /// Web `{securityData.detail && <div italic>{detail}</div>}`: the note when it
    /// is a non-empty string, else nil so the line is omitted.
    private static func detailText(_ event: SecurityPanelEvent?) -> String? {
        nonEmpty(event?.detail)
    }

    /// The string when it is non-empty, else nil (web truthiness on `string | null`).
    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }
}
