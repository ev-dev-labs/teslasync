//
//  VinDecoder.Model.swift
//  TeslaSync — P4 feature view · 0025 · VinDecoder (Apple)
//
//  The local state holder + seams for the VinDecoder surface:
//    • @Observable model: the VIN input text and its derived decode result
//      (the native parity of the web `useState` + `useMemo`).
//    • Telemetry seam (P1/S11 diagnostics contract): emits `view.opened` once.
//    • Localization facade (P1/S10): resolves the surface's strings by key with
//      the web English fallback so the view holds no hardcoded literals.
//
//  Vendor-agnostic and SwiftUI-free so the model logic compiles and runs on a
//  plain host (the SwiftUI chrome layers on top in VinDecoder.swift).
//
//  Parity target: features/admin/components/devtools/tools/VinDecoder.tsx.
//  Data sources: `useTranslation` only — no remote data hook, so there is no
//  P1/S8 remote state-holder binding and the view performs no I/O (the decode is
//  a pure local computation). The generic surface template's "loading / error /
//  stale / offline" states are structurally impossible here and therefore
//  intentionally absent: there is no asynchronous source that could be pending,
//  fail, go stale, or require connectivity. The two states the web source has —
//  no-result (input too short) and decoded — are both rendered.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default implementation logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol VinDecoderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogVinDecoderTelemetry: VinDecoderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (local input → derived decode result)

/// The surface's observable view-model. Holds the VIN input text and exposes the
/// derived `VinDecoded?`, recomputed on every keystroke exactly like the web
/// `useMemo`. Emits the `view.opened` diagnostics event once when the view first
/// appears. There is no upstream data source: the decode is a pure local
/// computation, so the view never touches the network.
@MainActor
@Observable
public final class VinDecoderModel {
    /// The raw VIN the user is editing (bound to the input field).
    public var input: String

    @ObservationIgnored private let telemetry: any VinDecoderTelemetry
    @ObservationIgnored private var didOpen = false

    public init(
        input: String = "",
        telemetry: any VinDecoderTelemetry = OSLogVinDecoderTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The decoded VIN for the current input (or `nil` when too short to decode)
    /// — the native parity of the web `decoded` memo. Pure + cheap; recomputed as
    /// the observed `input` changes.
    public var result: VinDecoded? {
        VinDecoderAdapter.decode(input)
    }

    /// Emits the `view.opened` diagnostics event for this surface. Idempotent, so
    /// re-appearances (tab switches) do not double-count. Call from `onAppear`.
    public func start() {
        guard !didOpen else { return }
        didOpen = true
        telemetry.viewOpened(surface: VinDecoderSurface.slug)
    }
}

// MARK: - Surface metadata

/// Diagnostics slug for this surface (P1/S11 `view.opened`). Kept out of the
/// SwiftUI view so the model compiles + tests without SwiftUI.
public enum VinDecoderSurface {
    /// Diagnostics surface slug.
    public static let slug = "VinDecoder"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VinDecoder" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The keys
/// that come straight from the web source use the source's literal `t()` keys
/// (e.g. `"Vin Decoder"`, `"devtools.utils.vin_mfr"`) so source ↔ catalog parity
/// is mechanical; native-only chrome uses `vinDecoder.*` keys.
public enum VinDecoderStrings {
    public static let table = "VinDecoder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
