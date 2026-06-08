//
//  KioskOverlay.swift
//  TeslaSync — P4 feature view · 0124 · KioskOverlay (Apple)
//
//  Native, Apple-idiomatic parity of the web `KioskOverlay`
//  (web/src/features/dashboard/components/KioskOverlay.tsx).
//
//  A full-bleed kiosk chrome overlay composited over the rotating dashboard. It is
//  purely presentational — it receives `config` + flags as inputs and fetches
//  nothing — so it reproduces, in full, every render branch the web source carries:
//
//    • a non-interactive dim layer (`isDimmed`, opacity `1 - dimLevel`),
//    • macOS pointer hiding (`isCursorHidden`; a no-op on touch platforms),
//    • a corner clock that ticks each second (`showClock` / `clockPosition`),
//    • a dashboard-rotation indicator (`dashboardCount > 1 && rotateInterval > 0`),
//    • an exit control that reveals on interaction and auto-hides after 3s.
//
//  The loading / empty / error / stale / offline states belong to the embedding
//  Kiosk page (the web source has no data lifecycle of its own); the render
//  decisions here are projected by ``KioskOverlayPresentation`` and unit-tested.
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with
//  ``KioskOverlaySurface/slug``.
//

import SwiftUI
#if os(macOS)
    import AppKit
#endif

// MARK: - KioskOverlay (the feature surface)

/// The kiosk chrome overlay. Bind `config` + the live flags the kiosk engine owns
/// (`isDimmed`, `isCursorHidden`, `dashboardCount`, `currentIndex`) and an `onExit`
/// callback; every visual decision is derived by ``KioskOverlayPresentation``.
public struct KioskOverlay: View {
    private let presentation: KioskOverlayPresentation
    private let onExit: () -> Void
    private let telemetry: any KioskOverlayTelemetry

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    @State private var isExitRevealed: Bool
    @State private var interactionToken = 0

