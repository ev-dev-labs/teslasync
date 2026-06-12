//
//  PageContainer.Seams.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The dependency seams the PageContainer view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the production controlled source (the native parity
//  of the host wiring a page's title / lifecycle / freshness query into the container), the in-memory
//  source for previews / tests, and the clipboard seam behind the copy-link button.
//
//  Parity note: the web `PageContainer` is fully controlled — the host page passes `title`, the
//  `loading` / `error` / `empty` lifecycle, and the `query` result as props, and re-renders the
//  container when they change. SwiftUI has no prop-diffing re-render, so `StaticPageContainerSource`
//  reproduces that contract: it re-emits the host-provided snapshot on `start` / `refresh`, and
//  `update(_:)` pushes a new one exactly as the web host re-renders with new props.
//

import Foundation
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticPageContainerSource`); previews and tests use `InMemoryPageContainerSource`. The
/// view never reads the page lifecycle or the freshness query directly.
@MainActor
public protocol PageContainerSource: AnyObject {
    var onUpdate: (@MainActor (PageContainerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the latest title / subtitle + the
/// `loading` / `error` / `empty` lifecycle + the copy-link toggle + the freshness query) and re-emits
/// it on `start` / `refresh`. The host updates the container by pushing a fresh snapshot via `update`,
/// exactly as the web host re-renders with new props. No networking — the data is owned upstream.
@MainActor
public final class StaticPageContainerSource: PageContainerSource {
    public var onUpdate: (@MainActor (PageContainerInput) -> Void)?

    private var snapshot: PageContainerInput

    public init(_ snapshot: PageContainerInput) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host
    /// re-rendering the container with new props.
    public func update(_ input: PageContainerInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryPageContainerSource: PageContainerSource {
    public var onUpdate: (@MainActor (PageContainerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PageContainerInput?

    public init(initial: PageContainerInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: PageContainerInput) {
        onUpdate?(input)
    }
}

// MARK: - Clipboard seam (web `navigator.clipboard.writeText`)

/// The pasteboard the copy-link button writes to — the native mirror of the web
/// `navigator.clipboard.writeText(window.location.href)`. Abstracted so tests assert the copy without
/// touching the system pasteboard. `copy` returns whether the write succeeded so the button can flip
/// to its transient "Copied" state (web `setCopied(true)`).
@MainActor
public protocol PageContainerClipboard: AnyObject {
    @discardableResult
    func copy(_ text: String) -> Bool
}

/// The production clipboard — writes to `UIPasteboard` on iOS / iPadOS and `NSPasteboard` on macOS.
/// On a platform with neither, the copy is a no-op that reports failure (the button then stays in its
/// idle state rather than falsely confirming).
@MainActor
public final class SystemPageContainerClipboard: PageContainerClipboard {
    public init() {}

    @discardableResult
    public func copy(_ text: String) -> Bool {
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
