//
//  PlaybackControls.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The trip-replay transport bar surface — the SwiftUI parity of
//  `web/src/components/data-display/PlaybackControls.tsx`. The web component is a CONTROLLED bar: the
//  host owns the playback state and the bar calls back through `onPlay / onPause / onStop /
//  onSpeedChange / onSeek` (+ the keyboard-only `onSeekBy / onSpeedRelative / onStepFrame`). It
//  composes a Reset / Play-Pause / Stop trio, a `PlaybackSpeedMenu` ({1,10,25,50,100}×), a
//  `TimelineScrubber` (marker ticks + hover/drag preview), a time readout, an optional keyboard layer
//  (Space/K, ←/→, J/L, ,/., Home/End, 0–9, +/−) with a transient toast + a help cheatsheet, and a
//  `useShortcut` registration of that cheatsheet.
//
//  The native surface keeps that composition as the `content` phase and binds it through
//  `PlaybackControlsModel` (P1/S8) — no networking lives here — rendering every state so the surface
//  never collapses to a blank box: loading (skeleton bar), empty (nothing to replay), error (retry),
//  content (the bar), and the orthogonal stale / offline freshness chip with a one-shot auto-refresh.
//

import SwiftUI

/// The trip-replay transport bar surface. Renders every state plus the P4 leaf freshness states,
/// binding through `PlaybackControlsModel`.
public struct PlaybackControls: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PlaybackControlsMeta.surfaceSlug

    @State private var model: PlaybackControlsModel
    private let preview: (@MainActor (Double) -> PlaybackControlsPreview?)?

    /// Designated initializer — adopts a fully-formed model (a spy source / telemetry in tests, the
    /// production source in the app) and an optional scrub-preview sampler (web `getPreviewAt`).
    public init(
        model: PlaybackControlsModel,
        preview: (@MainActor (Double) -> PlaybackControlsPreview?)? = nil
    ) {
        _model = State(initialValue: model)
        self.preview = preview
    }

    /// Convenience initializer mirroring the web controlled-prop signature — seeds a live source with
    /// the host snapshot + binds the host's transport callbacks. The host pushes further snapshots as
    /// the playback state changes.
    public init(
        input: PlaybackControlsInput,
        actions: PlaybackControlsActions = PlaybackControlsActions(),
        telemetry: any PlaybackControlsTelemetry = OSLogPlaybackControlsTelemetry(),
        registry: any PlaybackControlsShortcutRegistry = NoopPlaybackControlsShortcutRegistry(),
        preview: (@MainActor (Double) -> PlaybackControlsPreview?)? = nil
    ) {
        let source = LivePlaybackControlsSource(snapshot: input)
        _model = State(initialValue: PlaybackControlsModel(
            source: source,
            actions: actions,
            telemetry: telemetry,
            registry: registry
        ))
        self.preview = preview
    }

    public var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                phaseContent
                freshnessRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .topTrailing) { toastOverlay }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .modifier(PlaybackControlsKeyHandling(model: model, enabled: model.resolved.enableKeyboardShortcuts))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.resolved.phase {
        case .loading:
            PlaybackControlsLoadingView()
        case .empty:
            PlaybackControlsEmptyView()
        case let .error(message):
            PlaybackControlsErrorView(message: message) { model.refresh() }
        case .content:
            PlaybackControlsBarView(model: model, preview: preview)
        }
    }

    @ViewBuilder
    private var freshnessRow: some View {
        if model.connection != .live {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                PlaybackControlsFreshnessChip(connection: model.connection) { model.refresh() }
            }
        }
    }

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            PlaybackControlsToastView(toast: toast)
                .padding(.trailing, TSSpacing.md)
                .offset(y: -TSSpacing.x2xl)
                .transition(.opacity)
        }
    }
}

// MARK: - Keyboard handling (web `window.keydown`)

/// Attaches the keyboard layer when shortcuts are enabled: makes the bar focusable and decodes each
/// key press into the model's `perform(key:shift:)`. A press that maps to no binding is left for the
/// system (`.ignored`), matching the web handler's early returns.
private struct PlaybackControlsKeyHandling: ViewModifier {
    let model: PlaybackControlsModel
    let enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content
                .focusable()
                .onKeyPress { press in
                    guard let decoded = PlaybackControlsKeyDecoder.decode(press) else {
                        return .ignored
                    }
                    model.perform(key: decoded.key, shift: decoded.shift)
                    return .handled
                }
        } else {
            content
        }
    }
}

/// Decodes a SwiftUI `KeyPress` into a platform-agnostic `PlaybackControlsKey` (+ the Shift flag).
/// Skips any press carrying Command / Control / Option so app shortcuts (e.g. ⌘K) pass through,
/// mirroring the web `if (e.ctrlKey || e.metaKey || e.altKey) return;` guard.
enum PlaybackControlsKeyDecoder {
    static func decode(_ press: KeyPress) -> (key: PlaybackControlsKey, shift: Bool)? {
        let modifiers = press.modifiers
        if modifiers.contains(.command) || modifiers.contains(.control) || modifiers.contains(.option) {
            return nil
        }
        let shift = modifiers.contains(.shift)
        if let navigation = navigationKey(press.key) {
            return (navigation, shift)
        }
        if let printable = printableKey(press.characters) {
            return (printable, shift)
        }
        return nil
    }

    private static func navigationKey(_ key: KeyEquivalent) -> PlaybackControlsKey? {
        let character = key.character
        if character == " " { return .space }
        if character == KeyEquivalent.leftArrow.character { return .arrowLeft }
        if character == KeyEquivalent.rightArrow.character { return .arrowRight }
        if character == KeyEquivalent.home.character { return .home }
        if character == KeyEquivalent.end.character { return .end }
        return nil
    }

    private static func printableKey(_ characters: String) -> PlaybackControlsKey? {
        guard let character = characters.first else { return nil }
        if character.isNumber, let digit = character.wholeNumberValue, (0 ... 9).contains(digit) {
            return .digit(digit)
        }
        return symbolOrLetter(Character(character.lowercased()))
    }

    private static func symbolOrLetter(_ character: Character) -> PlaybackControlsKey? {
        switch character {
        case "k": .letterK
        case "j": .letterJ
        case "l": .letterL
        case "m": .letterM
        case ",": .comma
        case ".": .period
        case "+", "=": .plus
        case "-", "_": .minus
        case " ": .space
        default: nil
        }
    }
}
