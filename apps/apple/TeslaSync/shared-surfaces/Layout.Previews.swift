//
//  Layout.Previews.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  Xcode previews for every branch of the app shell: the navigation body (multi-section, with the active
//  card + pinned group + per-item count badges), the loading skeleton chrome, the empty-navigation state, the
//  error retry tile, the stale + offline freshness chips, and the compact (drawer) width. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func layoutModel(
        pathname: String = "/charging",
        vehicleCount: Int = 3,
        unreadAlerts: Int = 4,
        staleCount: Int = 2,
        isForwardAuth: Bool = true,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: LayoutConnection = .live
    ) -> LayoutModel {
        let snapshot = LayoutSnapshot(
            pathname: pathname,
            sidebarStyle: .linear,
            vehicleCount: vehicleCount,
            unreadAlerts: unreadAlerts,
            staleCount: staleCount,
            isForwardAuth: isForwardAuth,
            pinnedPaths: LayoutNavLimits.defaultPinnedPaths,
            recentPaths: ["/drives", "/battery"],
            expandedSections: ["Home", "Charging"],
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let model = LayoutModel(source: InMemoryLayoutSource(snapshot: snapshot))
        model.start()
        return model
    }

    #Preview("Shell · content (regular)") {
        LayoutShell(model: layoutModel()) {
            LayoutContentSlot()
        }
        .frame(width: 980, height: 720)
    }

    #Preview("Shell · content (compact drawer)") {
        LayoutShell(model: layoutModel(pathname: "/notifications/alerts")) {
            LayoutContentSlot()
        }
        .frame(width: 420, height: 720)
    }

    #Preview("Sidebar body · badges + active card") {
        ScrollView {
            LayoutSidebarBody(model: layoutModel(pathname: "/data-repair"))
        }
        .frame(width: 300, height: 720)
        .background(Color.TS.surface)
    }

    #Preview("Leaf states · loading / empty / error") {
        HStack(spacing: TSSpacing.lg) {
            LayoutLoadingView().frame(width: 280)
            LayoutEmptyView().frame(width: 280)
            LayoutErrorView(message: "Network unavailable") {}.frame(width: 280)
        }
        .frame(height: 420)
        .background(Color.TS.bg)
    }

    #Preview("Freshness · stale / offline") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LayoutShellFreshnessChip(connection: .stale) {}
            LayoutShellFreshnessChip(connection: .offline) {}
            LayoutThemeSwitcher {}
            LayoutBellTrigger(unread: 7) {}
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif
