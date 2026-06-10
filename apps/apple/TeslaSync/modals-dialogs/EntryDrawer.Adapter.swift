//
//  EntryDrawer.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The testable, dependency-free projection core for the DLQ-inspector entry drawer — the
//  faithful port of features/admin/components/dlq-inspector/EntryDrawer.tsx and the
//  `DLQEntrySummary` / `DLQEntryFull` wire types (web/src/types/admin-diagnostics.ts) it binds
//  to. Everything here is pure Foundation so the enums, the base64 → UTF-8 decode, the grouped
//  integer formatter, the summary key/value rows, the payload-viewer + copy-text resolution, the
//  replay-enablement rule, and the drawer body phase are all unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • `DLQEntrySummary`              → `EntryDrawerSummary` (all summary columns).
//    • `DLQEntryFull`                 → `EntryDrawerFull` (summary + the two base64 blobs).
//    • `decodeBase64Utf8(b64)`        → `EntryDrawerPayloadDecoder.decodeUTF8` (strict UTF-8; an
//      invalid base64 / non-UTF-8 body resolves to "" exactly like the web `try/catch`).
//    • `fmtInt(parsed_redeliveries)`  → `EntryDrawerIntFormatter.grouped` (locale separators).
//    • `head = full ?? summary`       → `EntryDrawerProjection.rows` (KVList parity, em-dash
//      fallbacks, `TimeStamp absolute` via the injected date facade).
//    • the `<pre>` body + CopyButton   → `EntryDrawerProjection.displayText` / `.copyText` (the
//      binary fallback message with the byte size; copy falls back to the raw base64).
//    • `replayDisabled`               → `EntryDrawerProjection.replayDisabled` (the four gates).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum EntryDrawerSurface {
    public static let slug = "EntryDrawer"
}

// MARK: - Tabs (web `TabItem[]`)

/// The two payload tabs the drawer exposes (web `'inner' | 'raw'`). The label resolves through the
/// injected P1/S10 localizer so the view holds no hardcoded English.
public enum EntryDrawerTab: String, Sendable, Equatable, Hashable, CaseIterable, Identifiable {
    case inner
    case raw

    public var id: String {
        rawValue
    }

    /// The per-tab i18n key (web `admin.dlq.drawer.tabs.<raw>`).
    public var labelKey: String {
        "admin.dlq.drawer.tabs.\(rawValue)"
    }

    /// The web English fallback label.
    public var labelFallback: String {
        switch self {
        case .inner: "Inner payload"
        case .raw: "Raw envelope"
        }
    }
}

// MARK: - Load status / freshness

/// The bound source's load status for the FULL entry fetch (web `useDLQEntry(id)` `isLoading` /
/// resolved / failure). The summary row is already in cache before the drawer opens.
public enum EntryDrawerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a cached
/// entry is clearly labeled while reconnecting / offline.
public enum EntryDrawerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Wire types (web `DLQEntrySummary` / `DLQEntryFull`)

/// One DLQ summary row — the native parity of `DLQEntrySummary`. The heavy payload blobs are
/// intentionally absent (the list endpoint omits them); `EntryDrawerFull` carries them. Nullable
/// columns stay optional so the view picks the em-dash fallback explicitly (web `?? '—'`).
public struct EntryDrawerSummary: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let arrivedAt: Date
    public let dlqTopic: String
    public let parsedReason: String
    public let parsedVehicleID: Int64?
    public let parsedVIN: String?
    public let parsedSourceTopic: String?
    public let parsedRedeliveries: Int?
    public let parsedTimestamp: Date?
    public let parseError: String?
    public let replayable: Bool
    public let rawPayloadSize: Int
    public let innerPayloadSize: Int

    public init(
        id: Int64,
        arrivedAt: Date,
        dlqTopic: String,
        parsedReason: String,
        parsedVehicleID: Int64? = nil,
        parsedVIN: String? = nil,
        parsedSourceTopic: String? = nil,
        parsedRedeliveries: Int? = nil,
        parsedTimestamp: Date? = nil,
        parseError: String? = nil,
        replayable: Bool,
        rawPayloadSize: Int,
        innerPayloadSize: Int
    ) {
        self.id = id
        self.arrivedAt = arrivedAt
        self.dlqTopic = dlqTopic
        self.parsedReason = parsedReason
        self.parsedVehicleID = parsedVehicleID
        self.parsedVIN = parsedVIN
        self.parsedSourceTopic = parsedSourceTopic
        self.parsedRedeliveries = parsedRedeliveries
        self.parsedTimestamp = parsedTimestamp
        self.parseError = parseError
        self.replayable = replayable
        self.rawPayloadSize = rawPayloadSize
        self.innerPayloadSize = innerPayloadSize
    }
}

