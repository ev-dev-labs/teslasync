//
//  PrintButton.Seams.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  The platform seam the PrintButton view-model binds through, kept apart from the model for the lint
//  length budget: the print presenter — the native shape of the browser `window.print()`. The web
//  component calls `window.print()` and the browser opens its print dialog for the current page,
//  hiding any `data-print-hide` chrome via the `@media print` stylesheet. The native parity is the
//  system print panel: an `NSPrintOperation` over the key window's content on macOS, a
//  `UIPrintInteractionController` over a rendered snapshot of the active window on iOS / iPadOS. Both
//  are driven here so the surface is a genuine, self-contained print trigger (not merely an intent
//  signal); a host that needs to print bespoke content instead of the live view hierarchy injects its
//  own `printAction` (the native parity of a page that ships its own `@media print` layout).
//
//  Parity note: like the browser primitive, this surface does not lay out the printed page itself — it
//  hands the platform the current presentation to render. `data-print-hide` (the web attribute that
//  keeps the trigger off the paper) has no native analogue because the print panel renders the
//  supplied document, not the live, interactive control, so the button can never appear in the output.
//  Keeping the request behind this seam lets previews / tests exercise the flow (and the
//  unsupported-platform branch) without driving the real print server.
//

import Foundation
import Observation

#if canImport(AppKit)
    import AppKit
#elseif canImport(UIKit)
    import UIKit
#endif

// MARK: - Print presenter seam (native parity of `window.print()`) — P1/S8

/// The seam the model opens the print dialog through — the native shape of the browser
/// `window.print()`. The production app uses `SystemPrintPresenter`; previews / tests use
/// `InMemoryPrintPresenter`. Returns whether the platform accepted the request (`false` when no
/// printable window is available or the platform cannot print), mirroring the web call being a no-op
/// when there is nothing to render.
@MainActor
public protocol PrintPresenting: AnyObject {
    /// Open the system print dialog for the current presentation — the native parity of
    /// `window.print()`. Returns whether the request was accepted.
    @discardableResult
    func present() -> Bool
}

// MARK: - Production presenter (platform print panel)

/// The production print presenter — opens the platform print panel for the current presentation
/// (`NSPrintOperation` over the key window's content view on macOS; `UIPrintInteractionController`
/// over a paginated PDF snapshot of the active window on iOS / iPadOS), the native parity of the
/// browser opening its print dialog for the current page. Publishes a monotonically increasing
/// `requestCount` (observable) so a host can additionally react to the request, and accepts an
/// injected `printAction` for hosts that print bespoke content rather than the live view hierarchy
/// (the native parity of a page shipping its own `@media print` layout).
@MainActor
@Observable
public final class SystemPrintPresenter: PrintPresenting {
    /// The shared instance — the parity of the single document-level `window.print`.
    public static let shared = SystemPrintPresenter()

    /// The number of print requests issued — published so a host can observe and augment the default
    /// behaviour (e.g. attach a custom print formatter) without subclassing.
    public private(set) var requestCount = 0

    @ObservationIgnored private let printAction: (@MainActor () -> Bool)?

    /// - Parameter printAction: an optional override that performs the print and reports success. When
    ///   `nil`, the presenter prints the current platform window via the system print panel.
    public init(printAction: (@MainActor () -> Bool)? = nil) {
        self.printAction = printAction
    }

    @discardableResult
    public func present() -> Bool {
        requestCount += 1
        if let printAction {
            return printAction()
        }
        return Self.printCurrentWindow()
    }

    #if canImport(AppKit)
        /// Runs the standard macOS print panel for the key (or main) window's content view.
        private static func printCurrentWindow() -> Bool {
            guard let window = NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow,
                  let view = window.contentView
            else { return false }
            let operation = NSPrintOperation(view: view)
            operation.jobTitle = "TeslaSync"
            return operation.run()
        }

    #elseif canImport(UIKit)
        /// Presents the iOS / iPadOS print sheet over a paginated PDF snapshot of the active window —
        /// the native parity of `window.print()` snapshotting the page.
        private static func printCurrentWindow() -> Bool {
            guard UIPrintInteractionController.isPrintingAvailable,
                  let window = activeWindow()
            else { return false }
            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = "TeslaSync"
            controller.printInfo = info
            controller.printingItem = renderedPDF(of: window)
            controller.present(animated: true, completionHandler: nil)
            return true
        }

        /// The current key window across the connected scenes, or the first available one.
        private static func activeWindow() -> UIWindow? {
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
            return windows.first { $0.isKeyWindow } ?? windows.first
        }

        /// A single-page PDF snapshot of the window's current layer contents.
        private static func renderedPDF(of window: UIWindow) -> Data {
            let renderer = UIGraphicsPDFRenderer(bounds: window.bounds)
            return renderer.pdfData { context in
                context.beginPage()
                window.layer.render(in: context.cgContext)
            }
        }

    #else
        /// No print server on this platform — the request is reported as unaccepted.
        private static func printCurrentWindow() -> Bool {
            false
        }
    #endif
}

// MARK: - In-memory presenter (previews + unit / UI tests)

/// In-memory print presenter for previews + unit / UI tests — records the request count and reports a
/// configurable success result so both the accepted and the unavailable (`false`) branches can be
/// exercised without touching the real print server.
@MainActor
@Observable
public final class InMemoryPrintPresenter: PrintPresenting {
    public private(set) var presentCount = 0

    private let succeeds: Bool

    public init(succeeds: Bool = true) {
        self.succeeds = succeeds
    }

    @discardableResult
    public func present() -> Bool {
        presentCount += 1
        return succeeds
    }
}
