import SwiftUI

// Page-chrome surfaces for the Fleet (vehicle list) page — the banners, toast, error / empty regions,
// the four summary stat cards, and the loading skeleton. Each is a small presentational view bound to
// the values the `VehicleListPage` hands it (the `@Observable` `VehicleListPageModel` or its derived
// snapshots), keeping the page struct lean and every region individually testable / previewable.

// MARK: - GlassPanel2 / GlassPanel3 — sync banners (web `syncMut.isSuccess` / `isError`)

/// The persistent sync-result banner: emerald success (web `vehicles.syncSuccess`) or rose failure
/// (web `vehicles.syncError`). Renders nothing when there is no result yet.
struct VehicleListSyncBanner: View {
    let feedback: VehicleListSyncFeedback?

    var body: some View {
        if let feedback {
            TSFadeIn {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: feedback == .success ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundStyle(feedback.tone.color)
                    Text(feedback.messageKey)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(feedback.tone.color)
                    Spacer(minLength: 0)
                }
                .padding(TSSpacing.md)
                .background(
                    feedback.tone.color.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(feedback.tone.color.opacity(0.3), lineWidth: 1)
                )
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - Toast (web `toast.success` / `toast.error`)

/// The transient toast surfaced after a sync / delete (web `toast.*`). Tap dismisses it; the model
/// also auto-dismisses it after a short delay.
struct VehicleListToastView: View {
    let toast: VehicleListToast
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: toast.tone == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(toast.tone.color)
            Text(toast.messageKey)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(toast.tone.color.opacity(0.4), lineWidth: 1))
        .shadow(color: Color.black.opacity(0.2), radius: 8, y: 2)
        .padding(.top, TSSpacing.sm)
        .onTapGesture(perform: onDismiss)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - GlassPanel1 — load error (web `error` branch)

/// The retryable load-error panel (web `error` → GlassPanel with `vehicles.loadError`). The HIG retry
/// affordance re-runs the fleet fetch (ADR-011 — never a blank region).
struct VehicleListErrorPanel: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(VehicleListStrings.loadError)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.statusDanger)
                    .multilineTextAlignment(.center)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Empty (web `vehicleList.length === 0`)

/// The no-vehicles empty state (web `EmptyState` with the sync action). Connecting + syncing populates
/// the fleet, so the primary action re-runs the sync.
struct VehicleListEmptyView: View {
    let isSyncing: Bool
    let onSync: () -> Void

    var body: some View {
        TSEmptyState(
            title: VehicleListStrings.emptyTitle,
            message: VehicleListStrings.emptyMessage,
            systemImage: "car.2"
        ) {
            TSButton(VehicleListStrings.syncButton, isLoading: isSyncing, action: onSync)
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

// MARK: - Total-Vehicles / Avg-Battery / Total-Range / Charging-Online (web 4× MetricCard)

/// The four fleet summary cards (web `MetricCard`s): total vehicle count, mean state of charge, the
/// SI-converted total rated range (unit-suffixed label), and the charging-over-online tally.
struct VehicleFleetSummaryGrid: View {
    let model: VehicleListPageModel
    let units: UnitPreferences

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            MetricCard(
                label: VehicleListStrings.totalVehicles,
                value: "\(model.vehicleCount)",
                iconSystemName: "car.2.fill",
                color: .cyan
            )
            MetricCard(
                label: VehicleListStrings.avgBattery,
                value: "\(VehicleListFormat.number(model.avgBattery, units: units))%",
                iconSystemName: "battery.75percent",
                color: .green
            )
            MetricCard(
                label: VehicleListStrings.totalRangeLabel(unit: units.distance),
                value: VehicleListFormat.totalRangeValue(meters: model.totalRangeM, units: units),
                iconSystemName: "gauge.with.dots.needle.67percent",
                color: .purple
            )
            MetricCard(
                label: VehicleListStrings.chargingOnline,
                value: "\(model.chargingCount) / \(model.onlineCount)",
                iconSystemName: "bolt.fill",
                color: .green
            )
        }
    }
}

// MARK: - Skeleton (web loading state)

/// The initial loading state: redacted stat-card, battery-panel, and vehicle-card shapes so the page
/// structure is recognizable while the fleet loads (ADR-011). Mirrors the web `VehicleListSkeleton`
/// (4 stat cards → fleet panel → 3 vehicle rows).
struct VehicleListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 96, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 150, cornerRadius: TSRadius.lg)
            VStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(height: 110, cornerRadius: TSRadius.lg)
                }
            }
        }
        .accessibilityLabel(Text("loading"))
    }
}
