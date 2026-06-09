//
//  AppearanceSettings.Sections.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The server-display envelope (loading skeleton / empty / error states that wrap
//  the cache-then-network selectors, ADR-013) plus two composed sections: the
//  information-density selector with its live reflowing preview + density swatches,
//  and the device-local sidebar-style selector with its silhouette swatches. Pure
//  functions of their inputs; copy resolves through the P1/S10 facade. Never a
//  blank region.
//

import SwiftUI

// MARK: - Server-display region envelope (ADR-013)

/// Wraps a cache-then-network selector's card region: a skeleton while the settings
/// document first loads, an inline empty / error note (with retry) when it resolves
/// empty or fails with no cache, and the live cards once content is available.
struct AppearanceServerRegion<Content: View>: View {
    let phase: AppearancePhase
    let onRetry: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        switch phase {
        case .loading:
            AppearanceServerSkeleton()
        case .empty:
            AppearanceServerNote(
                titleKey: "state.emptyTitle",
                titleFallback: "Preferences not loaded",
                message: "",
                onRetry: onRetry
            )
        case let .error(message):
            AppearanceServerNote(
                titleKey: "error.loadFailed",
                titleFallback: "Couldn't load display preferences",
                message: message,
                onRetry: onRetry
            )
        case .content:
            content()
        }
    }
}

/// The initial-load skeleton for a selector's card region — two greyed bars that
/// keep the section from flashing blank. Hidden from VoiceOver behind one label.
struct AppearanceServerSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(height: 60, cornerRadius: TSRadius.md)
            TSSkeleton(height: 60, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(AppearanceSettingsStrings.text("state.loadingA11y", "Loading display preferences"))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The inline empty / error note shown inside an always-present section when the
/// settings query resolves empty or fails — never a blank box.
struct AppearanceServerNote: View {
    let titleKey: String
    let titleFallback: String
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                AppearanceSettingsStrings.text(titleKey, titleFallback)
                    .font(Font.TS.bodySm).fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            AppearanceButton(
                titleKey: "action.retry", fallback: "Retry",
                variant: .secondary, systemImage: "arrow.clockwise", action: onRetry
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Information density

/// The information-density selector (web density picker) + the live, reflowing
/// preview. The selector cards are gated by the server region; the preview always
/// renders, reflowing to the currently-selected density like `body[data-density]`.
struct AppearanceDensitySection: View {
    let density: AppearanceDensity
    let isLoaded: Bool
    let isSaving: Bool
    let phase: AppearancePhase
    let onSelect: (AppearanceDensity) -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "rectangle.grid.1x2.fill",
                titleKey: "theme.density.label",
                titleFallback: "Information density",
                helpKey: "theme.density.help",
                helpFallback: "Affects table rows, cards, and dashboard widgets across the app."
            )
            AppearanceServerRegion(phase: phase, onRetry: onRetry) {
                VStack(spacing: TSSpacing.md) {
                    ForEach(AppearanceSettingsAdapter.densityChoices()) { choice in
                        AppearanceChoiceCard(
                            label: choice.label,
                            help: choice.help,
                            isActive: density == choice.value,
                            isDisabled: !isLoaded || isSaving
                        ) {
                            AppearanceDensitySwatch(density: choice.value)
                        } action: {
                            onSelect(choice.value)
                        }
                    }
                }
            }
            AppearanceSettingsStrings.text(
                "theme.density.help",
                "Affects table rows, cards, and dashboard widgets across the app."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            AppearanceDensityPreview(density: density)
        }
    }
}

/// A mini glyph communicating each density's row rhythm (web inline density bars).
struct AppearanceDensitySwatch: View {
    let density: AppearanceDensity

    var body: some View {
        VStack(spacing: 2) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(Color.TS.textMuted)
                    .frame(width: 16, height: barHeight)
            }
        }
        .frame(width: 32, height: 32)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityHidden(true)
    }

    private var rowCount: Int {
        switch density {
        case .compact: 4
        case .comfortable: 3
        case .spacious: 2
        }
    }

    private var barHeight: CGFloat {
        switch density {
        case .compact: 2
        case .comfortable: 3
        case .spacious: 5
        }
    }
}

