//
//  UnixPermissionTool.Model.swift
//  TeslaSync — P4 feature view · 0022 · UnixPermissionTool (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10)
//  for the UnixPermissionTool devtools surface. Vendor-agnostic and SwiftUI-free
//  so the model + adapter logic compile and run on a plain host; the SwiftUI
//  chrome lives in UnixPermissionTool.swift.
//
//  Parity target: features/admin/components/devtools/tools/UnixPermissionTool.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`,
/// which is consent-gated and redacted there.
public protocol UnixPermissionToolTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogUnixPermissionToolTelemetry: UnixPermissionToolTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Surface identity

/// Diagnostics slug for this surface (P1/S11 `view.opened`). Kept out of the
/// SwiftUI view so the model compiles and tests without SwiftUI.
public enum UnixPermissionToolSurface {
    public static let slug = "UnixPermissionTool"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "UnixPermissionTool"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time; keeping them per-surface lets each parallel surface prompt own its own
/// strings without editing the shared catalog.
public enum UnixPermissionToolStrings {
    public static let table = "UnixPermissionTool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State holder (P1/S8)

/// The observable view-model for the tool. This surface has no remote data — it
/// is a synchronous client-side computation (web parity: the only hook is
/// `useTranslation`), so the state holder owns the octal input and re-derives
/// the `UnixPermissionProjection` on every edit, exposing a render `Phase` for
/// SwiftUI to switch over. No networking lives here.
@MainActor
@Observable
public final class UnixPermissionToolModel {
    /// The mutually-exclusive render branches mirroring the web source: a valid
    /// octal shows the breakdown (`content`); anything else hides it (`empty`).
    public enum Phase: Equatable {
        case content
        case empty
    }

    /// The octal text bound to the input + preset selector. Editing re-derives
    /// the projection, exactly like the web `useMemo([octal])`.
    public var octal: String {
        didSet {
            guard octal != oldValue else { return }
            projection = UnixPermissionProjector.project(octal: octal)
        }
    }

    /// The decoded permissions for the current octal, or `nil` when invalid.
    public private(set) var projection: UnixPermissionProjection?

    /// The render phase derived from whether the input decodes.
    public var phase: Phase {
        projection == nil ? .empty : .content
    }

    @ObservationIgnored private let telemetry: any UnixPermissionToolTelemetry
    @ObservationIgnored private var started = false

    public init(
        octal: String = "755",
        telemetry: any UnixPermissionToolTelemetry = OSLogUnixPermissionToolTelemetry()
    ) {
        self.telemetry = telemetry
        self.octal = octal
        projection = UnixPermissionProjector.project(octal: octal)
    }

    /// Emits the `view.opened` diagnostics event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: UnixPermissionToolSurface.slug)
    }

    /// Applies a preset's octal value (web `Select` onChange).
    public func select(preset: UnixPermissionPreset) {
        octal = preset.octal
    }
}
