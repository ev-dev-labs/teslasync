//
//  SmartChargeHistoryPanel.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — History panel
//
//  GlassPanel7 — the "Plan History" table (web History section). Implements all
//  four states for the `useChargePlans` source: a redacted skeleton while
//  loading, the `ContentUnavailableView` empty state (web `EmptyState`), a
//  retryable error, and the aligned six-column table (Date · Window · Plan ·
//  Cost · Saved · Status) on success. The table scrolls horizontally on compact
//  widths (web `overflow-x-auto`).
//

import SwiftUI

struct SmartChargeHistoryPanel: View {
    let state: SmartChargeSectionState
    let items: [SmartChargePlanHistoryItem]
    let onRetry: () -> Void

    var body: some View {
        SmartChargePanel(
            icon: "clock.arrow.circlepath",
            titleKey: "chargePlanner.history",
            titleFallback: "Plan History"
        ) {
            switch state {
            case .loading: skeleton
            case .empty: emptyView
            case let .error(message): errorView(message)
            case .success: table
            }
        }
    }

    // MARK: - Success table

    private var table: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
                headerRow
                Divider().overlay(Color.TS.border)
                ForEach(items) { item in
                    dataRow(item)
                }
            }
            .padding(.trailing, TSSpacing.xs)
        }
    }

    private var headerRow: some View {
        GridRow {
            headerCell("chargePlanner.date", "Date")
            headerCell("chargePlanner.window", "Window")
            headerCell("chargePlanner.plan", "Plan")
            headerCell("chargePlanner.cost_decimal", "Cost").gridColumnAlignment(.trailing)
            headerCell("chargePlanner.savedAmount", "Saved").gridColumnAlignment(.trailing)
            headerCell("chargePlanner.status", "Status")
        }
    }

    private func headerCell(_ key: String, _ fallback: String) -> some View {
        Text(verbatim: SmartChargeStrings.text(key, fallback))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func dataRow(_ item: SmartChargePlanHistoryItem) -> some View {
        GridRow {
            cell(SmartChargeFormat.dateTime(item.createdAt))
            cell("\(SmartChargeFormat.time(item.scheduledStart)) — \(SmartChargeFormat.time(item.scheduledEnd))")
            cell(item.ratePlan)
            cell(item.estimatedCost.map(SmartChargeFormat.currency) ?? "—")
            savedCell(item.savings)
            statusCell(item.planStatus)
        }
    }

    private func cell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func savedCell(_ savings: Double?) -> some View {
        let positive = (savings ?? 0) > 0
        return Text(verbatim: positive ? SmartChargeFormat.currency(savings ?? 0) : "—")
            .font(Font.TS.bodySm)
            .fontWeight(positive ? .medium : .regular)
            .foregroundStyle(positive ? Color.TS.statusSuccess : Color.TS.textMuted)
    }

    private func statusCell(_ status: SmartChargePlanStatus) -> some View {
        Text(verbatim: status.rawValue)
            .font(Font.TS.bodySm)
            .foregroundStyle(status.color)
    }

    // MARK: - Empty (web EmptyState)

    private var emptyView: some View {
        TSEmptyState(
            title: SmartChargeStrings.key("chargePlanner.history"),
            message: SmartChargeStrings.key("chargePlanner.noHistory"),
            systemImage: "clock.arrow.circlepath"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Error (retryable)

    private func errorView(_ message: String) -> some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: SmartChargeStrings.text("common.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Loading skeleton

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.lg) {
                    Text(verbatim: "Plan history loading row sample")
                        .font(Font.TS.bodySm)
                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .redacted(reason: .placeholder) // parity:allow native shimmer for the loading state
    }
}