/// The live density preview: a titled container with three sample rows that reflow
/// their height + padding to the selected density (web `data-density` preview).
struct AppearanceDensityPreview: View {
    let density: AppearanceDensity

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AppearanceSettingsStrings.text("theme.density.previewTitle", "Preview")
                .font(Font.TS.bodySm).fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface)
            ForEach(Array(AppearanceSettingsAdapter.densityPreviewRows().enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().overlay(Color.TS.border) }
                Text(verbatim: row)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, minHeight: rowMinHeight, alignment: .leading)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, rowPadding)
            }
        }
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AppearanceSettingsStrings.text("theme.density.previewTitle", "Preview"))
    }

    private var rowMinHeight: CGFloat {
        switch density {
        case .compact: 28
        case .comfortable: 38
        case .spacious: 48
        }
    }

    private var rowPadding: CGFloat {
        switch density {
        case .compact: TSSpacing.xs
        case .comfortable: TSSpacing.sm
        case .spacious: TSSpacing.md
        }
    }
}

// MARK: - Sidebar style

/// The device-local sidebar-style selector (web sidebar radiogroup). Always
/// interactive — sidebar style does not depend on the server settings document.
struct AppearanceSidebarSection: View {
    let style: AppearanceSidebarStyle
    let onSelect: (AppearanceSidebarStyle) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "sidebar.left",
                titleKey: "theme.sidebarStyle.label",
                titleFallback: "Sidebar style"
            )
            ForEach(AppearanceSettingsAdapter.sidebarChoices()) { choice in
                AppearanceChoiceCard(
                    label: choice.label,
                    help: choice.help,
                    isActive: style == choice.value
                ) {
                    AppearanceSidebarStyleSwatch(style: choice.value)
                } action: {
                    onSelect(choice.value)
                }
            }
            AppearanceSettingsStrings.text(
                "theme.sidebarStyle.help",
                "Applies instantly. Saved per device — your other devices keep their own choice."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// A miniature silhouette communicating each sidebar style (web `SidebarStyleSwatch`).
struct AppearanceSidebarStyleSwatch: View {
    let style: AppearanceSidebarStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            switch style {
            case .linear:
                bar(width: 24, tone: Color.TS.textMuted.opacity(0.4))
                HStack(spacing: 3) {
                    Capsule().fill(Color.TS.accent).frame(width: 2, height: 6)
                    bar(width: 22, tone: Color.TS.textPrimary.opacity(0.8))
                }
                bar(width: 18, tone: Color.TS.textMuted.opacity(0.4))
            case .notion:
                dottedRow(active: false)
                dottedRow(active: true)
                dottedRow(active: false)
            case .legacy:
                tileRow(tone: Color.TS.statusInfo)
                tileRow(tone: Color.TS.accent)
                tileRow(tone: Color.TS.statusSuccess)
            }
        }
        .frame(width: 34, height: 44, alignment: .leading)
        .padding(TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous).strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityHidden(true)
    }

    private func bar(width: CGFloat, tone: Color) -> some View {
        RoundedRectangle(cornerRadius: 1, style: .continuous).fill(tone).frame(width: width, height: 3)
    }

    private func dottedRow(active: Bool) -> some View {
        HStack(spacing: 3) {
            Circle().fill(active ? Color.TS.textPrimary : Color.TS.textMuted.opacity(0.6)).frame(width: 4, height: 4)
            bar(width: 20, tone: active ? Color.TS.textPrimary.opacity(0.8) : Color.TS.textMuted.opacity(0.4))
        }
        .padding(.horizontal, 2).padding(.vertical, 1)
        .background(active ? Color.TS.textPrimary.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 3))
    }

    private func tileRow(tone: Color) -> some View {
        HStack(spacing: 3) {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(tone.opacity(0.7)).frame(width: 7, height: 7)
            bar(width: 18, tone: Color.TS.textPrimary.opacity(0.8))
        }
    }
}
