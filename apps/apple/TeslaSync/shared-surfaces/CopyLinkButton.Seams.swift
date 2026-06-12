//
//  CopyLinkButton.Seams.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  The dependency seams the CopyLinkButton view-model binds through, kept apart from the model for
//  the lint length budget: the ambient URL provider (the native shape of the web
//  `window.location.href`), the platform clipboard (the native shape of the web
//  `navigator.clipboard.writeText` + its non-secure-context fallback), the production sources, and
//  the in-memory doubles used by previews / tests.
//
//  Parity note: the web `CopyLinkButton` reads two hooks — `useTranslation` (→ the P1/S10 facade in
//  `…Model.swift`) and `useToast` (→ the toast presenter seam in `…Model.swift`) — plus the ambient
//  `window.location.href`. The browser resolves the URL synchronously at click time; the native
//  parity is therefore a synchronous getter (`CopyLinkURLProviding`), not a coalesced data feed —
//  there is no network and no readiness state to model. The view never reads the router or touches a
//  pasteboard directly; both flow through the model.
//

import Foundation

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - URL provider seam (native parity of `window.location.href`) — P1/S8

/// The seam the model reads the shareable URL through — the native shape of the ambient web
/// `window.location.href`. The production app implements this over the app router's current route
/// (serialised to a deep link); previews and tests use `StaticCopyLinkURLSource`. Read fresh on each
/// access so the value tracks the current view, exactly as the browser resolves `location.href` at
/// click time. The view never reads the router directly.
@MainActor
public protocol CopyLinkURLProviding: AnyObject {
    /// The current view's shareable URL (web `window.location.href`); empty when the app cannot form
    /// a deep link for the current view.
    var currentURL: String { get }
}

/// The controlled / production source. Holds the current view's deep-link URL and lets the
/// composition root push a new value as the route changes — the native parity of the web parent
/// re-rendering under a new `window.location`. Also used by previews / tests for a fixed URL.
@MainActor
public final class StaticCopyLinkURLSource: CopyLinkURLProviding {
    public private(set) var currentURL: String

    public init(_ currentURL: String = "") {
        self.currentURL = currentURL
    }

    /// Replaces the current URL — the parity of the route changing under the surface.
    public func update(_ url: String) {
        currentURL = url
    }
}

/// A closure-backed source — resolves the URL lazily on each read, the closest parity of reading the
/// ambient `window.location.href` fresh at click time (e.g. from the app router's current route). The
/// production composition root wires this to the live route; tests can drive it from a captured var.
@MainActor
public final class ResolvingCopyLinkURLSource: CopyLinkURLProviding {
    private let resolve: @MainActor () -> String

    public init(_ resolve: @escaping @MainActor () -> String) {
        self.resolve = resolve
    }

    public var currentURL: String {
        resolve()
    }
}

// MARK: - Clipboard seam (web `navigator.clipboard.writeText` + fallback)

/// The seam the model writes the link through — the native shape of the web
/// `navigator.clipboard.writeText` (and its non-secure-context `document.execCommand` fallback). The
/// production app uses `SystemCopyLinkClipboard`; previews / tests use `InMemoryCopyLinkClipboard`.
/// Returns whether the write succeeded so the model can announce the matching toast (web success vs
/// `catch`).
@MainActor
public protocol CopyLinkClipboard: AnyObject {
    func write(_ text: String) -> Bool
}

/// Platform-pasteboard default (`UIPasteboard` on iOS / iPadOS, `NSPasteboard` on macOS). On any
/// other platform the write reports failure so the surface still links and announces the error toast.
@MainActor
public final class SystemCopyLinkClipboard: CopyLinkClipboard {
    public init() {}

    public func write(_ text: String) -> Bool {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
            return true
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            return pasteboard.setString(text, forType: .string)
        #else
            return false
        #endif
    }
}

/// In-memory clipboard for previews + unit / UI tests — records the last written value and the full
/// write history, and reports a configurable success result so the success and `catch` (failure)
/// branches can both be exercised without touching the real pasteboard.
@MainActor
public final class InMemoryCopyLinkClipboard: CopyLinkClipboard {
    public private(set) var writes: [String] = []
    public var lastWritten: String? {
        writes.last
    }

    private let succeeds: Bool

    public init(succeeds: Bool = true) {
        self.succeeds = succeeds
    }

    public func write(_ text: String) -> Bool {
        writes.append(text)
        return succeeds
    }
}
