//
//  GeneralSettings.Panels.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The non-chrome surfaces the General Settings view swaps in by render phase and
//  the two car-derived panels: the loading skeleton, the empty + error states
//  (with retry), the "Car uses … / Sync from Car" banner, and the read-only car
//  clock-format note. Pure functions of their inputs; copy resolves through the
//  P1/S10 facade and the chrome (header, banners, save bar) lives in
//  `GeneralSettings.Views.swift`.
//

import SwiftUI

// MARK: - Loading / empty / error states

/// The loading skeleton shown while the settings document resolves (web's five
/// `<Skeleton className="h-16"/>` blocks in a responsive grid).
struct SettingsLoadingChrome: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columns: Int {
            horizontalSizeClass == .compact ? 1 : 2
        }
    #else
        private var columns: Int {
            2
        }
    #endif

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: columns),
            spacing: TSSpacing.lg
        ) {
            ForEach(0 ..< 6, id: \.self) { _ in
                TSSkeleton(height: 64, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(GeneralSettingsStrings.text("state.loadingA11y", "Loading settings"))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The empty state shown when the settings endpoint returns nothing.
struct SettingsEmptyState: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "slider.horizontal.3").font(.system(size: 30)).foregroundStyle(Color.TS.textMuted)
            GeneralSettingsStrings.text("state.emptyTitle", "No settings found")
                .font(Font.TS.panel).foregroundStyle(Color.TS.textPrimary)
            GeneralSettingsStrings.text("state.emptyHint", "Your preferences haven't loaded yet.")
                .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary).multilineTextAlignment(.center)
            SettingsButton(
                titleKey: "action.retry", fallback: "Retry",
                variant: .secondary, systemImage: "arrow.clockwise", action: onRetry
            )
        }
        .frame(maxWidth: .infinity).padding(.vertical, TSSpacing.x4xl)
        .accessibilityElement(children: .combine)
    }
}

/// The error state shown when the settings load fails with no cached snapshot.
struct SettingsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 30))
                .foregroundStyle(Color.TS.statusDanger)
            GeneralSettingsStrings.text("error.loadFailed", "Failed to load settings")
                .font(Font.TS.panel).foregroundStyle(Color.TS.textPrimary)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary).multilineTextAlignment(.center)
            }
            SettingsButton(
                titleKey: "action.retry", fallback: "Retry",
                variant: .secondary, systemImage: "arrow.clockwise", action: onRetry
            )
        }
        .frame(maxWidth: .infinity).padding(.vertical, TSSpacing.x4xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Sync-from-car + car-clock panels

/// The "Car uses … / Sync from Car" panel (web sync banner), shown when the car
/// reported at least one unit.
struct SyncFromCarPanel: View {
    let preferences: CarPreferences
    let onSync: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "car.fill").font(.system(size: 18)).foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: carUses).font(Font.TS.bodySm).fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                GeneralSettingsStrings.text(
                    "app.syncHint", "Sync your app's units to match your vehicle's display settings"
                )
                .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            SettingsButton(
                titleKey: "app.syncFromCar", fallback: "Sync from Car",
                variant: .primary, systemImage: "arrow.down.circle", action: onSync
            )
        }
        .padding(TSSpacing.md)
        .background(Color.TS.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var carUses: String {
        let prefix = GeneralSettingsStrings.string("app.carUses", "Car uses")
        return "\(prefix) \(GeneralSettingsAccessibility.carUnitsSummary(preferences))"
    }
}

/// The read-only car clock-format note (web clock banner).
struct CarClockPanel: View {
    let is24Hour: Bool

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "clock").font(.system(size: 16)).foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: clockLine).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                GeneralSettingsStrings.text(
                    "app.clockFormatHint", "Your vehicle's time display preference (read-only)"
                )
                .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var clockLine: String {
        let label = GeneralSettingsStrings.string("app.carClockFormat", "Car clock format")
        return "\(label): \(GeneralSettingsAccessibility.carClockLabel(is24Hour))"
    }
}
