//
//  AutomationCard.Previews.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: active /
//  disabled / auto-disabled (warning + conflicts) / firing (live) / stale /
//  offline / never-run + all-vehicles / loading / empty / error. Previews use the
//  bundle-free `.echo` localizer so the English copy renders without the folded
//  catalog, and no-op actions so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum AutomationCardPreview {
        static let actions = AutomationCardActions(
            onToggle: { _, _ in },
            onReEnable: { _ in },
            onDelete: { _ in },
            onTestRun: { _ in }
        )

        static let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

        static func active() -> AutomationCardData {
            AutomationCardData(
                id: 1,
                name: "Precondition before commute",
                description: "Warm the cabin on weekday mornings",
                enabled: true,
                lastTriggeredAt: "2023-11-14T19:00:00Z",
                executionCount: 142,
                nextFireTime: "2023-11-15T14:30:00Z",
                vehicleName: "Model 3"
            )
        }

        static func disabled() -> AutomationCardData {
            AutomationCardData(
                id: 2,
                name: "Charge to 90% overnight",
                description: "Off-peak charging schedule",
                enabled: false,
                executionCount: 30
            )
        }

        static func autoDisabled() -> AutomationCardData {
            AutomationCardData(
                id: 3,
                name: "Vent when too hot",
                enabled: false,
                autoDisabled: true,
                autoDisabledReason: "Disabled after 5 consecutive command failures.",
                lastTriggeredAt: "2023-11-13T19:00:00Z",
                executionCount: 88,
                failureCount: 5,
                conflicts: [
                    AutomationConflictData(
                        id: 9,
                        automationName: "Close windows at dusk",
                        reason: "both control the windows",
                        severity: "warning"
                    ),
                    AutomationConflictData(
                        id: 10,
                        automationName: "Sentry on leave",
                        reason: "overlapping geofence trigger",
                        severity: "info"
                    )
                ],
                vehicleName: "Model Y"
            )
        }

        static func firing() -> AutomationCardData {
            AutomationCardData(
                id: 4,
                name: "Open charge port at home",
                enabled: true,
                lastTriggeredAt: "2023-11-14T18:59:00Z",
                executionCount: 410,
                isFiring: true,
                vehicleName: "Model 3",
                isPinned: true
            )
        }

        static func neverRun() -> AutomationCardData {
            AutomationCardData(id: 5, name: "Holiday road-trip prep", enabled: true)
        }

        static func card(
            _ state: AutomationCardState,
            connection: AutomationLiveConnection = .live
        ) -> some View {
            AutomationCard(
                state: state,
                connection: connection,
                actions: actions,
                localize: .echo,
                now: { fixedNow }
            )
        }
    }

    #Preview("Loaded · states") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AutomationCardPreview.card(.loaded(AutomationCardPreview.active()))
                AutomationCardPreview.card(.loaded(AutomationCardPreview.disabled()))
                AutomationCardPreview.card(.loaded(AutomationCardPreview.autoDisabled()))
                AutomationCardPreview.card(.loaded(AutomationCardPreview.neverRun()))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Firing · live / stale / offline") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AutomationCardPreview.card(.loaded(AutomationCardPreview.firing()), connection: .live)
                AutomationCardPreview.card(.loaded(AutomationCardPreview.firing()), connection: .stale)
                AutomationCardPreview.card(.loaded(AutomationCardPreview.firing()), connection: .offline)
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Chrome · loading / empty / error") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AutomationCardPreview.card(.loading)
                AutomationCardPreview.card(.empty)
                AutomationCardPreview.card(.error(message: nil))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
