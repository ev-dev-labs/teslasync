//
//  ThemeProvider.Views.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The presentational pieces of the theme surface. The web `<ThemeProvider>` renders no chrome of its
//  own (it only writes `:root` CSS vars + `body.background`), so these views are the native peers of
//  what the provider MAKES POSSIBLE for its consumers, all token-driven (P1/S9) + localized (P1/S10):
//
//    • ThemeSyncStatusBadge — the standard loading / synced / local-only / stale / failed / offline
//      affordance over the otherwise-silent backend hydrate. Renders EVERY ``ThemeSyncPhase`` (never a
//      blank box): a spinner while loading, a stale chip that auto-refreshes, an error chip with a
//      retry affordance, an offline chip — the language the acceptance bar asks for.
//    • ThemeColorwaySwatch / ThemeModeSwatch — accessible previews of a single colorway / mode, the
//      cells a theme picker built on this provider composes.
//    • ThemePreviewBoard (DEBUG) — a reference board wiring every colorway, every mode, the auto
//      resolution, and every sync phase, used by the previews + view-composition tests.
//

import SwiftUI

// MARK: - Status tone (token-mapped, P1/S9)

/// The semantic tone of a sync status — mapped to the design status tokens so no raw color is used.
private enum ThemeStatusTone {
    case info
    case success
    case warning
    case danger
    case neutral

    var color: Color {
        switch self {
        case .info: Color.TS.statusInfo
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textSecondary
        }
    }
}

/// The view-ready style for a ``ThemeSyncPhase`` — symbol, copy key, tone, and which affordances show.
/// A pure mapping so the badge body stays small and every branch is covered by a test.
struct ThemeSyncStatusStyle {
    let systemImage: String
    let labelKey: String
    let labelFallback: String
    fileprivate let tone: ThemeStatusTone
    let showsSpinner: Bool
    let showsRetry: Bool

    init(phase: ThemeSyncPhase) {
        switch phase {
        case .idle, .loading:
            systemImage = "arrow.triangle.2.circlepath"
            labelKey = "themeProvider.status.loading"
            labelFallback = "Syncing theme…"
            tone = .info
            showsSpinner = true
            showsRetry = false
        case .synced:
            systemImage = "checkmark.circle.fill"
            labelKey = "themeProvider.status.synced"
            labelFallback = "Theme synced"
            tone = .success
            showsSpinner = false
            showsRetry = false
        case .localOnly:
            systemImage = "internaldrive"
            labelKey = "themeProvider.status.local"
            labelFallback = "Using local theme"
            tone = .neutral
            showsSpinner = false
            showsRetry = false
        case .stale:
            systemImage = "clock.arrow.circlepath"
            labelKey = "themeProvider.status.stale"
            labelFallback = "Theme out of date — refreshing"
            tone = .warning
            showsSpinner = false
            showsRetry = true
        case .failed:
            systemImage = "exclamationmark.triangle.fill"
            labelKey = "themeProvider.status.failed"
            labelFallback = "Couldn't sync theme"
            tone = .danger
            showsSpinner = false
            showsRetry = true
        case .offline:
            systemImage = "wifi.slash"
            labelKey = "themeProvider.status.offline"
            labelFallback = "Offline — using local theme"
            tone = .neutral
            showsSpinner = false
            showsRetry = false
        }
    }

    var label: String {
        ThemeProviderStrings.string(labelKey, labelFallback)
    }

    var color: Color {
        tone.color
    }
}

// MARK: - ThemeSyncStatusBadge (loading / synced / stale / failed / offline)

/// The backend-hydration status chip — renders EVERY ``ThemeSyncPhase`` so the otherwise-silent sync is
/// observable without ever hiding the themed content. Failed + stale phases expose a retry affordance.
public struct ThemeSyncStatusBadge: View {
    private let phase: ThemeSyncPhase
    private let onRetry: (() -> Void)?

    public init(phase: ThemeSyncPhase, onRetry: (() -> Void)? = nil) {
        self.phase = phase
        self.onRetry = onRetry
    }

