//
//  LiveControls.Adapter.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  The testable projection core — the SwiftUI parity of
//  features/system/components/state-machine/LiveControls.tsx. Everything here is
//  pure + dependency-free (no store, no bundle, no rendered view) so the buffer
//  counter math (the web `inWindow` / `total` / `outside` derivation and the
//  single-vs-dual label choice), the window-option table, the copy catalog, and
//  the accessibility/label formatting are unit tested in isolation.
//
//  The web component is a purely *controlled* FSM-debugger toolbar: Live / Freeze,
//  step-previous / step-next, the Window dropdown, Clear buffer, and a right-aligned
//  buffer counter with a hover tooltip. It fetches nothing itself — its parent (the
//  debugger page) owns the transition buffer and passes the control props down. The
//  native surface owns the P4 states contract (loading / error / empty / stale /
//  offline) around that parent query; this file ports the leaf's pure logic while the
//  Model resolves the chrome.
//

import Foundation

// MARK: - Controlled props snapshot (web `LiveControlsProps`)

/// The controlled inputs the web toolbar receives from its parent. Pure +
/// `Sendable` so the projection is tested without a store or a view. `windowCount`
/// / `totalCount` are the two-scope counts; `bufferCount` is the web `@deprecated`
/// single-scope fallback kept for one migration phase.
public struct LiveControlsState: Sendable, Equatable {
    public var isLive: Bool
    public var canStepPrev: Bool
    public var canStepNext: Bool
    public var windowMinutes: Int
    public var windowCount: Int?
    public var totalCount: Int?
    public var bufferCount: Int?

    public init(
        isLive: Bool,
        windowMinutes: Int,
        canStepPrev: Bool = false,
        canStepNext: Bool = false,
        windowCount: Int? = nil,
        totalCount: Int? = nil,
        bufferCount: Int? = nil
    ) {
        self.isLive = isLive
        self.windowMinutes = windowMinutes
        self.canStepPrev = canStepPrev
        self.canStepNext = canStepNext
        self.windowCount = windowCount
        self.totalCount = totalCount
        self.bufferCount = bufferCount
    }
}

// MARK: - Buffer counter (web `inWindow` / `total` / `outside` / `dual`)

/// The resolved buffer counter — the heart of the web component. Carries the
/// in-window + 24 h totals, the count outside the window, and whether the
/// two-scope ("dual") label applies, so the view chooses the copy declaratively.
public struct LiveControlsCounter: Sendable, Equatable {
    public let inWindow: Int
    public let total: Int
    public let outside: Int
    public let isDual: Bool

    public init(inWindow: Int, total: Int, outside: Int, isDual: Bool) {
        self.inWindow = inWindow
        self.total = total
        self.outside = outside
        self.isDual = isDual
    }

    /// Web `dual && outside > 0` — render the two-scope label
    /// ("{{inWindow}} in window · {{total}} in 24 h") instead of the legacy
    /// single-scope "{{n}} buffered".
    public var prefersDualLabel: Bool {
        isDual && outside > 0
    }

    /// No transitions buffered in either scope — the P4 empty value the view
    /// humanizes (never a blank box) while the controls stay fully usable.
    public var isEmpty: Bool {
        total == 0 && inWindow == 0
    }
}

// MARK: - Window option (web `WINDOW_OPTIONS`)

/// One Window-dropdown choice: the buffer window in minutes plus its localized
/// label. Mirrors the web `WINDOW_OPTIONS` entries (5 / 10 / 30 / 120), whose
/// English labels become catalog keys so no literal lives in native code.
public struct LiveControlsWindowOption: Sendable, Equatable, Identifiable {
    public let minutes: Int
    public let label: LiveControlsText

    public var id: Int {
        minutes
    }

    public init(minutes: Int, label: LiveControlsText) {
        self.minutes = minutes
        self.label = label
    }
}

// MARK: - Surface-local tone (mapped to design tokens at the view boundary)

/// Surface-local semantic tone, mapped to design tokens in the Views layer so the
/// projection stays free of SwiftUI. `live` is the streaming pulse (web
/// emerald-300), `muted` the idle/divider neutral, `accent` the stale chip.
public enum LiveControlsTone: Sendable, Equatable {
    case live
    case muted
    case accent
}

// MARK: - Display projection (everything the toolbar renders)

/// The display-ready toolbar state: the toggle + step affordances, the active
/// window, the resolved counter, and the option table. Built purely from a
/// `LiveControlsState` so the whole loaded surface is asserted without a view.
public struct LiveControlsProjection: Sendable, Equatable {
    public let isLive: Bool
    public let canStepPrev: Bool
    public let canStepNext: Bool
    public let windowMinutes: Int
    public let counter: LiveControlsCounter
    public let options: [LiveControlsWindowOption]

    public init(
        isLive: Bool,
        canStepPrev: Bool,
        canStepNext: Bool,
        windowMinutes: Int,
        counter: LiveControlsCounter,
        options: [LiveControlsWindowOption]
    ) {
        self.isLive = isLive
        self.canStepPrev = canStepPrev
        self.canStepNext = canStepNext
        self.windowMinutes = windowMinutes
        self.counter = counter
        self.options = options
    }

    /// Web counter derivation, verbatim:
    /// `inWindow = windowCount ?? bufferCount ?? 0`,
    /// `total = totalCount ?? bufferCount ?? 0`,
    /// `outside = max(0, total - inWindow)`,
    /// `dual = totalCount != nil || windowCount != nil`.
    public static func counter(
        windowCount: Int?,
        totalCount: Int?,
        bufferCount: Int?
    ) -> LiveControlsCounter {
        let inWindow = windowCount ?? bufferCount ?? 0
        let total = totalCount ?? bufferCount ?? 0
        let outside = max(0, total - inWindow)
        let isDual = totalCount != nil || windowCount != nil
        return LiveControlsCounter(inWindow: inWindow, total: total, outside: outside, isDual: isDual)
    }

