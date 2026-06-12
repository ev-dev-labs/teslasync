//
//  StatusBar.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The SwiftUI surface — the parity of components/layout/StatusBar.tsx: an always-on footer pinned to the
//  bottom of the window with two consolidated groups — the leading group (Connection · divider · Live
//  telemetry) and the trailing group (Background work · Active vehicle · divider · Help · divider · Version)
//  — plus the orthogonal offline / stale / error chips the P4 states contract adds. The bar is hidden
//  entirely when the user disables it (web `!prefs.enabled` → `return null`) and collapses to its dense
//  icon-only variant when `compact`, the icon-only preference, or a narrow width applies
//  (web `compact || prefs.iconOnly || isNarrow`).
//
//  All logic lives in the pure projection behind ``StatusBarModel``; this view is a pure function of
//  `model.presentation`. No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9), copy
//  resolves through P1/S10, and the footer carries the localized `status` accessibility label
//  (web `role="status" aria-live="polite"`).
//

import SwiftUI

// MARK: - StatusBar (web `<StatusBar>`)

/// The always-on footer status bar. Owns a ``StatusBarModel`` (the prefs + per-segment data + the resolved
/// presentation) and renders the two segment groups, the state chips, and the loading skeleton. Reading
/// `model.presentation` registers SwiftUI observation, so the bar redraws when the prefs, the viewport, or
/// any segment's data changes.
public struct StatusBar: View {
    @State private var model: StatusBarModel
    @State private var showingVersionSheet = false
    @State private var showingVehicleSwitcher = false
    @State private var showingJobs = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Production initializer — binds the per-segment input, the persisted-prefs store (P1/S8), the
    /// telemetry sink (P1/S11), and the bound command intents.
    public init(
        input: StatusBarInput,
        telemetry: any StatusBarTelemetry = OSLogStatusBarTelemetry(),
        localize: @escaping StatusBarLocalize = StatusBarStrings.localize,
        prefsStore: any StatusBarPrefsStore = UserDefaultsStatusBarPrefsStore(),
        commands: StatusBarCommands = .noop
    ) {
        _model = State(initialValue: StatusBarModel(
            input: input,
            telemetry: telemetry,
            localize: localize,
            prefsStore: prefsStore,
            commands: commands
        ))
    }

    /// Model-injecting initializer — used by previews + tests that drive a spy telemetry / fixed input.
    public init(model: StatusBarModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.presentation.isHidden {
                // Web `!prefs.enabled` → `return null`: the user turned the bar off.
                EmptyView()
            } else {
                bar
            }
        }
        .onAppear { model.start() }
    }

    // MARK: Bar chrome

    private var bar: some View {
        HStack(spacing: TSSpacing.sm) {
            if model.presentation.phase == .loading {
                StatusBarLoadingChrome(iconOnly: model.presentation.iconOnly, reduceMotion: reduceMotion)
            } else {
                leadingGroup
            }
            Spacer(minLength: TSSpacing.sm)
            trailingGroup
        }
        .padding(.horizontal, TSSpacing.md)
        .frame(height: barHeight)
        .frame(maxWidth: .infinity)
        .background(Color.TS.surfaceGlass)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.presentation.accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// 28pt by default, 24pt in the dense icon-only variant — web `h-7` / `h-6`.
    private var barHeight: CGFloat {
        model.presentation.iconOnly ? 24 : 28
    }

    // MARK: Leading group (Connection · divider · Live + state chips)

    private var leadingGroup: some View {
        HStack(spacing: TSSpacing.xs) {
            StatusBarConnectionView(
                vm: model.presentation.connection,
                iconOnly: model.presentation.iconOnly,
                onOpen: { model.openSystemStatus() }
            )
            StatusBarDivider()
            StatusBarLiveView(
                vm: model.presentation.live,
                iconOnly: model.presentation.iconOnly,
                reduceMotion: reduceMotion,
                onOpen: { model.openLiveExplorer() }
            )
            StatusBarStateChips(
                presentation: model.presentation,
                onRetry: { model.retry() }
            )
        }
    }

    // MARK: Trailing group (Background · Vehicle · divider · Help · divider · Version)

    private var trailingGroup: some View {
        HStack(spacing: TSSpacing.xs) {
            if model.presentation.phase == .ready, model.presentation.background.isVisible {
                StatusBarBackgroundView(
                    vm: model.presentation.background,
                    iconOnly: model.presentation.iconOnly,
                    isPresented: $showingJobs
                )
            }
            if model.presentation.phase == .ready, model.presentation.vehicle.mode != .hidden {
                StatusBarVehicleView(
                    vm: model.presentation.vehicle,
                    iconOnly: model.presentation.iconOnly,
                    isPresented: $showingVehicleSwitcher,
                    onSelect: { model.selectVehicle($0) }
                )
            }
            StatusBarDivider()
            StatusBarHelpView(
                vm: model.presentation.help,
                iconOnly: model.presentation.iconOnly,
                onShortcuts: { model.openShortcuts() },
                onTour: { model.openTour() },
                onFeedback: { model.openFeedback() }
            )
            StatusBarDivider()
            StatusBarVersionView(
                vm: model.presentation.version,
                iconOnly: model.presentation.iconOnly,
                isPresented: $showingVersionSheet,
                onChangelog: { model.openChangelog() },
                onReleaseNotes: { model.openReleaseNotes() }
            )
        }
    }
}

// MARK: - StatusBarDivider (web `<Divider>`)

/// The 12pt hairline divider between segments — web `<span class="h-3 w-px bg-white/[0.08]">`.
public struct StatusBarDivider: View {
    public init() {}

    public var body: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(width: 1, height: 12)
            .accessibilityHidden(true)
    }
}