/// The full DLQ row — the native parity of `DLQEntryFull` (`DLQEntrySummary` plus the two payload
/// blobs as base64 strings). The drawer's payload viewer + copy affordance read these.
public struct EntryDrawerFull: Sendable, Equatable, Identifiable {
    public let summary: EntryDrawerSummary
    public let rawPayloadBase64: String
    public let innerPayloadBase64: String

    public var id: Int64 {
        summary.id
    }

    public init(summary: EntryDrawerSummary, rawPayloadBase64: String, innerPayloadBase64: String) {
        self.summary = summary
        self.rawPayloadBase64 = rawPayloadBase64
        self.innerPayloadBase64 = innerPayloadBase64
    }
}

// MARK: - Base64 → UTF-8 decode (port of web `decodeBase64Utf8`)

/// Decodes a base64 string to its UTF-8 text when possible, else returns "" — the faithful port
/// of the web `decodeBase64Utf8`. An empty input, malformed base64, or a non-UTF-8 (binary
/// protobuf) body all resolve to "" so the drawer never crashes on an opaque payload.
public enum EntryDrawerPayloadDecoder {
    public static func decodeUTF8(_ base64: String) -> String {
        guard !base64.isEmpty else { return "" }
        guard let data = Data(base64Encoded: base64) else { return "" }
        // `String(data:encoding:.utf8)` is strict — invalid UTF-8 sequences return nil, matching
        // the web `TextDecoder('utf-8', { fatal: true })` catch arm.
        guard let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }
}

// MARK: - Grouped integer formatter (port of web `fmtInt`)

