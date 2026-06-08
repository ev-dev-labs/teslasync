//
//  LayoutSwitcher.Previews.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: loaded (global
//  + pinned + default layouts, dirty, edit mode, a vehicle selected so the pin
//  control is enabled), stale / offline freshness, and the loading / empty /
//  error chrome. Previews use the bundle-free `.echo` localizer so the English
//  copy renders without the folded catalog, and no-op actions so they are
//  side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum LayoutSwitcherPreview {
        static let actions = LayoutSwitcherActions(
            onSwitch: { _ in },
            onCreate: { _ in nil },
            onReset: {},
            onRetry: {},
            onToggleEdit: {},
            onDuplicate: { _ in },
            onPinToVehicle: { _, _ in }
        )

        static let vehicle = LayoutSwitcherVehicle(id: 7, displayName: "Model 3", vin: "5YJ3E1EA7KF000000")

        static let dashboards: [SavedDashboardSummary] = [
            SavedDashboardSummary(id: "default", name: "Overview", isDefault: true),
            SavedDashboardSummary(id: "road-trip", name: "Road Trip"),
            SavedDashboardSummary(id: "garage", name: "Garage (Model 3)", vehicleID: 7)
        ]

        static func data(
            activeID: String = "default",
            dirty: Bool = false,
            editMode: Bool = false,
            vehicle: LayoutSwitcherVehicle? = vehicle
        ) -> LayoutSwitcherData {
            LayoutSwitcherData(
                dashboards: dashboards,
                activeID: activeID,
                dirty: dirty,
                editMode: editMode,
                selectedVehicle: vehicle
            )
        }

        static func switcher(
            _ state: LayoutSwitcherState,
            connection: LayoutSwitcherConnection = .live
        ) -> some View {
            LayoutSwitcher(
                state: state,
                connection: connection,
                actions: actions,
                localize: .echo
            )
        }
    }

    #Preview("Loaded · branches") {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data()))
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data(activeID: "garage", dirty: true)))
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data(editMode: true)))
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data(vehicle: nil)))
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Freshness · live / stale / offline") {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data()), connection: .live)
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data()), connection: .stale)
            LayoutSwitcherPreview.switcher(.loaded(LayoutSwitcherPreview.data()), connection: .offline)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Chrome · loading / empty / error") {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            LayoutSwitcherPreview.switcher(.loading)
            LayoutSwitcherPreview.switcher(.empty)
            LayoutSwitcherPreview.switcher(.error(message: nil))
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Dropdown · open") {
        LayoutSwitcherDropdown(
            rows: LayoutSwitcherProjection.rows(
                LayoutSwitcherPreview.dashboards,
                activeID: "default",
                selectedVehicleID: 7
            ),
            pinControl: LayoutSwitcherProjection.pinControl(
                active: LayoutSwitcherProjection.active(LayoutSwitcherPreview.dashboards, activeID: "default"),
                selectedVehicleID: 7
            ),
            localize: .echo,
            onSelect: { _ in },
            onNewFromCurrent: {},
            onPinToggle: {},
            onReset: {}
        )
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif
