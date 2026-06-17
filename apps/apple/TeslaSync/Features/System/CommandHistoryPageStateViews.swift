//
//  CommandHistoryPageStateViews.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple) — Data-State Views
//
//  The page-level loading + error states (web `PageContainer` `loading` / `error` phases).
//  The empty state lives inside the timeline panel (web `EmptyState`), so it is rendered
//  from `CommandHistoryTimelinePanel`. All copy resolves from `Localizable.xcstrings`;
//  chrome uses the P2 design tokens (ADR-005).
//

import SwiftUI

// MARK: - Loading (web PageContainer `loading` — skeletons)

/// The loading skeleton shown while the history resolves: a stat grid skeleton over a row
/// skeleton standing in for the timeline (web `StatGridSkeleton` + `TableSkeleton`).
struct CommandHistoryLoadingView: View {
    let columns: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSStatGridSkeleton(count: 4)
            TSGlassPanel {
                TSTableSkeleton(rows: 6)
            }
        }
        .accessibilityLabel(Text("loading"))
    }
}

// MARK: - Error (web PageContainer `error` — retry)

/// The retryable error state (web `PageContainer` error). Surfaces the failure message and
/// a Retry action that re-runs the load.
struct CommandHistoryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: onRetry)
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }
}
