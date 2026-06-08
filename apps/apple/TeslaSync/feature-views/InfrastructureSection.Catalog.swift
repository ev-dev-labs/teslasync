//
//  InfrastructureSection.Catalog.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  The dev-tools tool catalog + value types (web grid entries / `useMutation`
//  state), the P1/S10 localization facade, and the testable accessibility-label
//  builders for the InfrastructureSection surface. Split from the model file so each
//  stays focused (and within the lint file-length budget).
//

import Foundation
import SwiftUI

// MARK: - Tool catalog (web `BackendTool` props + `MqttTestTool`)

/// Whether a tool is a one-shot backend action (web `BackendTool`) or the MQTT
/// publish tool that carries topic + message inputs (web `MqttTestTool`).
public enum InfraToolKind: Sendable, Equatable {
    case backend
    case mqtt
}

/// HTTP verb for the dev-tools call (web `BackendTool` `method`, default GET).
public enum InfraHTTPMethod: String, Sendable, Equatable {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// Local semantic tone (web `color`), kept `Equatable`/`Sendable` and mapped to the
/// shared `TSTone` at render time (`TSTone` itself is not `Equatable`).
public enum InfraTone: Sendable, Equatable {
    case cyan
    case green
    case amber
    case purple

    /// The shared design-system tone used for the icon box + status accents.
    public var tsTone: TSTone {
        switch self {
        case .cyan: .info
        case .green: .success
        case .amber: .warning
        case .purple: .accent
        }
    }
}

/// A dev-tools tool definition — the native projection of one web grid entry
/// (`BackendTool` props or the inline `MqttTestTool`).
public struct InfraTool: Identifiable, Sendable, Equatable {
    /// The dev-tools endpoint slug (web `endpoint`), also the stable surface id.
    public let id: String
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String
    public let systemImage: String
    public let tone: InfraTone
    public let method: InfraHTTPMethod
    public let kind: InfraToolKind

    public init(
        id: String,
        titleKey: String,
        titleFallback: String,
        descriptionKey: String,
        descriptionFallback: String,
        systemImage: String,
        tone: InfraTone,
        method: InfraHTTPMethod,
        kind: InfraToolKind
    ) {
        self.id = id
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.systemImage = systemImage
        self.tone = tone
        self.method = method
        self.kind = kind
    }
}

/// The canonical, ordered dev-tools grid (parity with the web `InfrastructureSection`
/// JSX order: Db Stats, Migrations, MQTT, Env Check, Runtime). Titles/descriptions
/// use the exact web `t()` keys with the web's key-as-copy English fallback.
public enum InfraToolCatalog {
    public static let all: [InfraTool] = [
        InfraTool(
            id: "db-stats",
            titleKey: "Db Stats", titleFallback: "Db Stats",
            descriptionKey: "Db Stats Desc", descriptionFallback: "Db Stats Desc",
            systemImage: "cylinder.split.1x2.fill", tone: .cyan, method: .get, kind: .backend
        ),
        InfraTool(
            id: "migration-status",
            titleKey: "Migrations", titleFallback: "Migrations",
            descriptionKey: "Migrations Desc", descriptionFallback: "Migrations Desc",
            systemImage: "arrow.triangle.branch", tone: .green, method: .get, kind: .backend
        ),
        InfraTool(
            id: "mqtt-test",
            titleKey: "Mqtt", titleFallback: "Mqtt",
            descriptionKey: "Mqtt Desc", descriptionFallback: "Mqtt Desc",
            systemImage: "dot.radiowaves.left.and.right", tone: .amber, method: .post, kind: .mqtt
        ),
        InfraTool(
            id: "env-check",
            titleKey: "Env Check", titleFallback: "Env Check",
            descriptionKey: "Env Check Desc", descriptionFallback: "Env Check Desc",
            systemImage: "checkmark.shield.fill", tone: .purple, method: .get, kind: .backend
        ),
        InfraTool(
            id: "runtime-info",
            titleKey: "Runtime", titleFallback: "Runtime",
            descriptionKey: "Runtime Desc", descriptionFallback: "Runtime Desc",
            systemImage: "cpu.fill", tone: .amber, method: .get, kind: .backend
        )
    ]
}

// MARK: - Per-tool run lifecycle (web `useMutation` state)

/// One tool's run lifecycle, mirroring the web `mutation` state:
/// `idle` (no `mutation.data` yet) → `running` (`mutation.isPending`) →
/// `completed` (`mutation.data`, success or failure) with the time it ran.
public enum InfraToolPhase: Sendable, Equatable {
    case idle
    case running
    case completed(InfraToolResult, ranAt: Date)
}

/// The MQTT tool inputs (web `topic` + `message` `useState`). Empty for backend tools.
public struct InfraToolInputs: Sendable, Equatable {
    public var topic: String
    public var message: String

