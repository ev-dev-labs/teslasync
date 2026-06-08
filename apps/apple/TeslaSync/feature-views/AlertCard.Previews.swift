//
//  AlertCard.Previews.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: critical
//  (unread) / warning / info (read + acknowledged) / success / system, the live /
//  stale / offline freshness, and the loading / empty / error chrome. Previews use
//  the bundle-free `.echo` localizer so the English copy renders without the
//  folded catalog, and no-op actions so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum AlertCardPreview {
        static let actions = AlertCardActions(
            onMarkRead: { _ in },
            onAcknowledge: { _ in },
            onOpenDetail: { _ in },
            onReopen: { _ in }
        )

        static let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

        static func critical() -> AlertCardData {
            AlertCardData(
                id: 1,
                type: "geofence_exit",
                severity: "critical",
                title: "Vehicle left the Home geofence",
                message: "Model 3 departed the Home area unexpectedly.",
                isRead: false,
                createdAt: "2023-11-14T19:02:00Z",
                vehicleID: 1,
                ruleSignal: "LocatedAtHome"
            )
        }

        static func warning() -> AlertCardData {
            AlertCardData(
                id: 2,
                type: "tire_pressure_low",
                severity: "warning",
                title: "Front-left tire pressure low",
                message: "TPMS reported 32 psi, below the 36 psi target.",
                isRead: false,
                createdAt: "2023-11-14T20:40:00Z",
                vehicleID: 1,
                ruleSignal: "TpmsPressureFl"
            )
        }

        static func acknowledged() -> AlertCardData {
            AlertCardData(
                id: 3,
                type: "charging_complete",
                severity: "info",
                title: "Charging complete",
                message: "Model Y reached the 80% charge limit.",
                isRead: true,
                createdAt: "2023-11-14T16:15:00Z",
                acknowledgedAt: "2023-11-14T16:30:00Z",
                acknowledgedBy: "alex",
                vehicleID: 2,
                ruleSignal: "ChargeState"
            )
        }

        static func success() -> AlertCardData {
            AlertCardData(
                id: 4,
                type: "software_update",
                severity: "success",
                title: "Software update installed",
                message: "Version 2023.44.30 finished installing.",
                isRead: true,
                createdAt: "2023-11-13T22:13:20Z",
                vehicleID: 2,
                ruleSignal: "SoftwareUpdateVersion"
            )
        }

        static func system() -> AlertCardData {
            AlertCardData(
                id: 5,
                type: "system_mqtt",
                severity: "warning",
                title: "Telemetry stream degraded",
                message: "The MQTT broker connection dropped briefly.",
                isRead: false,
                createdAt: "2023-11-14T22:00:00Z"
            )
        }

        static func card(
            _ state: AlertCardState,
            connection: AlertLiveConnection = .live
        ) -> some View {
            AlertCard(
                state: state,
                connection: connection,
                actions: actions,
                localize: .echo,
                now: { fixedNow }
            )
        }
    }

    #Preview("Severity & types") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AlertCardPreview.card(.loaded(AlertCardPreview.critical()))
                AlertCardPreview.card(.loaded(AlertCardPreview.warning()))
                AlertCardPreview.card(.loaded(AlertCardPreview.acknowledged()))
                AlertCardPreview.card(.loaded(AlertCardPreview.success()))
                AlertCardPreview.card(.loaded(AlertCardPreview.system()))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Freshness · live / stale / offline") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AlertCardPreview.card(.loaded(AlertCardPreview.critical()), connection: .live)
                AlertCardPreview.card(.loaded(AlertCardPreview.critical()), connection: .stale)
                AlertCardPreview.card(.loaded(AlertCardPreview.critical()), connection: .offline)
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Chrome · loading / empty / error") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                AlertCardPreview.card(.loading)
                AlertCardPreview.card(.empty)
                AlertCardPreview.card(.error(message: nil))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
