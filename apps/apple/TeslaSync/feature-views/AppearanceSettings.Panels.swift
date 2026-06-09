//
//  AppearanceSettings.Panels.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The remaining composed sections: the server-backed default-time-format and
//  chart-palette selectors (wrapped by the ADR-013 server region), and the three
//  device-local panels — the footer status bar, the achievement celebrations, and
//  the product-tour replay / reset controls. Pure functions of their inputs; copy
//  resolves through the P1/S10 facade; every toggle + button carries a VoiceOver
//  label.
//

import SwiftUI

// MARK: - Default time format (server-backed)

/// The default-time-format selector (web time-format radiogroup). Gated by the
/// server region so it shows a skeleton / empty / error while the settings
/// document loads.
struct AppearanceTimeFormatSection: View {
    let timeFormat: AppearanceTimeFormat
    let isLoaded: Bool
    let isSaving: Bool
    let phase: AppearancePhase
    let onSelect: (AppearanceTimeFormat) -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "clock",
                titleKey: "theme.timeFormat.label",
                titleFallback: "Default time format",
                helpKey: "theme.timeFormat.help",
                helpFallback: "Hover any timestamp to see the alternate format."
            )
            AppearanceServerRegion(phase: phase, onRetry: onRetry) {
                VStack(spacing: TSSpacing.md) {
                    ForEach(AppearanceSettingsAdapter.timeFormatChoices()) { choice in
                        AppearanceChoiceCard(
                            label: choice.label,
                            help: choice.help,
                            isActive: timeFormat == choice.value,
                            isDisabled: !isLoaded || isSaving,
                            action: { onSelect(choice.value) }
                        )
                    }
                }
            }
            AppearanceSettingsStrings.text(
                "theme.timeFormat.help2",
                "Override per-surface with the format prop where needed."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Chart palette (server-backed)

/// The chart-palette selector (web chart-palette radiogroup) with the swatch row
/// beneath each option. Gated by the server region.
struct AppearanceChartPaletteSection: View {
    let palette: AppearanceChartPalette
    let isLoaded: Bool
    let isSaving: Bool
    let phase: AppearancePhase
    let onSelect: (AppearanceChartPalette) -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "eye",
                titleKey: "theme.chartPalette.label",
                titleFallback: "Chart palette",
                helpKey: "theme.chartPalette.help",
                helpFallback:
                "Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users "
                    + "with red-green colour vision deficiency."
            )
            AppearanceServerRegion(phase: phase, onRetry: onRetry) {
                VStack(spacing: TSSpacing.md) {
                    ForEach(AppearanceSettingsAdapter.chartPaletteChoices()) { choice in
                        AppearanceChoiceCard(
                            label: choice.label,
                            help: choice.help,
                            isActive: palette == choice.value,
                            isDisabled: !isLoaded || isSaving,
                            leading: { EmptyView() },
                            detail: { swatchRow(choice.swatches) },
                            action: { onSelect(choice.value) }
                        )
                    }
                }
            }
            AppearanceSettingsStrings.text(
                "theme.chartPalette.help",
                "Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users "
                    + "with red-green colour vision deficiency."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func swatchRow(_ swatches: [String]) -> some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(swatches.enumerated()), id: \.offset) { _, hex in
                Circle()
                    .fill(appearanceHexColor(hex))
                    .frame(width: 12, height: 12)
                    .overlay(Circle().strokeBorder(Color.TS.border, lineWidth: 1))
            }
        }
        .padding(.top, TSSpacing.xs)
        .accessibilityHidden(true)
    }
}

// MARK: - Footer status bar (device-local)

/// The footer status-bar panel (web status-bar toggles). Two switch rows in a
/// bordered container; the icon-only row dims when the bar is hidden.
struct AppearanceStatusBarPanel: View {
    let prefs: AppearanceStatusBarPrefs
    let onSetEnabled: @MainActor (Bool) -> Void
    let onSetIconOnly: @MainActor (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "rectangle.bottomthird.inset.filled",
                titleKey: "theme.statusBar.label",
                titleFallback: "Status bar"
            )
            VStack(spacing: TSSpacing.md) {
                AppearanceToggleRow(
                    titleKey: "theme.statusBar.show", titleFallback: "Show status bar",
                    helpKey: "theme.statusBar.showHelp",
                    helpFallback: "Always-on footer with API health, live telemetry, vehicle, and version.",
                    isOn: prefs.enabled, onChange: onSetEnabled
                )
                Divider().overlay(Color.TS.border)
                AppearanceToggleRow(
                    titleKey: "theme.statusBar.iconOnly", titleFallback: "Always icon-only",
                    helpKey: "theme.statusBar.iconOnlyHelp",
                    helpFallback: "Hide labels at all widths. Otherwise the bar auto-collapses on narrow screens.",
                    isOn: prefs.iconOnly, isDimmed: !prefs.enabled, onChange: onSetIconOnly
                )
            }
            .padding(TSSpacing.md)
            .appearancePanelChrome()
        }
    }
}

// MARK: - Achievement celebrations (device-local)

/// The achievement-celebration panel (web celebration toggles). Four switch rows
/// in a bordered container, each routing through one keyed setter.
struct AppearanceCelebrationPanel: View {
    let prefs: AppearanceCelebrationPrefs
    let onChange: @MainActor (WritableKeyPath<AppearanceCelebrationPrefs, Bool>, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "trophy.fill",
                titleKey: "achievements.celebrationSettings",
                titleFallback: "Celebration"
            )
            VStack(spacing: TSSpacing.md) {
                row(
                    \.showToasts,
                    "achievements.showToasts", "Show celebration toasts",
                    "achievements.showToastsHelp",
                    "Pop a celebratory toast with confetti when you unlock an achievement."
                )
                Divider().overlay(Color.TS.border)
                row(
                    \.playSound,
                    "achievements.playSound", "Play sound on unlock",
                    "achievements.playSoundHelp",
                    "Play a short chime alongside the celebration toast. Off by default."
                )
                Divider().overlay(Color.TS.border)
                row(
                    \.showOnDashboard,
                    "achievements.showOnDashboard", "Show recently unlocked on dashboard",
                    "achievements.showOnDashboardHelp",
                    "Surface your latest unlocks in the dashboard's recently-unlocked widget."
                )
                Divider().overlay(Color.TS.border)
                row(
                    \.pushOnUnlock,
                    "achievements.pushOnUnlock", "Send push notifications for achievements",
                    "achievements.pushOnUnlockHelp",
                    "Deliver a push notification when an achievement unlocks while the app is closed."
                )
            }
            .padding(TSSpacing.md)
            .appearancePanelChrome()
        }
    }

    private func row(
        _ keyPath: WritableKeyPath<AppearanceCelebrationPrefs, Bool>,
        _ titleKey: String,
        _ titleFallback: String,
        _ helpKey: String,
        _ helpFallback: String
    ) -> some View {
        AppearanceToggleRow(
            titleKey: titleKey, titleFallback: titleFallback,
            helpKey: helpKey, helpFallback: helpFallback,
            isOn: prefs[keyPath: keyPath],
            onChange: { onChange(keyPath, $0) }
        )
    }
}

// MARK: - Product tours (device-local)

/// The product-tours panel (web tour replay + reset controls).
struct AppearanceProductToursPanel: View {
    let onStartTour: (AppearanceTour) -> Void
    let onResetTours: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "play.circle.fill",
                titleKey: "settings.tours.label",
                titleFallback: "Product tours"
            )
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    AppearanceSettingsStrings.text("settings.tours.title", "Product tours")
                        .font(Font.TS.bodySm).fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    AppearanceSettingsStrings.text(
                        "settings.tours.body",
                        "Re-run the guided walkthroughs that introduce major sections."
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                }
                FlowButtons {
                    AppearanceButton(
                        titleKey: "settings.tours.replayMain", fallback: "Replay dashboard tour",
                        variant: .primary, systemImage: "play.circle",
                        action: { onStartTour(.main) }
                    )
                    AppearanceButton(
                        titleKey: "settings.tours.replayDebugger", fallback: "Debugger tour",
                        action: { onStartTour(.debugger) }
                    )
                    AppearanceButton(
                        titleKey: "settings.tours.replayAutomations", fallback: "Automations tour",
                        action: { onStartTour(.automations) }
                    )
                    AppearanceButton(
                        titleKey: "settings.tours.resetAll", fallback: "Reset all tours",
                        variant: .danger, systemImage: "arrow.counterclockwise",
                        action: onResetTours
                    )
                }
            }
            .padding(TSSpacing.md)
            .appearancePanelChrome()
        }
    }
}

// MARK: - Shared panel chrome + wrapping button row

private struct AppearancePanelChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

extension View {
    func appearancePanelChrome() -> some View {
        modifier(AppearancePanelChrome())
    }
}

/// A simple wrapping row of action buttons (web `flex flex-wrap gap-2`), using an
/// adaptive grid so the tour buttons reflow on narrow widths.
struct FlowButtons<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.sm
        ) {
            content()
        }
    }
}
