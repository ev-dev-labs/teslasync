//
//  Lightbox.Seams.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The dependency seams the Lightbox state-holder binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry contract (`view.opened`), the image-loader seam (P1/S8 — the native
//  peer of the browser `<img>` fetch + the `new Image()` neighbour pre-warm), the P1/S10 i18n facade (web
//  `t(key, default)` with `{{…}}` interpolation), and the VoiceOver string builders. The view never reads the
//  network or a bundle directly — production injects the URLSession loader + the real facade; previews and
//  tests inject the in-memory loader + the English fallbacks.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol LightboxTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the viewer open as a redaction-safe `view.opened` event.
public struct OSLogLightboxTelemetry: LightboxTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Image loader seam (P1/S8) — web `<img>` fetch + `new Image()` pre-warm

/// The outcome of loading one image's bytes — the native peer of the browser `<img>` `onLoad` / `onError`.
/// `Data` is `Sendable`, so the outcome crosses the loader's concurrency boundary back to the `@MainActor`
/// model cleanly.
public enum LightboxImageOutcome: Sendable, Equatable {
    case loaded(Data)
    case failed
}

/// The seam the state-holder loads images through (P1/S8). Production binds the URLSession-backed loader
/// (sharing the app `URLCache`, the native peer of the browser image cache); previews + tests inject
/// ``StaticLightboxImageLoader`` so no real network is touched and every load state is deterministic.
/// `prewarm` is the native peer of the web `new Image(); preload.src = neighbour.src` — a fire-and-forget
/// fetch that warms the cache so ←/→ navigation is instant on the next visit.
public protocol LightboxImageLoading: Sendable {
    /// Loads the bytes for an image source (web `<img src>` decode). Returns `.failed` on any error so the
    /// surface renders its retry-able error envelope rather than throwing into the view.
    func load(_ source: String) async -> LightboxImageOutcome
    /// Warms the cache for a soon-to-be-visible neighbour (web `new Image()` pre-warm). Fire-and-forget.
    func prewarm(_ source: String)
}

/// The production loader: fetches the image bytes over `URLSession` (sharing the app `URLCache`, the native
/// peer of the browser image cache). A non-2xx response or empty body resolves to `.failed` so the surface
/// shows its error envelope. `prewarm` resumes a detached data task to warm the cache, exactly as the web
/// `new Image()` neighbour pre-warm does.
public struct URLSessionLightboxImageLoader: LightboxImageLoading {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func load(_ source: String) async -> LightboxImageOutcome {
        guard let url = URL(string: source) else { return .failed }
        do {
            let (data, response) = try await session.data(from: url)
            if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
                return .failed
            }
            return data.isEmpty ? .failed : .loaded(data)
        } catch {
            return .failed
        }
    }

    public func prewarm(_ source: String) {
        guard let url = URL(string: source) else { return }
        // Fire-and-forget: the result is discarded, but a cacheable response populates URLCache for the next
        // visit — the native peer of the web `new Image(); preload.src = …` pre-warm.
        Task { _ = try? await session.data(from: url) }
    }
}

/// In-memory loader for previews + unit tests. Returns a fixed outcome (optionally per source) and records the
/// sources it was asked to load + pre-warm, so navigation pre-warm can be asserted without a network.
public final class StaticLightboxImageLoader: LightboxImageLoading, @unchecked Sendable {
    private let lock = NSLock()
    private let defaultOutcome: LightboxImageOutcome
    private let perSource: [String: LightboxImageOutcome]
    private var loadedStorage: [String] = []
    private var prewarmedStorage: [String] = []

    public init(
        outcome: LightboxImageOutcome = .loaded(Data([0x89, 0x50, 0x4E, 0x47])),
        perSource: [String: LightboxImageOutcome] = [:]
    ) {
        defaultOutcome = outcome
        self.perSource = perSource
    }

    /// The sources `load` was called with, in order.
    public var loadedSources: [String] {
        lock.withLock { loadedStorage }
    }

    /// The sources `prewarm` was called with, in order.
    public var prewarmedSources: [String] {
        lock.withLock { prewarmedStorage }
    }

    public func load(_ source: String) async -> LightboxImageOutcome {
        lock.withLock {
            loadedStorage.append(source)
            return perSource[source] ?? defaultOutcome
        }
    }