    /// Projects the controlled props into the display state, resolving the counter
    /// and attaching the canonical window-option table.
    public static func make(
        from state: LiveControlsState,
        options: [LiveControlsWindowOption] = LiveControlsCopy.windowOptions
    ) -> LiveControlsProjection {
        LiveControlsProjection(
            isLive: state.isLive,
            canStepPrev: state.canStepPrev,
            canStepNext: state.canStepNext,
            windowMinutes: state.windowMinutes,
            counter: counter(
                windowCount: state.windowCount,
                totalCount: state.totalCount,
                bufferCount: state.bufferCount
            ),
            options: options
        )
    }
}

// MARK: - Copy catalog (web `t(key, default)` — every string the surface resolves)

/// One localizable string: its catalog key plus the web English fallback. Keeping
/// the pair as a value lets the view resolve through the P1/S10 facade while tests
/// assert the key set without a bundle.
public struct LiveControlsText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    public func resolved(_ localize: (String, String) -> String) -> String {
        localize(key, fallback)
    }
}

/// The surface's full copy catalog. The first group is the strings extracted from
/// the web source (the toolbar labels + the counter/tooltip templates); the window
/// labels lift the web `WINDOW_OPTIONS` literals into keyed strings; the last group
/// backs the native chrome (loading / error / empty / stale / offline + the toolbar
/// group label) the P4 states contract requires of a standalone surface.
public enum LiveControlsCopy {
    // --- Web source keys ---
    public static let live = LiveControlsText("debugger.controls.live", "Live")
    public static let freeze = LiveControlsText("debugger.controls.freeze", "Freeze")
    public static let stepPrev = LiveControlsText("debugger.controls.stepPrev", "Step to previous transition")
    public static let stepNext = LiveControlsText("debugger.controls.stepNext", "Step to next transition")
    public static let window = LiveControlsText("debugger.controls.window", "Window")
    public static let clear = LiveControlsText("debugger.controls.clear", "Clear buffer")
    public static let buffered = LiveControlsText("debugger.controls.buffered", "%1$d buffered")
    public static let bufferedDual = LiveControlsText(
        "debugger.controls.bufferedDual",
        "%1$d in window · %2$d in 24 h"
    )
    public static let bufferedTooltip = LiveControlsText(
        "debugger.controls.bufferedTooltip",
        "Counts inside the %1$d-minute Window dropdown. %2$d more transitions fetched in the last 24 h."
    )

    // --- Window labels (web WINDOW_OPTIONS literals → keyed strings) ---
    public static let window5 = LiveControlsText("debugger.controls.window.5m", "5 min")
    public static let window10 = LiveControlsText("debugger.controls.window.10m", "10 min")
    public static let window30 = LiveControlsText("debugger.controls.window.30m", "30 min")
    public static let window120 = LiveControlsText("debugger.controls.window.120m", "2 h")

    /// The canonical Window-dropdown table (web `WINDOW_OPTIONS`, same order).
    public static let windowOptions: [LiveControlsWindowOption] = [
        LiveControlsWindowOption(minutes: 5, label: window5),
        LiveControlsWindowOption(minutes: 10, label: window10),
        LiveControlsWindowOption(minutes: 30, label: window30),
        LiveControlsWindowOption(minutes: 120, label: window120)
    ]

    // --- Native chrome (P4 states contract + group accessibility) ---
    public static let toolbarLabel = LiveControlsText("debugger.controls.toolbar", "Live transition controls")
    public static let loading = LiveControlsText("debugger.controls.loading", "Loading transition buffer…")
    public static let errorMessage = LiveControlsText(
        "debugger.controls.error.message",
        "Could not load the transition buffer."
    )
    public static let retry = LiveControlsText("debugger.controls.retry", "Retry")
    public static let stale = LiveControlsText("debugger.controls.stale", "Buffer may be out of date")
    public static let offline = LiveControlsText("debugger.controls.offline", "Offline — showing the cached buffer")
    public static let empty = LiveControlsText("debugger.controls.empty", "No transitions buffered yet")

    /// Every catalog entry — used by the keys-coverage unit test.
    public static let all: [LiveControlsText] = [
        live, freeze, stepPrev, stepNext, window, clear,
        buffered, bufferedDual, bufferedTooltip,
        window5, window10, window30, window120,
        toolbarLabel, loading, errorMessage, retry, stale, offline, empty
    ]
}

// MARK: - Label formatting (web `counterLabel` / `tooltipLabel`)

/// Builds the counter + tooltip strings so the interpolation is asserted without
/// rendering the view. Mirrors the web `counterLabel` / `tooltipLabel` derivation.
public enum LiveControlsFormat {
    /// Web `counterLabel`: the two-scope label when `prefersDualLabel`, else the
    /// legacy "{{n}} buffered". `single` / `dual` are the already-localized
    /// `printf` templates ("%1$d buffered" / "%1$d in window · %2$d in 24 h").
    public static func counterLabel(counter: LiveControlsCounter, single: String, dual: String) -> String {
        if counter.prefersDualLabel {
            return String(format: dual, counter.inWindow, counter.total)
        }
        return String(format: single, counter.inWindow)
    }

    /// Web `tooltipLabel`: the active window minutes + the count outside it.
    public static func tooltipLabel(format: String, minutes: Int, outside: Int) -> String {
        String(format: format, minutes, outside)
    }
}
