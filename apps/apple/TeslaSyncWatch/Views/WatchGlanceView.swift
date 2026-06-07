import SwiftUI

/// The watch glance: the primary, single-screen surface mirroring the web `/watch`
/// intent — battery + range hero, vehicle/charging state, climate & security
/// status, and honest freshness — with banners for stale / auth / error states.
/// Scrolls with the Digital Crown; every interactive target is wrist-sized.
struct WatchGlanceView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: TSSpacing.sm) {
                banners
                content
                WatchFreshnessChip(freshness: model.freshness)
                navigationButtons
                updatedLabel
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.bottom, TSSpacing.sm)
        }
        .navigationTitle("watch.title")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    model.requestRefresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("watch.action.refresh")
            }
        }
    }

    @ViewBuilder private var banners: some View {
        if !model.isAuthenticated {
            WatchAuthBanner()
        }
        if let errorKey = model.errorKey {
            WatchErrorBanner(messageKey: LocalizedStringKey(errorKey)) {
                model.requestRefresh()
            }
        }
        if model.freshness == .stale {
            WatchStaleBanner(lastUpdated: model.lastUpdated) {
                model.requestRefresh()
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let glance = WatchGlanceData(snapshot: model.snapshot), model.freshness != .offline {
            loaded(glance)
        } else if model.snapshot == nil, model.lastUpdated == nil {
            WatchEmptyView { model.requestRefresh() }
        } else {
            WatchOfflineContent(lastUpdated: model.lastUpdated) { model.requestRefresh() }
        }
    }

    @ViewBuilder private func loaded(_ glance: WatchGlanceData) -> some View {
        Text(verbatim: glance.vehicleName)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)

        WatchBatteryRing(
            fraction: glance.batteryFraction,
            centerText: glance.batteryDisplay,
            subText: glance.rangeDisplay,
            isCharging: glance.isCharging
        )
        .frame(width: 116, height: 116)
        .padding(.vertical, TSSpacing.xs)

        if glance.isCharging, let finishBy = glance.chargeFinishBy {
            ChargingCountdown(finishBy: finishBy, added: glance.chargeAddedDisplay)
        }

        WatchStateBadge(state: glance.state)

        WatchStatusRow(glance: glance)

        if let location = glance.locationLabel {
            Label {
                Text(verbatim: location)
            } icon: {
                Image(systemName: "mappin.and.ellipse")
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
        }
    }

    private var navigationButtons: some View {
        VStack(spacing: TSSpacing.xs) {
            NavigationLink {
                WatchActionsView()
                    .environment(model)
            } label: {
                Label("watch.actions.title", systemImage: "bolt.car.fill")
                    .frame(maxWidth: .infinity)
            }
            NavigationLink {
                WatchSettingsView()
                    .environment(model)
            } label: {
                Label("watch.settings.title", systemImage: "gearshape.fill")
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.bordered)
        .padding(.top, TSSpacing.xs)
    }

    @ViewBuilder private var updatedLabel: some View {
        if let lastUpdated = model.lastUpdated {
            HStack(spacing: TSSpacing.xs) {
                Text("watch.updated")
                Text(lastUpdated, style: .relative)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// A self-updating charge countdown plus energy added.
private struct ChargingCountdown: View {
    let finishBy: Date
    let added: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "bolt.fill")
                Text(finishBy, style: .timer)
            }
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.statusSuccess)
            if let added {
                Text(verbatim: added)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The coarse vehicle-state badge (charging / plugged / parked / unknown).
private struct WatchStateBadge: View {
    let state: WatchVehicleState

    var body: some View {
        Label {
            Text(LocalizedStringKey(state.titleKey))
        } icon: {
            Image(systemName: state.systemImage)
        }
        .font(Font.TS.caption)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: Capsule())
        .foregroundStyle(state == .charging ? Color.TS.statusSuccess : Color.TS.textSecondary)
    }
}
