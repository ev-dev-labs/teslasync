//
//  SignalCompareControls.Views.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The populated content orchestrator plus the freshness chip, cached-data banner, and
//  the loading / empty / error states composed by `SignalCompareControls`. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking
//  and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Content (web `GlassPanel` `space-y-4`: windows + presets + filter)

/// The populated body shown for `.content` (web `<div className="space-y-4">`): the
/// optional top slot, the cached-data banner (when not live), the two snapshot windows,
/// the quick-preset row, and the filter + category chips below a divider.
struct SignalCompareContent: View {
    @Bindable var model: SignalCompareControlsModel
    let topSlot: AnyView?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let topSlot {
                topSlot
            }
            if model.connection != .live {
                SignalCompareConnectivityBanner(connection: model.connection)
            }
            SignalCompareWindowsGrid(model: model)
            SignalComparePresetRow(model: model)
            Divider().overlay(Color.TS.border)
            SignalCompareFilterRow(model: model)
        }
    }
}

// MARK: - Windows grid (web `grid-cols-1 md:grid-cols-2`)

/// The two snapshot windows (web responsive grid): side by side on a regular width,
/// stacked when compact. A freshness chip trails above them when the snapshots are not
/// live.
struct SignalCompareWindowsGrid: View {
    @Bindable var model: SignalCompareControlsModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                HStack {
                    Spacer(minLength: 0)
                    SignalCompareFreshnessChip(connection: model.connection)
                }
            }
            if isWide {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    windowA.frame(maxWidth: .infinity, alignment: .leading)
                    windowB.frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    windowA
                    windowB
                }
            }
        }
    }

    private var windowA: SignalCompareWindowField {
        SignalCompareWindowField(
            title: SignalCompareStrings.windowA,
            tone: Color.TS.statusInfo,
            helpBody: SignalCompareStrings.snapshotHelp,
            helpAria: SignalCompareStrings.snapshotHelpAria,
            value: model.selection.atA,
            timeZone: .current,
            onChange: { model.setWindowA($0) }
        )
    }

    private var windowB: SignalCompareWindowField {
        SignalCompareWindowField(
            title: SignalCompareStrings.windowB,
            tone: Color.TS.statusWarning,
            helpBody: SignalCompareStrings.diffHelp,
            helpAria: SignalCompareStrings.diffHelpAria,
            value: model.selection.atB,
            timeZone: .current,
            onChange: { model.setWindowB($0) }
        )
    }
}

// MARK: - Filter row (web divider + search + category chips)

/// The filter row (web `border-t pt-3 flex … justify-between`): the signal filter field
/// and the wrapping category chips, side by side on a regular width and stacked when
/// compact.
struct SignalCompareFilterRow: View {
    @Bindable var model: SignalCompareControlsModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        if isWide {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                SignalCompareSearchField(model: model)
                Spacer(minLength: TSSpacing.md)
                SignalCompareCategoryChips(model: model)
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SignalCompareSearchField(model: model)
                SignalCompareCategoryChips(model: model)
            }
        }
    }
}

// MARK: - Category chips (web `CATEGORY_PREFIXES.map` + Clear)

/// The wrapping category chips (web rounded-full buttons) plus the ghost "Clear"
/// affordance shown only when a category is active (web `category ? … : null`).
struct SignalCompareCategoryChips: View {
    @Bindable var model: SignalCompareControlsModel

    var body: some View {
        SignalCompareFlowLayout(horizontalSpacing: TSSpacing.xs, verticalSpacing: TSSpacing.xs) {
            ForEach(SignalDiffCategory.all) { category in
                SignalCompareCategoryChip(
                    label: model.localize(category.labelKey, category.defaultLabel),
                    isActive: model.selection.category == category.id,
                    action: { model.toggleCategory(category.id) }
                )
            }
            if model.selection.category != nil {
                TSButton(variant: .ghost, size: .small) {
                    model.clearCategory()
                } label: {
                    Text(verbatim: SignalCompareStrings.clearCategory)
                }
                .accessibilityLabel(Text(verbatim: SignalCompareStrings.clearCategory))
            }
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown when the
/// snapshots are stale / offline so a cached window is clearly labeled.
struct SignalCompareFreshnessChip: View {
    let connection: SignalCompareConnection

    private struct Descriptor {
        let tone: Color
        let text: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: descriptor.text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: descriptor.text))
    }

    private static func descriptor(for connection: SignalCompareConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, text: SignalCompareStrings.live)
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, text: SignalCompareStrings.stale)
        case .offline:
            Descriptor(tone: Color.TS.textMuted, text: SignalCompareStrings.offline)
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the controls when the bound source is not live,
/// so cached snapshot windows are clearly labeled (web `DataFreshness` intent).
struct SignalCompareConnectivityBanner: View {
    let connection: SignalCompareConnection

    var body: some View {
        let offline = connection == .offline
        let text = offline ? SignalCompareStrings.offlineBanner : SignalCompareStrings.staleBanner
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: text).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (initial context fetch)

/// The initial-fetch skeleton chrome: muted blocks standing in for the two windows, the
/// preset row, and the filter field. Never a blank box.
struct SignalCompareLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.lg) {
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(width: 96, height: 28, cornerRadius: TSRadius.pill)
                }
            }
            TSSkeleton(height: 36, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SignalCompareStrings.loadingLabel))
    }
}

// MARK: - Empty state (no comparable signals yet)

/// The resolved-but-no-signals state (web friendly `EmptyState`) over a native
/// `ContentUnavailableView`. Never a blank box.
struct SignalCompareEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SignalCompareStrings.emptyTitle)
            } icon: {
                Image(systemName: "square.on.square.dashed")
            }
        } description: {
            Text(verbatim: SignalCompareStrings.emptyDescription)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (context fetch failed → retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct SignalCompareErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SignalCompareStrings.errorTitle)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: SignalCompareStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SignalCompareStrings.retry))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
