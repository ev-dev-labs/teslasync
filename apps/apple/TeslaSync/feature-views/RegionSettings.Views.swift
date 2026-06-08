//
//  RegionSettings.Views.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  The presentational subviews composed by `RegionSettings`: the two-cell region /
//  Fleet-API-URL grid (web `grid-cols-1 sm:grid-cols-2`), and the loading / empty /
//  error chrome (the web `EmptyState` + the P4 leaf `QueryError` peer). All consume
//  the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports,
//  no raw hex. The cells reflow from one column to two as width allows, matching the
//  web responsive grid.
//

import SwiftUI

// MARK: - Data body (web non-empty render: the two info cells)

/// The resolved panel body — the region code + Fleet API base URL cells. Uses
/// `ViewThatFits` to render two columns when the width allows and one column when
/// it doesn't (web `grid-cols-1 sm:grid-cols-2`).
struct RegionDataView: View {
    let region: String
    let fleetAPIBaseURL: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                regionCell.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
                urlCell.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                regionCell
                urlCell
            }
        }
    }

    private var regionCell: some View {
        RegionInfoCell(
            label: RegionStrings.string("region.regionCode", "Region"),
            value: region,
            monospaced: false
        )
    }

    private var urlCell: some View {
        RegionInfoCell(
            label: RegionStrings.string("region.fleetApiUrl", "Fleet API Base URL"),
            value: fleetAPIBaseURL,
            monospaced: true
        )
    }
}

/// One labelled value cell (web `bg-white/[0.02] border rounded-lg p-4`). The
/// region code uses the section type; the Fleet API URL uses a monospaced,
/// selectable, wrapping treatment (web `font-mono break-all`).
struct RegionInfoCell: View {
    let label: String
    let value: String
    let monospaced: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(valueFont)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.border.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: RegionAccessibility.infoLabel(label: label, value: value)))
    }

    private var valueFont: Font {
        monospaced
            ? .system(size: 13, weight: .regular, design: .monospaced)
            : Font.TS.section
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton cells that keep the panel's shape while the
/// region query resolves.
struct RegionLoadingView: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                skeletonCell
                skeletonCell
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                skeletonCell
                skeletonCell
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RegionStrings.string("region.loadingA11y", "Loading region settings")))
    }

    private var skeletonCell: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 88, height: 10)
            TSSkeleton(height: 18)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.border.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }
}

/// The empty render (web `EmptyState`): a friendly state, never a blank panel.
struct RegionEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: RegionStrings.string(
                    "region.noData",
                    "No region data yet. Click Refresh to fetch from Tesla."
                ))
            } icon: {
                Image(systemName: "info.circle")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct RegionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: RegionStrings.string("region.errorTitle", "Couldn't load region settings"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: RegionStrings.string("region.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: RegionStrings.string("region.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
