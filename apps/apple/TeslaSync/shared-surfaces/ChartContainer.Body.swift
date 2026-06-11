//
//  ChartContainer.Body.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The chart body + accessible fallback split out of `…Views.swift` (one file ≤ 400 lines per the
//  SwiftLint contract): the body state machine (web `loading ? Spinner : empty ? EmptyState :
//  SectionErrorBoundary(children)`), the chart-failed error state (web `SectionErrorBoundary`
//  `fallbackTitle`), and the accessible data-table fallback (web visually-hidden `<figcaption>`
//  `<table>` / summary). Every state renders a real surface — never a blank box. Copy resolves
//  through the P1/S10 facade; colour comes from the P1/S9 tokens; the shared feedback primitives are
//  reused.
//

import SwiftUI

// MARK: - Body (web chart-area state machine)

/// The chart body — the native port of the web chart-area conditional. Renders exactly one of the
/// loading spinner, the empty state, the chart-failed error state, or the chart content, each at the
/// requested height so the figure never collapses. The ready content is the caller's chart for the
/// current render context.
struct ChartContainerBody<Content: View>: View {
    let status: ChartContainerChartStatus
    let height: CGFloat
    let ariaLabel: String
    let onRetry: () -> Void
    let content: Content

    var body: some View {
        Group {
            switch status {
            case .loading:
                centered { TSSpinner() }
            case .empty:
                centered {
                    TSEmptyState(
                        title: ChartContainerL10n.key(ChartContainerStrings.string(
                            "chart.noData",
                            "No data available"
                        )),
                        systemImage: "chart.xyaxis.line"
                    )
                }
            case .error:
                centered { ChartContainerErrorState(onRetry: onRetry) }
            case .ready:
                content
                    .frame(maxWidth: .infinity, minHeight: height)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text(verbatim: ariaLabel))
            }
        }
    }

    private func centered(@ViewBuilder _ inner: () -> some View) -> some View {
        inner()
            .frame(maxWidth: .infinity, minHeight: height)
    }
}

// MARK: - Error state (web `SectionErrorBoundary` fallbackTitle)

/// The chart-failed state — the native port of the web `SectionErrorBoundary` fallback with the
/// `errors.section.chartTitle` title plus a retry affordance, so a failed chart can recover without a
/// full reload (the web boundary remounts on retry).
struct ChartContainerErrorState: View {
    let onRetry: () -> Void

    private var title: String {
        ChartContainerStrings.string("errors.section.chartTitle", "This chart failed to load")
    }

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: ChartContainerStrings.string("action.retry", "Retry"))
                    .font(Font.TS.label)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Accessible data-table fallback (web `<figcaption>` table / summary)

/// The accessible data-table fallback — the native port of the web visually-hidden `<figcaption>`.
/// When the caller supplies `data` + `dataColumns` it renders the same rows the chart visualises as a
/// disclosable table (the web `{{title}} — data table` caption); otherwise it falls back to the long
/// description prose, and finally to the bare `Chart: {{title}}` summary so assistive tech always has
/// a target. The cell text mirrors the web `format ?? (null → —)` rule.
struct ChartContainerFallbackTable: View {
    let title: String
    let ariaDescription: String?
    let columns: [ChartContainerDataColumn]
    let rows: [ChartContainerDataRow]

    private var hasTable: Bool {
        ChartContainerLogic.hasFallbackTable(rowCount: rows.count, columnCount: columns.count)
    }

    private var caption: String {
        ChartContainerAccessibility.fallbackTableLabel(
            template: ChartContainerStrings.string("chart.a11y.fallbackTableLabel", "{{title}} — data table"),
            title: title
        )
    }

    private var summary: String {
        ChartContainerAccessibility.summary(
            template: ChartContainerStrings.string("chart.a11y.summary", "Chart: {{title}}"),
            title: title
        )
    }

    var body: some View {
        if hasTable {
            DisclosureGroup {
                tableGrid
            } label: {
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .tint(Color.TS.textMuted)
        } else if let ariaDescription, !ariaDescription.isEmpty {
            Text(verbatim: ariaDescription)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(verbatim: summary)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(verbatim: summary))
        }
    }

    private var tableGrid: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            headerRow
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                dataRow(row)
            }
        }
        .padding(.top, TSSpacing.xs)
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(columns) { column in
                Text(verbatim: column.label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func dataRow(_ row: ChartContainerDataRow) -> some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(columns) { column in
                Text(verbatim: ChartContainerLogic.cellText(row[column.key] ?? .missing, format: column.format))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
