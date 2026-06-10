//
//  TelemetryPipelineCard.States.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The three non-content render states the card switches over: the initial-fetch skeleton
//  chrome (web `<Skeleton>` shell), the "no vehicles configured" empty state (web inline
//  empty block + Tesla-account link), and the query-failure error state (web `QueryError`
//  equivalent with a Retry affordance). Each reads its copy through the P1/S10 facade and
//  the shared P1/S9 tokens; the empty + error states route through the navigation/refresh
//  seams rather than touching the network.
//

import SwiftUI

// MARK: - Loading (initial-fetch skeleton chrome)

/// The initial-fetch skeleton (web `<Skeleton>`): a redacted rollup grid over a few
/// per-vehicle row skeletons. Shimmer respects Reduce Motion (via `TSSkeleton`).
struct TelemetryPipelineLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.lg, alignment: .leading)],
                alignment: .leading,
                spacing: TSSpacing.sm
            ) {
                ForEach(0 ..< 5, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 64, height: 10)
                        TSSkeleton(width: 88, height: 14)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 10, height: 10, cornerRadius: TSRadius.pill)
                        TSSkeleton(height: 14)
                        TSSkeleton(width: 64, height: 14)
                        TSSkeleton(width: 72, height: 14)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TelemetryPipelineStrings.text("telemetry.pipeline.loading", "Loading telemetry pipeline"))
    }
}

// MARK: - Empty (no vehicles configured)

/// The "no vehicles configured yet" empty block (web inline empty state). Renders the
/// friendly message + a Tesla-account link that routes through the navigation seam
/// (web `<Link to="/tesla-account">`), never a blank box.
struct TelemetryPipelineEmptyVehicles: View {
    let onNavigate: (TelemetryPipelineDestination) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TelemetryPipelineStrings.text(
                "telemetry.pipeline.noVehicles",
                "No vehicles configured yet. Add a vehicle to see per-vehicle telemetry status."
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            Button { onNavigate(.teslaAccount) } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 11, weight: .semibold))
                        .accessibilityHidden(true)
                    TelemetryPipelineStrings.text("telemetry.pipeline.teslaAccount", "Tesla account")
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                }
                .foregroundStyle(Color.TS.accent)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TelemetryPipelineStrings.text("telemetry.pipeline.teslaAccount", "Tesla account"))
            .accessibilityHint(TelemetryPipelineStrings.text(
                "telemetry.pipeline.teslaAccountHint", "Opens the Tesla account page to add a vehicle"
            ))
            .accessibilityAddTraits(.isLink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Error (QueryError equivalent)

/// The query-failure state (web `QueryError`): a danger glyph + title + the failure detail +
/// a Retry button that re-reads through the source seam.
struct TelemetryPipelineErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TelemetryPipelineStrings.text("telemetry.pipeline.errorTitle", "Couldn't load telemetry pipeline")
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
                TelemetryPipelineStrings.text("telemetry.pipeline.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TelemetryPipelineStrings.text("telemetry.pipeline.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