    public func prewarm(_ source: String) {
        lock.withLock { prewarmedStorage.append(source) }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "Lightbox" table, folded into the app `Localizable.xcstrings` master catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings. In test / preview bundles
/// `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic.
public enum LightboxStrings {
    public static let table = "Lightbox"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Substitutes `{{name}}` placeholders — the native peer of i18next interpolation, so the catalog keeps
    /// the exact web template (`{{current}} / {{total}}`, `{{value}}%`) rather than a reworded `%@` format.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (name, value) in values {
            result = result.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return result
    }

    // MARK: Web keys (mirrored verbatim from the source `t()` calls)

    /// The "n / total" counter (web `lightbox.counter` = `{{current}} / {{total}}`). 1-based current.
    public static func counter(current: Int, total: Int) -> String {
        interpolate(
            string("lightbox.counter", "{{current}} / {{total}}"),
            ["current": String(current), "total": String(total)]
        )
    }

    /// The close button label (web `lightbox.close`).
    public static var close: String {
        string("lightbox.close", "Close image viewer")
    }

    /// The previous-image button label (web `lightbox.previous`).
    public static var previous: String {
        string("lightbox.previous", "Previous image")
    }

    /// The next-image button label (web `lightbox.next`).
    public static var next: String {
        string("lightbox.next", "Next image")
    }

    /// The zoom-out button label (web `lightbox.zoomOut`).
    public static var zoomOut: String {
        string("lightbox.zoomOut", "Zoom out")
    }

    /// The zoom-in button label (web `lightbox.zoomIn`).
    public static var zoomIn: String {
        string("lightbox.zoomIn", "Zoom in")
    }

    /// The reset-zoom button label (web `lightbox.zoomReset`).
    public static var zoomReset: String {
        string("lightbox.zoomReset", "Reset zoom")
    }

    /// The zoom-percentage readout (web `lightbox.zoomPercent` = `{{value}}%`).
    public static func zoomPercent(_ value: Int) -> String {
        interpolate(string("lightbox.zoomPercent", "{{value}}%"), ["value": String(value)])
    }

    // MARK: Native additions (a11y + states — no web `t()` key exists for these)

    /// The dialog's accessibility label (native peer of web `role="dialog"` + `aria-modal`).
    public static var dialog: String {
        string("lightbox.dialog", "Image viewer")
    }

    /// The VoiceOver label for an image whose `alt` is empty (decorative), so it is never announced silently.
    public static var imageFallback: String {
        string("lightbox.image", "Image")
    }

    /// The VoiceOver status while the current image decodes (native peer of the web skeleton overlay).
    public static var loading: String {
        string("lightbox.loading", "Loading image")
    }

    /// The hint announced when the image is magnified, telling VoiceOver users a drag pans (native HIG).
    public static var panHint: String {
        string("lightbox.panHint", "Drag to pan")
    }

    /// The empty-state title shown when `images` is empty (web returns null; native never a blank box).
    public static var emptyTitle: String {
        string("lightbox.empty.title", "No images to show")
    }

    /// The empty-state supporting line.
    public static var emptyMessage: String {
        string("lightbox.empty.message", "Images appear here when they become available.")
    }

    /// The error-envelope title shown when the current image fails to load (web `onError`).
    public static var errorTitle: String {
        string("lightbox.error.title", "Image failed to load")
    }

    /// The error-envelope supporting line (covers an offline fetch).
    public static var errorMessage: String {
        string("lightbox.error.message", "Check your connection and try again.")
    }

    /// The error-envelope retry button label.
    public static var errorRetry: String {
        string("lightbox.error.retry", "Try again")
    }
}

// MARK: - Accessibility (VoiceOver builders)

/// Builds the surface's VoiceOver strings. Copy resolves through the P1/S10 facade so the labels are testable
/// without a rendered view; the image label honours the web `alt`, falling back to a generic label only when
/// the caller deliberately passes an empty (decorative) `alt`.
public enum LightboxAccessibility {
    /// The VoiceOver label for an image — its `alt` (web `alt`), or a generic fallback when `alt` is empty.
    public static func imageLabel(for image: LightboxImage) -> String {
        image.alt.isEmpty ? LightboxStrings.imageFallback : image.alt
    }

    /// The VoiceOver status announced for the current load phase, so assistive tech is never left silent.
    public static func loadStatus(for phase: LightboxLoadPhase) -> String {
        switch phase {
        case .loading: LightboxStrings.loading
        case .loaded: ""
        case .failed: LightboxStrings.errorTitle
        }
    }
}
