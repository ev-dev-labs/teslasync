//
//  ThemeProvider.Previews.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  Xcode previews for every real branch of the theme surface: the reference board (every colorway,
//  every mode), each sync phase (loading / synced / local-only / stale / failed / offline), a live
//  ThemeProvider driving themed content (model-injected, in-memory seams), and the auto-mode resolution
//  against a forced light/dark environment. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    @MainActor
    private func previewModel(
        selection: ThemeSelection = .default,
        result: ThemeRemoteResult = .empty,
        systemPrefersDark: Bool = true
    ) -> ThemeProviderModel {
        ThemeProviderModel(
            persistence: InMemoryThemePersistence(seed: selection),
            remote: StaticThemeRemoteGateway(result: result),
            broadcaster: NoopThemeBroadcaster(),
            telemetry: OSLogThemeProviderTelemetry(),
            systemPrefersDark: systemPrefersDark
        )
    }

    #Preview("Board · all colorways + modes") {
        ThemePreviewBoard(phase: .synced)
    }

    #Preview("Sync · loading") {
        staged("phase = loading") {
            ThemeSyncStatusBadge(phase: .loading)
        }
    }

    #Preview("Sync · stale (auto-refresh + retry)") {
        staged("phase = stale") {
            ThemeSyncStatusBadge(phase: .stale, onRetry: {})
        }
    }

    #Preview("Sync · failed (retry)") {
        staged("phase = failed") {
            ThemeSyncStatusBadge(phase: .failed, onRetry: {})
        }
    }

    #Preview("Sync · offline") {
        staged("phase = offline") {
            ThemeSyncStatusBadge(phase: .offline)
        }
    }

    #Preview("Sync · local-only") {
        staged("phase = localOnly") {
            ThemeSyncStatusBadge(phase: .localOnly)
        }
    }

    #Preview("Provider · tesla-red / midnight") {
        ThemeProvider(
            model: previewModel(
                selection: ThemeSelection(colorway: .teslaRed, mode: .midnight, customColors: .default)
            )
        ) {
            ThemedSampleCard()
        }
    }

    #Preview("Provider · custom colorway") {
        ThemeProvider(
            model: previewModel(
                selection: ThemeSelection(
                    colorway: .custom,
                    mode: .oled,
                    customColors: CustomColors(primary: "#22d3ee", accent: "#f472b6")
                )
            )
        ) {
            ThemedSampleCard()
        }
    }

    #Preview("Provider · auto → light") {
        ThemeProvider(
            model: previewModel(
                selection: ThemeSelection(colorway: .matrixGreen, mode: .auto, customColors: .default),
                systemPrefersDark: false
            )
        ) {
            ThemedSampleCard()
        }
        .environment(\.colorScheme, .light)
    }

    /// A tiny themed card that reads the resolved theme from the environment — proves a descendant
    /// restyles from `@Environment(\.theme)` exactly as a web consumer reads `useTheme()`.
    private struct ThemedSampleCard: View {
        @Environment(\.theme) private var theme

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: ThemeProviderStrings.string(
                    theme.colorwayPalette.nameKey,
                    theme.colorwayPalette.nameFallback
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color(themeColor: theme.modePalette.textPrimary))
                Text(verbatim: ThemeProviderStrings.string(theme.modePalette.nameKey, theme.modePalette.nameFallback))
                    .font(Font.TS.body)
                    .foregroundStyle(Color(themeColor: theme.modePalette.textSecondary))
                Capsule()
                    .fill(Color(themeColor: theme.colorwayPalette.primary))
                    .frame(height: 8)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(themeColor: theme.modePalette.surface2),
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .padding(TSSpacing.lg)
        }
    }
#endif
