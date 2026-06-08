//
//  UuidGenerator.Model.swift
//  TeslaSync — P4 feature view · 0024 · UuidGenerator (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the pure UUID generation adapter. SwiftUI parity of
//  features/admin/components/devtools/tools/UuidGenerator.tsx — a purely local,
//  synchronous generator whose only data source is `useTranslation` (no network),
//  so there is no Loadable/remote phase (loading/error/stale/offline) to model.
//  The view binds through `UuidGeneratorModel`; it never performs I/O.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` diagnostics event for a surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol UuidGeneratorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`
/// event. The slug is a static, non-identifying constant; no payload or PII.
public struct OSLogUuidGeneratorTelemetry: UuidGeneratorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Generator seam (the "adapter" — source → projection)

/// Produces one v4 UUID string. A seam so previews/tests inject deterministic
/// values; production uses Foundation's RFC 4122 v4 `UUID`.
public protocol UuidGenerating: Sendable {
    func next() -> String
}

/// Foundation-backed v4 generator. `UUID()` is RFC 4122 §4.4 random — the native
/// equivalent of the web `safeRandomUUID()` — lowercased to match the web output.
public struct SystemUuidGenerator: UuidGenerating {
    public init() {}

    public func next() -> String {
        UUID().uuidString.lowercased()
    }
}

/// One generated row. `id` is a stable identity for the SwiftUI list (the web
/// keys rows by `value-index`); `value` is the displayed v4 UUID.
public struct UuidEntry: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let value: String

    public init(id: UUID = UUID(), value: String) {
        self.id = id
        self.value = value
    }
}

/// Pure, side-effect-free generation rules (the testable adapter). Mirrors the
/// web `setUuids(prev => [uuid, ...prev].slice(0, 10))`.
public enum UuidGeneration {
    /// Most-recent-first cap, matching the web list semantics.
    public static let limit = 10

    /// Prepends `value` to `existing`, capped at `limit` (newest first).
    public static func prepending(
        _ value: String,
        to existing: [UuidEntry],
        limit: Int = UuidGeneration.limit
    ) -> [UuidEntry] {
        Array(([UuidEntry(value: value)] + existing).prefix(max(limit, 0)))
    }

    /// Validates the RFC 4122 v4 canonical form (8-4-4-4-12 hex, version nibble
    /// `4`, variant nibble in `8…b`). Used by the adapter test.
    public static func isCanonicalV4(_ value: String) -> Bool {
        let pattern = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        return value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

// MARK: - State holder (P1/S8) — the view binds through this; no I/O in the view

/// The surface's observable view-model. Holds the generated rows and the single
/// `view.opened` telemetry emission. Pure-local: there is no source/subscription
/// because the web parity has no data hook (only `useTranslation`).
@MainActor
@Observable
public final class UuidGeneratorModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`); the canonical source.
    public static let surfaceSlug = "UuidGenerator"

    /// The mutually-exclusive render branches present in the web source.
    public enum Phase: Equatable {
        case empty
        case content
    }

    public private(set) var entries: [UuidEntry] = []

    /// Empty until the first generate, then content — matching the web shell
    /// (`uuids.length > 0 && <list>`).
    public var phase: Phase {
        entries.isEmpty ? .empty : .content
    }

    @ObservationIgnored private let generator: any UuidGenerating
    @ObservationIgnored private let telemetry: any UuidGeneratorTelemetry
    @ObservationIgnored private var started = false

    public init(
        generator: any UuidGenerating = SystemUuidGenerator(),
        telemetry: any UuidGeneratorTelemetry = OSLogUuidGeneratorTelemetry()
    ) {
        self.generator = generator
        self.telemetry = telemetry
    }

    /// Emits the `view.opened` diagnostics event once per surface appearance.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
    }

    /// Generates a new UUID and prepends it (capped at `UuidGeneration.limit`).
    public func generate() {
        entries = UuidGeneration.prepending(generator.next(), to: entries)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "UuidGenerator" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum UuidGeneratorStrings {
    public static let table = "UuidGenerator"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels for the surface. Kept pure + injectable so the
/// a11y contract can be asserted without rendering.
public enum UuidGeneratorAccessibility {
    /// "UUID {n} of {total}: {value}" — the combined row label.
    public static func rowLabel(index: Int, total: Int, value: String) -> String {
        let format = UuidGeneratorStrings.string("uuidGenerator.row.a11y", "UUID %1$lld of %2$lld: %3$@")
        return String(format: format, index, total, value)
    }
}
