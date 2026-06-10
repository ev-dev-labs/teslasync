//
//  RecentChargesSection.Views.swift
//  TeslaSync — P4 feature view · 0296 · RecentChargesSection (Apple)
//
//  The presentational subviews composed by `RecentChargesSection`: the data body (the web
//  `DataTable` → the shared `TSDataTable` carrying the five charge columns, compact density, the
//  energy header sortable), the loading skeleton rows, and the empty / error chrome. All consume
//  the P1/S10 facade and the shared P1/S9 tokens + shared components (`TSDataTable` / `TSColumn` /
//  `TSSkeleton` / `TSButton` / `TSFadeIn`) — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Data body (web non-empty render: the DataTable)

/// The populated state — the five-column charge table in the shared `TSDataTable` (compact
/// density, web `compact`), wrapped in the shared fade-in. The energy header is sortable (web
/// `sortable: true`); the column titles resolve through the P1/S10 facade.
struct RecentChargesSectionContent: View {
    let projection: RecentChargesProjection

    var body: some View {
        TSFadeIn {
            TSDataTable(rows: projection.rows, columns: columns, density: .compact)
        }
        .accessibilityElement(children: .contain)
    }

    /// The five web columns in composition order, each titled via the facade; the energy column
    /// carries the numeric comparator so sorting orders by SI Wh, not the "X kWh" text.
    private var columns: [TSColumn<RecentChargesRow>] {
        RecentChargesColumn.allCases.map { column in
            TSColumn<RecentChargesRow>(
                id: column.rawValue,
                title: columnTitle(column.labelKey, column.labelFallback),
                comparator: column.makeComparator()
            ) { row in
                Text(verbatim: column.cell(row))
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
    }

    /// The shared `TSColumn` takes a `LocalizedStringKey`; the facade has already resolved the
    /// header to its display string, so wrap it for the parameter (sibling `FlagsTable` pattern).
    private func columnTitle(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(RecentChargesSectionStrings.string(key, fallback))
    }
}

// MARK: - Loading (skeleton chrome)

/// One skeleton row mirroring a compact table row's shape, so the body does not jump when the
/// real rows resolve.
struct RecentChargesRowSkeleton: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 96, height: 12)
            Spacer(minLength: TSSpacing.sm)
            TSSkeleton(width: 56, height: 12)
            TSSkeleton(width: 40, height: 12)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityHidden(true)
    }
}

/// The first-load state: a header skeleton over several row skeletons, matching the table shape.
struct RecentChargesSectionLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 140, height: 10)
            Divider().overlay(Color.TS.border)
            ForEach(0 ..< 5, id: \.self) { _ in RecentChargesRowSkeleton() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: RecentChargesSectionStrings.string(
            "recentCharges.loadingA11y", "Loading recent charges"
        )))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The no-rows render (web `EmptyState` with the BatteryCharging icon + "No charging sessions
/// recorded yet"): a friendly state, never a blank panel.
struct RecentChargesSectionEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: RecentChargesSectionStrings.string(
                    "common.noCharges", "No charging sessions recorded yet"
                ))
            } icon: {
                Image(systemName: "battery.100.bolt")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer + retry)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance wired to the model's
/// refresh.
struct RecentChargesSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: RecentChargesSectionStrings.string("recentCharges.errorTitle", "Couldn't load charges"))
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
                Text(verbatim: RecentChargesSectionStrings.string("recentCharges.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: RecentChargesSectionStrings.string("recentCharges.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
