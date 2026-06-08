//
//  HashCalculator.Model.swift
//  TeslaSync — P4 feature view · 0015 · HashCalculator (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + the observable
//  view-model + the i18n facade (P1/S10) for the HashCalculator surface — the
//  non-view half of features/admin/components/devtools/tools/HashCalculator.tsx.
//  The view binds through `HashCalculatorModel`; the model performs the compute
//  through the injected `HashDigesting` seam and never touches the network.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity

/// Stable, non-identifying surface slug (P1/S11 `view.opened`). Declared free of any
/// view dependency so the model + engine host-compile and run without the UI layer.
public enum HashCalculatorSurface {
    public static let slug = "HashCalculator"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for a surface.
/// The default logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared `Telemetry.track(.screenView(screen:…))` (ADR-016), which
/// is consent-gated and redacted there. The input text is never part of the event.
public protocol HashCalculatorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Only
/// the static surface slug is logged — never the user's input or the digest.
public struct OSLogHashCalculatorTelemetry: HashCalculatorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Compute seam (web try / catch)

/// The compute seam the model depends on, so tests can drive BOTH the success path
/// and the failure path (web `catch { setHashResult(t('Hash Error')) }`). The
/// production implementation is `CryptoKitDigester`; it does not throw, but the seam
/// keeps the error branch reachable and unit-testable.
public protocol HashDigesting: Sendable {
    func sha256Hex(_ input: String) throws -> String
}

/// Production digester — delegates to the pure `HashCalculatorEngine`.
public struct CryptoKitDigester: HashDigesting {
    public init() {}

    public func sha256Hex(_ input: String) throws -> String {
        HashCalculatorEngine.sha256Hex(input)
    }
}

// MARK: - View-model (P1/S8 state-holder seam)

/// The surface's observable view-model. It owns the input text and the mutually
/// exclusive render phase the SwiftUI view switches over, and runs the compute
/// through the injected `HashDigesting` seam. Mirrors the web component's `inputVal`
/// / `hashResult` / `computing` state — including the empty-input guard
/// (`if (!inputVal) return`).
@MainActor
@Observable
public final class HashCalculatorModel {
    /// The render branches: nothing computed yet, computing, a finished digest, or a
    /// failed compute (web `Hash Error`).
    public enum Phase: Equatable {
        case idle
        case computing
        case result(String)
        case failed
    }

    /// The text to hash (web `inputVal`), two-way bound to the editor.
    public var input: String

    /// The current render phase (web `computing` + `hashResult`).
    public private(set) var phase: Phase

    @ObservationIgnored private let digester: any HashDigesting
    @ObservationIgnored private let telemetry: any HashCalculatorTelemetry
    @ObservationIgnored private var didOpen = false

    public init(
        input: String = "",
        phase: Phase = .idle,
        digester: any HashDigesting = CryptoKitDigester(),
        telemetry: any HashCalculatorTelemetry = OSLogHashCalculatorTelemetry()
    ) {
        self.input = input
        self.phase = phase
        self.digester = digester
        self.telemetry = telemetry
    }

    /// Whether a compute is allowed (web guard `if (!inputVal) return`). Trims so an
    /// all-whitespace string does not count as input.
    public var canCompute: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The finished digest when the phase carries one (drives the a11y value + tests).
    public var digest: String? {
        if case let .result(hex) = phase { return hex }
        return nil
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent, so it is
    /// safe to call from `onAppear`.
    public func start() {
        guard !didOpen else { return }
        didOpen = true
        telemetry.viewOpened(surface: HashCalculatorSurface.slug)
    }

    /// Computes the SHA-256 digest of the current input (web `compute`). No-ops on
    /// empty input and routes a thrown digester error to the `.failed` phase.
    public func compute() async {
        guard canCompute else { return }
        phase = .computing
        do {
            let hex = try digester.sha256Hex(input)
            phase = .result(hex)
        } catch {
            phase = .failed
        }
    }
}

// MARK: - i18n facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "HashCalculator" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum HashCalculatorStrings {
    public static let table = "HashCalculator"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
