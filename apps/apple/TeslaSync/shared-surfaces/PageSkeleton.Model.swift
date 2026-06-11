//
//  PageSkeleton.Model.swift
//  TeslaSync — P4 shared surface · 0132 · PageSkeleton (Apple)
//
//  The state-holder (P1/S8), the diagnostics seam (P1/S11), and the localization facade (P1/S10) for
//  the page-skeleton building blocks. The web `PageSkeleton.tsx` owns no data and no behaviour — it is
//  a set of pure presentational shapes — so the native state-holder is correspondingly thin: it holds
//  no snapshot and performs no fetch. Its single responsibility is the cross-platform parity contract
//  the web component does NOT itself carry but the native diagnostics standard requires — emitting the
//  `view.opened` product-analytics event exactly once when a skeleton region first appears — plus
//  routing the region accessibility labels through the i18n facade so the views hold no English
//  literal. No networking lives here or in the view.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PageSkeletonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPageSkeletonTelemetry: PageSkeletonTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views hold no hardcoded
/// user-facing literal.
public typealias PageSkeletonResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the web English fallback. The keys mirror the web
/// `aria-label` literals ("Loading page header", …). Keys live in the "PageSkeleton" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum PageSkeletonStrings {
    public static let table = "PageSkeleton"

    public static let string: PageSkeletonResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's view-model. It carries no data (the web source is pure presentation), so it exposes
/// only the two responsibilities a native skeleton block still needs: the once-only `view.opened`
/// telemetry (idempotent across the repeated `onAppear` callbacks SwiftUI may deliver) and the
/// localized accessibility label for a region, resolved through the injected facade. A fresh model is
/// created per block by default; previews / tests inject a telemetry spy and an English string stub
/// for deterministic, bundle-free assertions.
@MainActor
public final class PageSkeletonModel {
    private let telemetry: any PageSkeletonTelemetry
    private let strings: PageSkeletonResolve
    private var didEmitOpen = false

    public init(
        telemetry: any PageSkeletonTelemetry = OSLogPageSkeletonTelemetry(),
        strings: @escaping PageSkeletonResolve = PageSkeletonStrings.string
    ) {
        self.telemetry = telemetry
        self.strings = strings
    }

    /// Emits the `view.opened` diagnostics event exactly once for this block instance. Idempotent, so
    /// the repeated `onAppear` callbacks of a scrolling / re-laid-out skeleton do not double-count.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: PageSkeletonMeta.surfaceSlug)
    }

    /// The localized, view-ready accessibility label for a region — the parity of the web
    /// `aria-label`, resolved through the P1/S10 facade.
    public func label(for region: PageSkeletonRegion) -> String {
        strings(region.labelKey, region.labelFallback)
    }
}
