//
//  CopyButton.Seams.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  The dependency seams the CopyButton view-model binds through, kept apart from the model for the
//  lint length budget: the text source (the native shape of the web `text` prop — supporting both a
//  fixed string and a closure that resolves fresh on each copy, the parity of a parent re-rendering
//  with a new `text`), the platform clipboard (the native shape of the web
//  `navigator.clipboard.writeText` + its non-secure-context fallback), the production sources, and
//  the in-memory doubles used by previews / tests.
//
//  Parity note: the web `CopyButton` reads two hooks — `useTranslation` (→ the P1/S10 facade in
//  `…Model.swift`) and `useOptionalToast` (→ the toast presenter seam in `…Model.swift`) — plus its
//  `text` prop. There is no network and no readiness state to model; the native parity of `text` is
//  therefore a synchronous getter (`CopyButtonTextProviding`), not a coalesced data feed. The view
//  never touches a pasteboard directly; the write flows through the model.
//

import Foundation

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Text source seam (native parity of the web `text` prop) — P1/S8

/// The seam the model reads the to-copy string through — the native shape of the web `text` prop.
/// Read fresh on each access so the value tracks a caller that re-renders with a new `text`, exactly
/// as the web component closes over the current prop at click time.
@MainActor
public protocol CopyButtonTextProviding: AnyObject {
    /// The current string to copy (web `text`).
    var currentText: String { get }
}

/// The controlled / production source. Holds a fixed string and lets the composition root push a new
/// value as the caller's `text` changes — the native parity of the web parent re-rendering with a
/// new `text` prop. Also used by previews / tests for a fixed value.
@MainActor
public final class StaticCopyButtonTextSource: CopyButtonTextProviding {
    public private(set) var currentText: String

    public init(_ currentText: String = "") {
        self.currentText = currentText
    }

    /// Replaces the current text — the parity of the `text` prop changing under the surface.
    public func update(_ text: String) {
        currentText = text
    }
}

/// A closure-backed source — resolves the string lazily on each read, the closest parity of the web
/// component closing over the current `text` prop at click time (e.g. a value derived from live
/// state). The production composition root wires this to the caller's current value; tests can drive
/// it from a captured var.
@MainActor
public final class ResolvingCopyButtonTextSource: CopyButtonTextProviding {
    private let resolve: @MainActor () -> String

    public init(_ resolve: @escaping @MainActor () -> String) {
        self.resolve = resolve
    }

    public var currentText: String {
        resolve()
    }
}

// MARK: - Clipboard seam (web `navigator.clipboard.writeText` + fallback)

/// The seam the model writes through — the native shape of the web `navigator.clipboard.writeText`
/// (and its non-secure-context `document.execCommand` fallback). The production app uses
/// `SystemCopyButtonClipboard`; previews / tests use `InMemoryCopyButtonClipboard`. Returns whether
/// the write succeeded so the model can flip to "Copied" + announce the matching toast (web success
/// vs `catch`).
@MainActor
public protocol CopyButtonClipboard: AnyObject {
    func write(_ text: String) -> Bool
}

/// Platform-pasteboard default (`UIPasteboard` on iOS / iPadOS, `NSPasteboard` on macOS). On any
/// other platform the write reports failure so the surface still renders and announces the error
/// toast (when `withToast`).
@MainActor
public final class SystemCopyButtonClipboard: CopyButtonClipboard {
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
/// write history, and reports a configurable success result so both the success and `catch` (failure)
/// branches can be exercised without touching the real pasteboard.
@MainActor
public final class InMemoryCopyButtonClipboard: CopyButtonClipboard {
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
