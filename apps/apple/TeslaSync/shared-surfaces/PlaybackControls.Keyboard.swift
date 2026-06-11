//
//  PlaybackControls.Keyboard.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The keyboard layer — the SwiftUI parity of the web `PlaybackControls` `window.keydown` handler and
//  its `useShortcut(replayShortcutDefs)` registration. Kept pure + table-driven (no giant switch) so
//  the per-key intent + toast wording is unit tested directly and the view simply forwards a decoded
//  key to `command(for:shift:)`.
//
//  Web key map reproduced verbatim:
//    Space / K → play-pause · ←/→ → seek ∓5s (Shift = ∓30s) · J/L → seek ∓10s · ,/. → step frame
//    Home/End → jump to start/end · 0–9 → jump to N×10% · +/− → speed up/down · M → reserved no-op
//

import Foundation

// MARK: - Decoded key (platform-agnostic)

/// A decoded keyboard key the view hands the resolver — kept platform-agnostic so the mapping is
/// testable without SwiftUI's `KeyPress`. The view translates `KeyPress` / hardware-keyboard input
/// into one of these.
public enum PlaybackControlsKey: Sendable, Equatable {
    case space
    case letterK
    case arrowLeft
    case arrowRight
    case letterJ
    case letterL
    case comma
    case period
    case home
    case end
    case digit(Int)
    case plus
    case minus
    case letterM
}

// MARK: - Resolved intent

/// The intent a key resolves to — dispatched by the store onto the host callbacks. `reserved` is the
/// web `M` no-op (kept explicit so the view still swallows the key, matching the web `preventDefault`).
public enum PlaybackControlsCommand: Sendable, Equatable {
    case togglePlay
    case seekBySeconds(Double)
    case stepFrame(Int)
    case seekToProgress(Double)
    case speedRelative(Int)
    case reserved
}

// MARK: - Keyboard resolver (table-driven; low cyclomatic complexity)

/// Pure key → intent + key → toast-label resolvers. Grouped into small helpers (transport / skip /
/// frame / jump / speed) so no single function exceeds the complexity budget.
public enum PlaybackControlsKeyboard {
    /// Resolves a key (with the Shift modifier) to its intent, or `nil` when the key is unbound.
    public static func command(for key: PlaybackControlsKey, shift: Bool = false) -> PlaybackControlsCommand? {
        transport(key)
            ?? skip(key, shift: shift)
            ?? frame(key)
            ?? jump(key)
            ?? speed(key)
    }

    private static func transport(_ key: PlaybackControlsKey) -> PlaybackControlsCommand? {
        switch key {
        case .space, .letterK: .togglePlay
        case .letterM: .reserved
        default: nil
        }
    }

    private static func skip(_ key: PlaybackControlsKey, shift: Bool) -> PlaybackControlsCommand? {
        let small = PlaybackControlsMeta.smallSkipSeconds
        let large = PlaybackControlsMeta.largeSkipSeconds
        let medium = PlaybackControlsMeta.mediumSkipSeconds
        switch key {
        case .arrowLeft: return .seekBySeconds(shift ? -large : -small)
        case .arrowRight: return .seekBySeconds(shift ? large : small)
        case .letterJ: return .seekBySeconds(-medium)
        case .letterL: return .seekBySeconds(medium)
        default: return nil
        }
    }

    private static func frame(_ key: PlaybackControlsKey) -> PlaybackControlsCommand? {
        switch key {
        case .comma: .stepFrame(-1)
        case .period: .stepFrame(1)
        default: nil
        }
    }

    private static func jump(_ key: PlaybackControlsKey) -> PlaybackControlsCommand? {
        switch key {
        case .home: .seekToProgress(0)
        case .end: .seekToProgress(1)
        case let .digit(value): .seekToProgress(Double(max(0, min(9, value))) / 10)
        default: nil
        }
    }

    private static func speed(_ key: PlaybackControlsKey) -> PlaybackControlsCommand? {
        switch key {
        case .plus: .speedRelative(1)
        case .minus: .speedRelative(-1)
        default: nil
        }
    }
}

// MARK: - Toast wording (web inline `showShortcutToast` strings)

public extension PlaybackControlsKeyboard {
    /// The toast label for a key — the parity of the per-key `showShortcutToast(...)` call. `nil`
    /// suppresses the toast (the web `M` key shows none). `isPlaying` is read BEFORE the toggle so
    /// pressing Space while playing reads "Pause" (matching the web).
    static func toastLabel(
        for key: PlaybackControlsKey,
        shift: Bool,
        isPlaying: Bool,
        strings: PlaybackControlsResolve
    ) -> String? {
        toastTransport(key, isPlaying: isPlaying, strings: strings)
            ?? toastSkip(key, shift: shift, strings: strings)
            ?? toastFrameJump(key, strings: strings)
            ?? toastSpeedDigit(key, strings: strings)
    }

