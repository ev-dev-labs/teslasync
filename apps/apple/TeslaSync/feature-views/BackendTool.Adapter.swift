//
//  BackendTool.Adapter.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  The testable projection core: the dev-tool run result value (web `ResultPanel`
//  data/error), the run-status badge projection (web
//  `Badge variant={data.error ? 'danger' : 'success'}`), the freshness chip
//  projection, the JSON pretty-printer (web `JSON.stringify(data, null, 2)`), and
//  the VoiceOver summary builders. All pure + dependency-free so the adapter can be
//  unit-tested without a runner, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Result value (web `ResultPanel` data / error)

/// One settled run result. `json` is the pretty-printed success body (web
/// `ResultPanel` `<pre>`), `error` is the server/validation message (web rose
/// text); exactly one is non-nil. `completedAt` backs the freshness window.
public struct BackendToolResult: Equatable, Sendable {
    public let json: String?
    public let error: String?
    public let completedAt: Date

    public init(json: String?, error: String?, completedAt: Date) {
        self.json = json
        self.error = error
        self.completedAt = completedAt
    }

    /// Whether a success body is available (web `data != null && !data.error`).
    public var hasData: Bool {
        json != nil
    }

    /// Whether the result is an error (web `data.error`).
    public var isError: Bool {
        error != nil
    }
}

// MARK: - Freshness / connectivity (mirrors LiveConnectionState, ADR-013)

/// Live-state freshness for the last result, layered on top of the run phase.
public enum BackendToolConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Run-status badge projection (web `Badge`)

/// The run-status badge shown once a result settles (web `mutation.data` →
/// `<Badge variant={data.error ? 'danger' : 'success'}>`). Hidden while idle or
/// running, exactly like the web (which renders nothing until `mutation.data`).
public struct BackendToolStatus: Equatable {
    public enum Kind: Equatable { case hidden, success, failure }

    public let kind: Kind
    public let tone: TSTone
    public let labelKey: String
    public let labelFallback: String

    public init(kind: Kind, tone: TSTone, labelKey: String, labelFallback: String) {
        self.kind = kind
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }

    /// No badge (idle / running).
    public static var hidden: BackendToolStatus {
        BackendToolStatus(kind: .hidden, tone: .neutral, labelKey: "", labelFallback: "")
    }

    /// Projects the run phase into the badge (web `data.error ? 'Failed' : 'Success'`).
    public static func project(phase: BackendToolModel.Phase) -> BackendToolStatus {
        switch phase {
        case .success:
            BackendToolStatus(kind: .success, tone: .success, labelKey: "Success", labelFallback: "Success")
        case .failure:
            BackendToolStatus(kind: .failure, tone: .danger, labelKey: "Failed", labelFallback: "Failed")
        case .idle, .running:
            .hidden
        }
    }
}

// MARK: - Freshness chip projection (native chrome for the live-state contract)

/// The freshness chip shown after a run (live / stale / offline), mapping the
/// connection to a tone + localized label key.
public struct BackendToolConnectionChip: Equatable {
    public let tone: TSTone
    public let labelKey: String
    public let labelFallback: String

    public init(tone: TSTone, labelKey: String, labelFallback: String) {
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }

    public static func project(_ connection: BackendToolConnection) -> BackendToolConnectionChip {
        switch connection {
        case .live:
            BackendToolConnectionChip(tone: .success, labelKey: "devtools.tool.live", labelFallback: "Live")
        case .stale:
            BackendToolConnectionChip(tone: .warning, labelKey: "devtools.tool.stale", labelFallback: "Stale")
        case .offline:
            BackendToolConnectionChip(tone: .neutral, labelKey: "devtools.tool.offline", labelFallback: "Offline")
        }
    }
}

// MARK: - JSON pretty-printer (web `JSON.stringify(data, null, 2)`)

/// Re-serializes a raw JSON response with sorted keys + 2-space indentation so the
/// displayed body reads like the web `JSON.stringify(data, null, 2)` output.
public enum BackendToolJSON {
    /// Pretty-prints `raw`. A body that is not a JSON object/array (an empty
    /// string, a scalar, or malformed JSON) is returned trimmed-but-verbatim
    /// rather than dropped, so a non-standard success body is still shown instead
    /// of silently blanking the panel.
    public static func prettyPrinted(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let data = trimmed.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            JSONSerialization.isValidJSONObject(object),
            let pretty = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            ),
            let string = String(data: pretty, encoding: .utf8)
        else {
            return trimmed
        }
        return string
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the run action and the result panel. Pure +
/// public so the spoken content can be unit-tested without rendering the view.
public enum BackendToolAccessibility {
    /// The Run button's spoken label, e.g. "Run, Reset signal cache".
    public static func runLabel(title: String, localize: (String, String) -> String) -> String {
        let run = localize("Run", "Run")
        return title.isEmpty ? run : "\(run), \(title)"
    }

    /// The result panel's spoken summary across idle / error / success.
    public static func resultSummary(
        result: BackendToolResult?,
        localize: (String, String) -> String
    ) -> String {
        guard let result else {
            return localize("devtools.tool.noResult", "No result yet")
        }
        if let error = result.error {
            return "\(localize("Failed", "Failed")). \(error)"
        }
        return localize("Success", "Success")
    }
}