    public init(topic: String = "", message: String = "") {
        self.topic = topic
        self.message = message
    }

    public static let empty = InfraToolInputs()
}

/// A tool plus its current run phase — the unit the grid iterates over.
public struct InfraToolState: Identifiable, Sendable, Equatable {
    public let tool: InfraTool
    public var phase: InfraToolPhase

    public var id: String {
        tool.id
    }

    public init(tool: InfraTool, phase: InfraToolPhase = .idle) {
        self.tool = tool
        self.phase = phase
    }

    /// The latest completed result, if any (drives the result panel + badge).
    public var result: InfraToolResult? {
        if case let .completed(result, _) = phase { return result }
        return nil
    }

    /// When the latest result was produced (drives the freshness/stale chip).
    public var ranAt: Date? {
        if case let .completed(_, ranAt) = phase { return ranAt }
        return nil
    }

    public var isRunning: Bool {
        phase == .running
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the view
/// holds no hardcoded literals. Keys live in the "InfrastructureSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum InfrastructureStrings {
    public static let table = "InfrastructureSection"

    /// Resolved `String` for a key (web `t(key, fallback)`).
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolved `Text` rendered verbatim (so the per-surface table wins over the
    /// main catalog regardless of key collisions).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolved value wrapped as a `LocalizedStringKey` for shared components that
    /// only accept `LocalizedStringKey` (e.g. `TSTextField`); the resolved string
    /// is not a main-catalog key, so SwiftUI renders it verbatim.
    public static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Accessibility label composition (testable VoiceOver copy)

/// Pure builders for the composed VoiceOver labels the views attach to their
/// interactive elements. Centralized (and parameterized over a localizer) so the
/// exact label logic the views use is unit-testable without a rendered view.
public enum InfraAccessibility {
    /// "Run <Tool Title>" — the run button label (web run action + tool title).
    public static func runLabel(
        tool: InfraTool,
        localize: (String, String) -> String = InfrastructureStrings.string
    ) -> String {
        localize("Run", "Run") + " " + localize(tool.titleKey, tool.titleFallback)
    }

    /// The MQTT publish button label (web "Send Test").
    public static func sendLabel(localize: (String, String) -> String = InfrastructureStrings.string) -> String {
        localize("Send Test", "Send Test")
    }

    /// The connectivity chip label (online / stale / offline).
    public static func freshnessLabel(
        _ connection: InfraConnection,
        localize: (String, String) -> String = InfrastructureStrings.string
    ) -> String {
        switch connection {
        case .online: localize("Online", "Online")
        case .stale: localize("Stale", "Stale")
        case .offline: localize("Offline", "Offline")
        }
    }

    /// The run-outcome badge label (web success / failed).
    public static func statusLabel(
        _ result: InfraToolResult,
        localize: (String, String) -> String = InfrastructureStrings.string
    ) -> String {
        result.didSucceed ? localize("Success", "Success") : localize("Failed", "Failed")
    }
}
