//
//  FullscreenButton.Seams.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  The platform seam the FullscreenButton view-model binds through, kept apart from the model for the
//  lint length budget: the fullscreen presenter — the native shape of the browser Fullscreen API
//  (`document.fullscreenElement` / `requestFullscreen` / `exitFullscreen` / `fullscreenchange` /
//  `document.fullscreenEnabled`). It is the single live source of truth for "which element is
//  fullscreen", observable so the button reflects a change made without a tap (Esc, the macOS green
//  menu-bar button, the system revoking fullscreen on a tab/space switch, or a sibling toggling the
//  same target) — exactly as the web component sources its state from the `fullscreenchange` event
//  rather than its own click handler.
//
//  Parity note: like the browser primitive, this surface does not itself draw the enlarged content —
//  it calls the platform to request / release fullscreen and publishes which target is active; the
//  host surface (the native parity of the element the web `targetRef` points at, e.g. the chart card
//  or the map container) observes that published state and presents the enlarged figure (a
//  `fullScreenCover` on iOS / iPadOS, a full-screen window on macOS). Keeping the request, the live
//  state, and the capability behind this seam lets previews / tests exercise every branch — including
//  the Esc-out path and the platform-denied request — without driving the real window server.
//

import Foundation
import Observation

// MARK: - Fullscreen presenter seam (native parity of the browser Fullscreen API) — P1/S8

/// The seam the model reads + drives the fullscreen state through — the native shape of the browser
/// Fullscreen API. The production app uses `SystemFullscreenPresenter`; previews / tests use
/// `InMemoryFullscreenPresenter`. Conforming types are `@Observable` so a change to `activeTargetID`
/// (a tap, an Esc-out, a system revoke, or a sibling) re-renders the button — the native parity of
/// the web `fullscreenchange` listener being the source of truth.
@MainActor
public protocol FullscreenPresenting: AnyObject {
    /// Whether the platform can present element-level fullscreen — the native parity of the web
    /// `document.fullscreenEnabled`. `false` hides the button (web `if (!supported) return null`).
    var isFullscreenSupported: Bool { get }

    /// The identity of the element currently presented fullscreen, or `nil` — the native parity of
    /// `document.fullscreenElement`. The single source of truth for the button's on/off state.
    var activeTargetID: String? { get }

    /// Request fullscreen for the given target — the native parity of `target.requestFullscreen()`.
    /// Returns whether the platform accepted it; `false` is the web `catch` (sandbox / missing user
    /// gesture / permission policy) and leaves `activeTargetID` unchanged so the button does not flip.
    func request(targetID: String) -> Bool

    /// Release the current fullscreen presentation — the native parity of
    /// `document.exitFullscreen()`. Returns whether the platform accepted it.
    @discardableResult
    func exit() -> Bool
}

// MARK: - Production presenter (platform fullscreen presentation)

/// The production fullscreen presenter — a process-wide single source of truth (mirroring the
/// browser's document-level single fullscreen element: only one element is fullscreen at a time). It
/// publishes which target is active; the host surface observes `activeTargetID` and presents /
/// dismisses the enlarged content (`fullScreenCover` on iOS / iPadOS, a full-screen window on macOS).
/// Element-level fullscreen presentation is available on every Apple platform TeslaSync ships to, so
/// `isFullscreenSupported` is `true` there (and compiled to `false` on any other platform, where the
/// button hides itself — the parity of the web `document.fullscreenEnabled === false` branch).
@MainActor
@Observable
public final class SystemFullscreenPresenter: FullscreenPresenting {
    /// The shared instance — the parity of the single document-level fullscreen element.
    public static let shared = SystemFullscreenPresenter()

    public private(set) var activeTargetID: String?

    public init() {}

    public var isFullscreenSupported: Bool {
        #if os(iOS) || os(macOS) || os(visionOS)
            true
        #else
            false
        #endif
    }

    public func request(targetID: String) -> Bool {
        guard isFullscreenSupported else { return false }
        // One element fullscreen at a time (web document-level lock): requesting a new target
        // supersedes any current one.
        activeTargetID = targetID
        return true
    }

    @discardableResult
    public func exit() -> Bool {
        guard activeTargetID != nil else { return false }
        activeTargetID = nil
        return true
    }

    /// Reflects a fullscreen change the platform made without going through `request` / `exit` — the
    /// native parity of the browser firing `fullscreenchange` for an Esc-out, the macOS menu-bar exit
    /// button, or the system revoking fullscreen. The host wires this to the real presentation's
    /// dismissal so the button stays honest.
    public func reflectExternalChange(activeTargetID: String?) {
        self.activeTargetID = activeTargetID
    }
}

// MARK: - In-memory presenter (previews + unit / UI tests)

/// In-memory fullscreen presenter for previews + unit / UI tests — records the request / exit call
/// counts and the last requested target, supports a configurable support flag and a "reject the next
/// request" switch (to exercise the web `catch` branch), and lets a test set `activeTargetID`
/// directly (the parity of an Esc-out / sibling / system revoke firing `fullscreenchange`) so every
/// branch can be driven without the real window server.
@MainActor
@Observable
public final class InMemoryFullscreenPresenter: FullscreenPresenting {
    public var isFullscreenSupported: Bool
    public private(set) var activeTargetID: String?
    public private(set) var requestedTargets: [String] = []
    public private(set) var exitCount = 0

    /// When `true`, the next `request` is denied (returns `false`, no state change) — the parity of
    /// the web `requestFullscreen()` rejection.
    public var rejectsRequests: Bool

    public init(
        isFullscreenSupported: Bool = true,
        activeTargetID: String? = nil,
        rejectsRequests: Bool = false
    ) {
        self.isFullscreenSupported = isFullscreenSupported
        self.activeTargetID = activeTargetID
        self.rejectsRequests = rejectsRequests
    }

    public var requestCount: Int {
        requestedTargets.count
    }

    public var lastRequestedTarget: String? {
        requestedTargets.last
    }

    public func request(targetID: String) -> Bool {
        requestedTargets.append(targetID)
        guard isFullscreenSupported, !rejectsRequests else { return false }
        activeTargetID = targetID
        return true
    }

    @discardableResult
    public func exit() -> Bool {
        exitCount += 1
        guard activeTargetID != nil else { return false }
        activeTargetID = nil
        return true
    }

    /// Sets the live fullscreen element directly — the parity of the platform firing
    /// `fullscreenchange` for an Esc-out / sibling / system revoke, without a `request` / `exit`.
    public func setActiveExternally(_ targetID: String?) {
        activeTargetID = targetID
    }
}