    /// Designated initialiser.
    /// - Parameters:
    ///   - config: the overlay-relevant slice of the kiosk config (web `config`).
    ///   - isDimmed: web `isDimmed` — gates the dim layer.
    ///   - isCursorHidden: web `isCursorHidden` — hides the macOS pointer.
    ///   - dashboardCount: web `dashboardCount` — rotation-dot count.
    ///   - currentIndex: web `currentIndex` — active rotation dot.
    ///   - onExit: web `onExit` — invoked by the exit control.
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        config: KioskOverlayConfig,
        isDimmed: Bool,
        isCursorHidden: Bool,
        dashboardCount: Int,
        currentIndex: Int,
        onExit: @escaping () -> Void,
        telemetry: any KioskOverlayTelemetry = OSLogKioskOverlayTelemetry()
    ) {
        self.init(
            presentation: KioskOverlayPresentation(
                config: config,
                isDimmed: isDimmed,
                isCursorHidden: isCursorHidden,
                dashboardCount: dashboardCount,
                currentIndex: currentIndex
            ),
            onExit: onExit,
            telemetry: telemetry
        )
    }

    /// Projection-based initialiser. Used by the public initialiser, previews, and
    /// tests; `exitInitiallyRevealed` lets previews show the exit chip without
    /// simulating an interaction.
    init(
        presentation: KioskOverlayPresentation,
        onExit: @escaping () -> Void,
        telemetry: any KioskOverlayTelemetry = OSLogKioskOverlayTelemetry(),
        exitInitiallyRevealed: Bool = false
    ) {
        self.presentation = presentation
        self.onExit = onExit
        self.telemetry = telemetry
        _isExitRevealed = State(initialValue: exitInitiallyRevealed)
    }

    public var body: some View {
        ZStack {
            interactionSensor
            if presentation.isDimmed { dimLayer }
            if presentation.showsClock { clockLayer }
            if presentation.showsRotationIndicator { rotationIndicator }
            exitControl
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .kioskPointerHidden(presentation.hidesPointer)
        .task(id: interactionToken) { await autoHideExitAfterDelay() }
        .task { KioskOverlaySurface.reportOpen(to: telemetry) }
    }

    // MARK: Interaction sensor (web passive mousemove / touchstart listeners)

    /// A full-bleed, hit-testable transparent layer that reveals the exit control on
    /// any tap or pointer entry — the native analogue of the web's passive
    /// `mousemove` / `touchstart` listeners (SwiftUI has no passive global pointer
    /// observers, so the overlay owns the interaction surface in kiosk mode).
    private var interactionSensor: some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture { revealExit() }
            .onHover { hovering in if hovering { revealExit() } }
            .accessibilityHidden(true)
    }

    // MARK: Dim layer (web `bg-black` at `opacity: 1 - dimLevel`)

    private var dimLayer: some View {
        Color.black
            .opacity(presentation.dimOpacity)
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: Clock (web `formatTime` + `formatDateWithDay`, ticking each second)

    private var clockLayer: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: presentation.clockPosition.horizontalAlignment, spacing: TSSpacing.xs) {
                Text(verbatim: KioskClock.formatTime(context.date))
                    .font(.system(size: 24, weight: .regular, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: KioskClock.formatDateWithDay(context.date))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(clockAccessibilityLabel(at: context.date))
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: presentation.clockPosition.alignment)
        .allowsHitTesting(false)
    }

    // MARK: Rotation indicator (web indicator dots)

    private var rotationIndicator: some View {
        HStack(spacing: TSSpacing.xs + 2) {
            ForEach(presentation.dotIndices, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(Color.TS.surface)
                    .frame(width: presentation.isActiveDot(index) ? 24 : 6, height: 6)
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration),
                        value: presentation.isActiveDot(index)
                    )
            }
        }
        .padding(.bottom, TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rotationAccessibilityLabel)
    }

    // MARK: Exit control (web ghost `Button`, glass chip, reveal/auto-hide)

    private var exitControl: some View {
        TSButton(variant: .ghost, size: .small, action: handleExit) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                KioskOverlayStrings.text("kiosk.exitLabel", "Exit Kiosk")
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .opacity(isExitVisible ? 1 : 0)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration), value: isExitVisible)
        .accessibilityLabel(Text(verbatim: KioskOverlayStrings.string("kiosk.exit", "Exit kiosk mode")))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: Derived state + actions

    /// The exit chip is visible while revealed, and is always visible (and
    /// focusable) while VoiceOver is running so it can never become unreachable.
    private var isExitVisible: Bool {
        isExitRevealed || voiceOverEnabled
    }

    private func handleExit() {
        revealExit()
        onExit()
    }

    /// Reveals the exit chip and restarts the auto-hide window by bumping the
    /// interaction token (which re-triggers the `.task(id:)` timer).
    private func revealExit() {
        isExitRevealed = true
        interactionToken &+= 1
    }

    /// Auto-hides the exit chip ``KioskOverlayExit/autoHideDelay`` after the latest
    /// interaction (web `setTimeout(() => setShowExit(false), 3000)`). Re-run on
    /// every `interactionToken` change; the prior run is cancelled by SwiftUI.
    private func autoHideExitAfterDelay() async {
        guard isExitRevealed else { return }
        try? await Task.sleep(for: KioskOverlayExit.autoHideDelay)
        guard !Task.isCancelled else { return }
        isExitRevealed = false
    }

    private func clockAccessibilityLabel(at date: Date) -> Text {
        let label = KioskOverlayStrings.string("kiosk.clock.a11y", "Time %1$@, %2$@")
        let value = String(
            format: label,
            KioskClock.formatTime(date),
            KioskClock.formatDateWithDay(date)
        )
        return Text(verbatim: value)
    }

    private var rotationAccessibilityLabel: Text {
        let count = presentation.dashboardCount
        let position = Swift.min(Swift.max(presentation.currentIndex + 1, 1), Swift.max(count, 1))
        let label = KioskOverlayStrings.string("kiosk.rotation.a11y", "Dashboard %1$lld of %2$lld")
        return Text(verbatim: String(format: label, position, count))
    }
}

// MARK: - Pointer hiding (web `cursor: none`)

private extension View {
    /// Hides the system pointer while `hidden` is true and the pointer is over the
    /// overlay — the native parity of the web `cursor: none` injection. macOS-only:
    /// touch platforms have no system pointer, so this is a correct no-op there.
    @ViewBuilder
    func kioskPointerHidden(_ hidden: Bool) -> some View {
        #if os(macOS)
            onHover { hovering in
                guard hidden else { return }
                if hovering {
                    NSCursor.hide()
                } else {
                    NSCursor.unhide()
                }
            }
            .onDisappear {
                if hidden { NSCursor.unhide() }
            }
        #else
            self
        #endif
    }
}