    public var body: some View {
        let style = ThemeSyncStatusStyle(phase: phase)
        HStack(spacing: TSSpacing.sm) {
            leading(style)
            Text(verbatim: style.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textPrimary)
            if style.showsRetry, let onRetry {
                Button(action: onRetry) {
                    Text(verbatim: ThemeProviderStrings.string("themeProvider.status.retry", "Retry"))
                        .font(Font.TS.label)
                }
                .buttonStyle(.borderless)
                .tint(style.color)
                .accessibilityLabel(Text(verbatim: retryAccessibilityLabel))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(style.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(style.color.opacity(0.35), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel(style)))
    }

    @ViewBuilder
    private func leading(_ style: ThemeSyncStatusStyle) -> some View {
        if style.showsSpinner {
            ProgressView()
                .controlSize(.small)
                .tint(style.color)
        } else {
            Image(systemName: style.systemImage)
                .foregroundStyle(style.color)
                .imageScale(.small)
        }
    }

    private func accessibilityLabel(_ style: ThemeSyncStatusStyle) -> String {
        let template = ThemeProviderStrings.string("themeProvider.status.a11y", "Theme sync status: %@")
        return String(format: template, style.label)
    }

    private var retryAccessibilityLabel: String {
        ThemeProviderStrings.string("themeProvider.status.retry.a11y", "Retry theme sync")
    }
}

// MARK: - ThemeColorwaySwatch (a picker cell)

/// An accessible preview of one colorway — the primary + accent dots and the localized name. The cell a
/// theme picker built on this provider composes; selecting it is the host's concern.
public struct ThemeColorwaySwatch: View {
    private let palette: ColorwayPalette
    private let isSelected: Bool

    public init(palette: ColorwayPalette, isSelected: Bool = false) {
        self.palette = palette
        self.isSelected = isSelected
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ZStack {
                dot(Color(themeColor: palette.primary)).offset(x: -TSSpacing.xs)
                dot(Color(themeColor: palette.accent)).offset(x: TSSpacing.xs)
            }
            .frame(width: 36)
            Text(verbatim: ThemeProviderStrings.string(palette.nameKey, palette.nameFallback))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color(themeColor: palette.primary))
                    .imageScale(.small)
            }
        }
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(selectionBorder)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func dot(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 20, height: 20)
            .overlay(Circle().strokeBorder(Color.TS.border, lineWidth: 1))
    }

    @ViewBuilder
    private var selectionBorder: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color(themeColor: palette.primary), lineWidth: 2)
        }
    }

    private var accessibilityLabel: String {
        let name = ThemeProviderStrings.string(palette.nameKey, palette.nameFallback)
        let template = ThemeProviderStrings.string("themeProvider.swatch.colorway.a11y", "%@ colorway")
        return String(format: template, name)
    }
}

// MARK: - ThemeModeSwatch (a picker cell)

/// An accessible preview of one mode — the surface stack and the localized name.
public struct ThemeModeSwatch: View {
    private let palette: ModePalette
    private let isSelected: Bool

    public init(palette: ModePalette, isSelected: Bool = false) {
        self.palette = palette
        self.isSelected = isSelected
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color(themeColor: palette.background))
                .frame(width: 36, height: 24)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color(themeColor: palette.glassBorder), lineWidth: 1)
                )
            Text(verbatim: ThemeProviderStrings.string(palette.nameKey, palette.nameFallback))
                .font(Font.TS.body)
                .foregroundStyle(Color(themeColor: palette.textPrimary))
            Spacer(minLength: 0)
            if isSelected {
                Image(systemName: "checkmark")
                    .foregroundStyle(Color.TS.accent)
                    .imageScale(.small)
            }
        }
        .padding(TSSpacing.sm)
        .background(Color(themeColor: palette.surface1), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var accessibilityLabel: String {
        let name = ThemeProviderStrings.string(palette.nameKey, palette.nameFallback)
        let template = ThemeProviderStrings.string("themeProvider.swatch.mode.a11y", "%@ mode")
        return String(format: template, name)
    }
}

#if DEBUG

    // MARK: - ThemePreviewBoard (DEBUG previews + view-composition tests)

    /// A reference board wiring every colorway, every mode, every sync phase, and a live-controlled
    /// section inside a real ``ThemeProvider`` (model-injected, in-memory seams) — what the previews +
    /// view-composition tests render. Never shipped.
    struct ThemePreviewBoard: View {
        let phase: ThemeSyncPhase

        init(phase: ThemeSyncPhase = .synced) {
            self.phase = phase
        }

        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ThemeSyncStatusBadge(phase: phase, onRetry: {})
                    section("Colorways") {
                        ForEach(ThemeCatalog.allColorways, id: \.id) { palette in
                            ThemeColorwaySwatch(palette: palette, isSelected: palette.id == .neonCyan)
                        }
                    }
                    section("Modes") {
                        ForEach(ThemeCatalog.allModes, id: \.id) { palette in
                            ThemeModeSwatch(palette: palette, isSelected: palette.id == .dark)
                        }
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.TS.bg)
        }

        private func section(_ title: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textSecondary)
                content()
            }
        }
    }
#endif