    private static func toastTransport(
        _ key: PlaybackControlsKey,
        isPlaying: Bool,
        strings: PlaybackControlsResolve
    ) -> String? {
        switch key {
        case .space, .letterK:
            let pauseKey = isPlaying ? "replay.shortcuts.pause" : "replay.shortcuts.play"
            let fallback = isPlaying ? "Pause" : "Play"
            return strings(pauseKey, fallback)
        default:
            return nil
        }
    }

    private static func toastSkip(
        _ key: PlaybackControlsKey,
        shift: Bool,
        strings: PlaybackControlsResolve
    ) -> String? {
        switch key {
        case .arrowLeft:
            let backKey = shift ? "replay.toast.back30" : "replay.toast.back5"
            let fallback = shift ? "⏪ −30s" : "⏪ −5s"
            return strings(backKey, fallback)
        case .arrowRight:
            let fwdKey = shift ? "replay.toast.fwd30" : "replay.toast.fwd5"
            let fallback = shift ? "⏩ +30s" : "⏩ +5s"
            return strings(fwdKey, fallback)
        case .letterJ:
            return strings("replay.toast.back10", "⏪ −10s")
        case .letterL:
            return strings("replay.toast.fwd10", "⏩ +10s")
        default:
            return nil
        }
    }

    private static func toastFrameJump(
        _ key: PlaybackControlsKey,
        strings: PlaybackControlsResolve
    ) -> String? {
        switch key {
        case .comma: strings("replay.shortcuts.prevFrame", "⏮ frame")
        case .period: strings("replay.shortcuts.nextFrame", "⏭ frame")
        case .home: strings("replay.shortcuts.start", "⏮ start")
        case .end: strings("replay.shortcuts.end", "⏭ end")
        default: nil
        }
    }

    private static func toastSpeedDigit(
        _ key: PlaybackControlsKey,
        strings: PlaybackControlsResolve
    ) -> String? {
        switch key {
        case .plus: strings("replay.shortcuts.speedUp", "Faster")
        case .minus: strings("replay.shortcuts.speedDown", "Slower")
        case let .digit(value): "\(max(0, min(9, value)) * 10)%"
        default: nil
        }
    }
}

// MARK: - Cheatsheet (web help tooltip + `useShortcut` defs)

/// One cheatsheet row — the native union of the web help-tooltip grid row and a `useShortcut`
/// definition. `keyCap` is the human display ("← / →"); `keys` is the token list registered with the
/// global overlay; `description` + `group` are localized.
public struct PlaybackControlsShortcut: Sendable, Equatable, Identifiable {
    public let id: String
    public let keys: [String]
    public let keyCap: String
    public let description: String
    public let group: String

    public init(id: String, keys: [String], keyCap: String, description: String, group: String) {
        self.id = id
        self.keys = keys
        self.keyCap = keyCap
        self.description = description
        self.group = group
    }
}

/// One row of cheatsheet seed data — a named struct (not a tuple) so it stays within the lint budget.
private struct PlaybackControlsCheatsheetSeed {
    let id: String
    let keys: [String]
    let cap: String
    let key: String
    let fallback: String
}

public extension PlaybackControlsKeyboard {
    /// Builds the localized cheatsheet — the seven rows the web help tooltip lists and the web
    /// `replayShortcutDefs` registers. Empty list when shortcuts are disabled (web returns `[]`).
    static func cheatsheet(
        enabled: Bool,
        strings: PlaybackControlsResolve
    ) -> [PlaybackControlsShortcut] {
        guard enabled else { return [] }
        let group = strings("shortcuts.groups.replay", "Trip replay")
        return cheatsheetSeeds.map { seed in
            PlaybackControlsShortcut(
                id: "replay.scrubber.\(seed.id)",
                keys: seed.keys,
                keyCap: seed.cap,
                description: strings(seed.key, seed.fallback),
                group: group
            )
        }
    }

    private static var cheatsheetSeeds: [PlaybackControlsCheatsheetSeed] {
        [
            PlaybackControlsCheatsheetSeed(
                id: "playPause", keys: ["Space", "K"], cap: "Space / K",
                key: "replay.shortcuts.playPause", fallback: "Play / Pause"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "skip5", keys: ["←", "→"], cap: "← / →",
                key: "replay.shortcuts.skip5", fallback: "Skip ±5s (Shift = ±30s)"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "skip10", keys: ["J", "L"], cap: "J / L",
                key: "replay.shortcuts.skip10", fallback: "Skip ±10s"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "frame", keys: [",", "."], cap: ", / .",
                key: "replay.shortcuts.frame", fallback: "Previous / next frame"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "startEnd", keys: ["Home", "End"], cap: "Home / End",
                key: "replay.shortcuts.startEnd", fallback: "Jump to start / end"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "percent", keys: ["0", "9"], cap: "0 – 9",
                key: "replay.shortcuts.percent", fallback: "Jump to N×10%"
            ),
            PlaybackControlsCheatsheetSeed(
                id: "speed", keys: ["+", "−"], cap: "+ / −",
                key: "replay.shortcuts.speed", fallback: "Speed up / slow down"
            )
        ]
    }
}