/// Locale-grouped integer rendering — the parity of the web `fmtInt` (`fmtNumber(v, 0)`), used by
/// the "Redeliveries" row. Defaults to the web global locale (`en-US`, grouped as `12,345`); the
/// production app injects the user's settings locale. A nil value is the caller's concern (the web
/// renders `—` before ever calling `fmtInt`).
public enum EntryDrawerIntFormatter {
    public static func grouped(_ value: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        formatter.locale = Locale(identifier: localeIdentifier)
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - Summary key/value rows (web KVList)

/// One summary row in the drawer's KVList. `monospace` mirrors the web `font-mono` columns; `muted`
/// mirrors the de-emphasized parse-error row (`text-[var(--text-muted)]`).
public struct EntryDrawerKVRow: Sendable, Equatable, Identifiable {
    public let key: String
    public let label: String
    public let value: String
    public let monospace: Bool
    public let muted: Bool

    public var id: String {
        key
    }

    public init(key: String, label: String, value: String, monospace: Bool = false, muted: Bool = false) {
        self.key = key
        self.label = label
        self.value = value
        self.monospace = monospace
        self.muted = muted
    }
}

// MARK: - Body phase

/// What the drawer body renders once the load + entry resolve. The web shows the spinner while
/// `loading && !full`, then the panels when `head` exists, else `null`; the empty + error envelopes
/// are added so an intentionally-presented modal is never a blank box.
public enum EntryDrawerPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source to the rendered rows, payload text, body
/// phase, and the replay-enablement rule.
public enum EntryDrawerProjection {
    /// The drawer title (web `head ? 'DLQ entry #{{id}}' : 'DLQ entry'`).
    public static func title(
        hasHead: Bool,
        id: Int64,
        localize: (String, String) -> String
    ) -> String {
        guard hasHead else {
            return localize("admin.dlq.drawer.titleFallback", "DLQ entry")
        }
        return localize("admin.dlq.drawer.title", "DLQ entry #{{id}}")
            .replacingOccurrences(of: "{{id}}", with: String(id))
    }

    /// The web KVList rows for the summary head, with the em-dash fallbacks, the grouped
    /// redeliveries, and the absolute arrival timestamp (web `TimeStamp format="absolute"`).
    public static func rows(
        for summary: EntryDrawerSummary,
        localize: (String, String) -> String,
        absolute: (Date) -> String,
        groupedInt: (Int) -> String = { EntryDrawerIntFormatter.grouped($0) }
    ) -> [EntryDrawerKVRow] {
        let dash = "—"
        let redeliveries = summary.parsedRedeliveries.map(groupedInt) ?? dash
        return [
            EntryDrawerKVRow(
                key: "id",
                label: localize("admin.dlq.drawer.id", "ID"),
                value: String(summary.id),
                monospace: true
            ),
            EntryDrawerKVRow(
                key: "arrivedAt",
                label: localize("admin.dlq.drawer.arrivedAt", "Arrived"),
                value: absolute(summary.arrivedAt)
            ),
            EntryDrawerKVRow(
                key: "dlqTopic",
                label: localize("admin.dlq.drawer.dlqTopic", "DLQ topic"),
                value: summary.dlqTopic.isEmpty ? dash : summary.dlqTopic,
                monospace: true
            ),
            EntryDrawerKVRow(
                key: "reason",
                label: localize("admin.dlq.drawer.reason", "Reason"),
                value: summary.parsedReason.isEmpty ? dash : summary.parsedReason,
                monospace: true
            ),
            EntryDrawerKVRow(
                key: "vin",
                label: localize("admin.dlq.drawer.vin", "VIN"),
                value: summary.parsedVIN ?? dash,
                monospace: true
            ),
            EntryDrawerKVRow(
                key: "sourceTopic",
                label: localize("admin.dlq.drawer.sourceTopic", "Source topic"),
                value: summary.parsedSourceTopic ?? dash,
                monospace: true
            ),
            EntryDrawerKVRow(
                key: "redeliveries",
                label: localize("admin.dlq.drawer.redeliveries", "Redeliveries"),
                value: redeliveries
            ),
            EntryDrawerKVRow(
                key: "parseError",
                label: localize("admin.dlq.drawer.parseError", "Parse error"),
                value: (summary.parseError?.isEmpty == false ? summary.parseError : nil) ?? dash,
                muted: true
            )
        ]
    }

    /// The `<pre>` body text for a tab: the decoded UTF-8 payload, or — when the body is empty
    /// (still loading, or a non-UTF-8 binary blob) — the localized binary-fallback message with the
    /// byte size (web `innerText || t('binaryPayload', …, { n })`).
    public static func displayText(
        tab: EntryDrawerTab,
        decoded: String,
        byteSize: Int,
        localize: (String, String) -> String
    ) -> String {
        guard decoded.isEmpty else { return decoded }
        switch tab {
        case .inner:
            return localize(
                "admin.dlq.drawer.binaryPayload",
                "(non-UTF-8 binary, {{n}} bytes — use the copy button to download base64)"
            ).replacingOccurrences(of: "{{n}}", with: String(byteSize))
        case .raw:
            return localize(
                "admin.dlq.drawer.binaryEnvelope",
                "(non-UTF-8 envelope, {{n}} bytes — use the copy button to download base64)"
            ).replacingOccurrences(of: "{{n}}", with: String(byteSize))
        }
    }

    /// The CopyButton text for a tab: the decoded UTF-8 payload, else the raw base64 blob, else ""
    /// (web `innerText || full?.inner_payload_b64 || ''`).
    public static func copyText(decoded: String, base64: String?) -> String {
        if !decoded.isEmpty { return decoded }
        return base64 ?? ""
    }

    /// The drawer body phase. The web spinner shows while `loading && !full`; once `head` exists the
    /// panels render; empty + error are added so the modal is never blank.
    public static func resolvePhase(
        status: EntryDrawerLoadStatus,
        hasSummary: Bool,
        hasFull: Bool
    ) -> EntryDrawerPhase {
        if status == .loading, !hasFull {
            return .loading
        }
        let hasHead = hasFull || hasSummary
        if hasHead {
            return .content
        }
        if case let .failed(message) = status {
            return .error(message)
        }
        return .empty
    }

    /// The failure message kept on screen while a cached head survives a failed reload (the inline
    /// error shown above the panels), else nil.
    public static func inlineFailure(
        status: EntryDrawerLoadStatus,
        hasHead: Bool
    ) -> String? {
        guard hasHead, case let .failed(message) = status else { return nil }
        return message
    }

    /// Web `replayDisabled = !replayEnabled || !head?.replayable || replayInFlight || loading`.
    public static func replayDisabled(
        replayEnabled: Bool,
        replayable: Bool,
        replayInFlight: Bool,
        loading: Bool
    ) -> Bool {
        !replayEnabled || !replayable || replayInFlight || loading
    }
}
