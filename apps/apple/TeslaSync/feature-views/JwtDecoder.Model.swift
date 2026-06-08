//
//  JwtDecoder.Model.swift
//  TeslaSync — P4 feature view · 0018 · JwtDecoder (Apple)
//
//  The local state holder + seams for the JwtDecoder surface:
//    • @Observable model: the JWT input text and its derived decode result
//      (the native parity of the web `useState` + `useMemo`).
//    • Telemetry seam (P1/S11 diagnostics contract): emits `view.opened` once.
//    • Localization facade (P1/S10): resolves the surface's strings by key with
//      the web English fallback so the view holds no hardcoded literals.
//
//  Vendor-agnostic and SwiftUI-free so the model logic compiles and runs on a
//  plain host (the SwiftUI chrome layers on top in JwtDecoder.swift).
//
//  Parity target: features/admin/components/devtools/tools/JwtDecoder.tsx.
//  Data sources: `useTranslation` only — no remote data hook, so there is no
//  P1/S8 state-holder binding and the view performs no I/O (decode is local).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default implementation logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol JwtDecoderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogJwtDecoderTelemetry: JwtDecoderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (local input → derived decode result)

/// The surface's observable view-model. Holds the JWT input text and exposes the
/// derived `JwtDecodeResult`, recomputed on every keystroke exactly like the web
/// `useMemo`. Emits the `view.opened` diagnostics event once when the view first
/// appears. There is no upstream data source: the decode is a pure local
/// computation, so the view never touches the network.
@MainActor
@Observable
public final class JwtDecoderModel {
    /// The raw JWT the user is editing (bound to the input field).
    public var input: String

    @ObservationIgnored private let telemetry: any JwtDecoderTelemetry
    @ObservationIgnored private var didOpen = false

    public init(
        input: String = "",
        telemetry: any JwtDecoderTelemetry = OSLogJwtDecoderTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The decoded header/payload (or idle/invalid) for the current input — the
    /// native parity of the web `decoded` memo. Pure + cheap; recomputed as the
    /// observed `input` changes.
    public var result: JwtDecodeResult {
        JwtDecoderAdapter.decode(input)
    }

    /// Emits the `view.opened` diagnostics event for this surface. Idempotent, so
    /// re-appearances (tab switches) do not double-count. Call from `onAppear`.
    public func start() {
        guard !didOpen else { return }
        didOpen = true
        telemetry.viewOpened(surface: JwtDecoderSurface.slug)
    }
}

// MARK: - Surface metadata

/// Diagnostics slug for this surface (P1/S11 `view.opened`). Kept out of the
/// SwiftUI view so the model compiles + tests without SwiftUI.
public enum JwtDecoderSurface {
    /// Diagnostics surface slug.
    public static let slug = "JwtDecoder"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "JwtDecoder" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The keys
/// that come straight from the web source use the source's literal `t()` keys
/// (e.g. `"Jwt Header"`) so source ↔ catalog parity is mechanical; native-only
/// chrome uses `jwtDecoder.*` keys.
public enum JwtDecoderStrings {
    public static let table = "JwtDecoder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
