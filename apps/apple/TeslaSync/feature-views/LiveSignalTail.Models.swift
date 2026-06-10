//
//  LiveSignalTail.Models.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  Foundation-only value types for the live SSE signal tail — the SwiftUI parity
//  of web/src/features/telemetry/components/LiveSignalTail.tsx.
//
//  These mirror the web data contract. The web `SignalEntry` is already a
//  display-ready record — `{ id, timestamp, name, value: string, type }` — so
//  unlike the LiveSignalsTable inspector there is no value-coercion step: the
//  value arrives pre-stringified and the kind discriminator drives the per-type
//  tint + badge tone. `LiveSignalTailFreshness` and `LiveSignalTailAge` model the
//  buckets the shared web `<FreshnessIndicator>` derives from a timestamp.
//
//  Everything here is pure + `Sendable` so `LiveSignalTail.Adapter.swift` can be
//  exercised by an executed host harness and the XCTest suite without SwiftUI.
//

import Foundation

// MARK: - Value kind (web `SignalEntry.type`)

/// The decoded value kind shipped with every entry — the web
/// `type: 'number' | 'string' | 'boolean'`. Drives both the value-column tint
/// (web `TYPE_VALUE_COLOR`) and the type `Badge` tone, which use the same hue per
/// kind: number → info/cyan, string → success/green, boolean → warning/amber.
public enum LiveSignalTailValueKind: String, Sendable, Equatable, CaseIterable {
    case number
    case string
    case boolean
}

// MARK: - Entry (web `SignalEntry`, normalized for display)

/// One signal event in the tail — the Swift port of the web `SignalEntry`. The
/// `value` is already a display string (the web does not coerce it), `kind`
/// carries the discriminator, and `timestamp` is the parsed form of `timestampRaw`
/// kept alongside the raw ISO string so the freshness cell can bucket it. `id` is
/// the web numeric id (the `keyExtractor`), unique within the buffer.
public struct SignalTailEntry: Identifiable, Sendable, Equatable {
    public let id: Int
    public let name: String
    public let value: String
    public let kind: LiveSignalTailValueKind
    public let timestampRaw: String
    public let timestamp: Date?

    public init(
        id: Int,
        name: String,
        value: String,
        kind: LiveSignalTailValueKind,
        timestampRaw: String,
        timestamp: Date?
    ) {
        self.id = id
        self.name = name
        self.value = value
        self.kind = kind
        self.timestampRaw = timestampRaw
        self.timestamp = timestamp
    }
}

// MARK: - Freshness (web `<FreshnessIndicator>` status)

/// Freshness bucket for a single datum, mirroring the shared web
/// `FreshnessIndicator` `getStatus`: `fresh` (age < staleThreshold),
/// `stale` (age < offlineThreshold), `offline` (older), `unknown` (no timestamp).
public enum LiveSignalTailFreshness: String, Sendable, Equatable {
    case fresh
    case stale
    case offline
    case unknown
}

/// The web `<FreshnessIndicator>` thresholds (seconds). Defaults match the shared
/// component: stale at 120 s, offline at 600 s.
public struct LiveSignalTailFreshnessThresholds: Sendable, Equatable {
    public let stale: Int
    public let offline: Int

    public init(stale: Int = 120, offline: Int = 600) {
        self.stale = stale
        self.offline = offline
    }

    public static let `default` = LiveSignalTailFreshnessThresholds()
}

// MARK: - Age bucket (web `formatAge`)

/// The relative-age bucket the web `formatAge` collapses an age into. Keeping it
/// structured (rather than a pre-formatted string) lets the pure adapter be
/// asserted on the exact threshold semantics while the localization layer owns the
/// final string — so the view holds no hardcoded English age copy.
public enum LiveSignalTailAge: Sendable, Equatable {
    /// No timestamp — the web `'—'`.
    case none
    /// age < 10 s — the web `'just now'`.
    case justNow
    /// 10 ≤ age < 60 — the web `${age}s ago`.
    case seconds(Int)
    /// 60 ≤ age < 3600 — the web `${floor(age/60)}m ago`.
    case minutes(Int)
    /// age ≥ 3600 — the web `${floor(age/3600)}h ago`.
    case hours(Int)
}

// MARK: - Stats (web stat cards)

/// The four header stats (web `StatCard`s): the live rate, the buffer fill, the
/// unique-signal count, and the filtered-row count. `bufferUsed`/`unique` are
/// computed from the full buffer (web `entries`), `filtered` from the filtered set.
public struct LiveSignalTailStats: Sendable, Equatable {
    public let rate: Int
    public let bufferUsed: Int
    public let bufferMax: Int
    public let unique: Int
    public let filtered: Int

    public init(rate: Int, bufferUsed: Int, bufferMax: Int, unique: Int, filtered: Int) {
        self.rate = rate
        self.bufferUsed = bufferUsed
        self.bufferMax = bufferMax
        self.unique = unique
        self.filtered = filtered
    }
}

// MARK: - Projection

/// The normalized buffer projected from a snapshot: the entries in stream order
/// (newest first, as the web prepends them) plus the unique-signal count derived
/// from the full buffer. The model applies the live name filter on top for display,
/// mirroring the web `entries` → `filtered` `useMemo`.
public struct LiveSignalTailProjection: Sendable, Equatable {
    public let entries: [SignalTailEntry]
    public let uniqueSignals: Int

    public init(entries: [SignalTailEntry], uniqueSignals: Int) {
        self.entries = entries
        self.uniqueSignals = uniqueSignals
    }

    /// Whether the buffer holds any event (web `entries.length === 0`).
    public var hasData: Bool {
        !entries.isEmpty
    }

    /// An empty buffer (no SSE event received yet).
    public static let empty = LiveSignalTailProjection(entries: [], uniqueSignals: 0)
}

// MARK: - Accessibility row speech (VoiceOver inputs)

/// The display fields one tail row exposes to VoiceOver — every web column: the
/// clock, signal name, value, kind, relative age, and freshness. Bundled so the
/// pure `LiveSignalTailAccessibility.rowLabel` builder stays a single argument.
public struct LiveSignalTailRowSpeech: Sendable, Equatable {
    public let time: String
    public let name: String
    public let value: String
    public let kind: LiveSignalTailValueKind
    public let age: String
    public let freshness: LiveSignalTailFreshness

    public init(
        time: String,
        name: String,
        value: String,
        kind: LiveSignalTailValueKind,
        age: String,
        freshness: LiveSignalTailFreshness
    ) {
        self.time = time
        self.name = name
        self.value = value
        self.kind = kind
        self.age = age
        self.freshness = freshness
    }
}
