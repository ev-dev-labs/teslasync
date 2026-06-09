//
//  GasPriceSettings.States.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The P4 leaf-state chrome composed by `GasPriceSettings` when the bound status query
//  is not yet in its `data` phase: the loading skeleton (keeps the panel's shape), the
//  friendly empty state (web `EmptyState` peer — never a blank box), and the
//  fetch-failure state with a retry affordance (web `QueryError` peer). All wording
//  resolves through the P1/S10 facade and all styling from the shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web query pending)

/// The initial-fetch chrome: skeleton blocks that keep the panel's shape while the
/// gas-price status query resolves.
struct GasPriceLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
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
            TSSkeleton(width: 140, height: 36, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.loadingA11y", "Loading gas price settings")))
    }

    private var skeletonCell: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 88, height: 10)
            TSSkeleton(height: 20)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.border.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }
}

// MARK: - Empty (web `EmptyState` peer)

/// The empty render: a friendly state, never a blank panel.
struct GasPriceEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: GasPriceStrings.string(
                    "gas.noData",
                    "Gas price tracking isn't configured yet. Click Refresh to fetch from the EIA."
                ))
            } icon: {
                Image(systemName: "fuelpump")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state with a retry affordance.
struct GasPriceErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: GasPriceStrings.string("gas.errorTitle", "Couldn't load gas price settings"))
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
                Text(verbatim: GasPriceStrings.string("gas.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
