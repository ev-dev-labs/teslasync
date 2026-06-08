//
//  EndpointSidebar.Previews.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  Xcode previews for each surface state (content / filtered / no-matches /
//  loading / empty / error / stale / offline). DEBUG-only; skipped by the swiftc
//  host gate and never shipped in release.
//

import SwiftUI

#if DEBUG
    private enum EndpointSidebarPreviewData {
        static let endpoints: [ParsedEndpoint] = [
            ParsedEndpoint(
                method: .get, path: "/vehicles", tag: "Vehicles",
                summary: "List vehicles", operationId: "listVehicles"
            ),
            ParsedEndpoint(
                method: .get, path: "/vehicles/{vehicleID}/state", tag: "Vehicles",
                summary: "Vehicle state", operationId: "getVehicleState"
            ),
            ParsedEndpoint(
                method: .post, path: "/vehicles/{vehicleID}/command", tag: "Vehicles",
                summary: "Send command", operationId: "sendCommand"
            ),
            ParsedEndpoint(
                method: .get, path: "/charging", tag: "Charging",
                summary: "Charging sessions", operationId: "listCharging"
            ),
            ParsedEndpoint(
                method: .delete, path: "/charging/{sessionID}", tag: "Charging",
                summary: "Delete session", operationId: "deleteChargingSession"
            ),
            ParsedEndpoint(
                method: .get, path: "/drives", tag: "Drives",
                summary: "List drives", operationId: "listDrives"
            ),
            ParsedEndpoint(
                method: .put, path: "/drives/{driveID}", tag: "Drives",
                summary: "Update drive", operationId: "updateDrive"
            ),
            ParsedEndpoint(
                method: .patch, path: "/alerts/rules", tag: "Alerts",
                summary: "Patch alert rule", operationId: "patchAlertRule"
            ),
            ParsedEndpoint(
                method: .get, path: "/system/status", tag: "System",
                summary: "System status", operationId: "getSystemStatus"
            )
        ]

        static let selected = endpoints[1]
    }

    private func endpointPreviewModel(
        _ update: EndpointSidebarUpdate,
        search: String = ""
    ) -> EndpointSidebarModel {
        let source = InMemoryEndpointCatalogSource(initial: update)
        let model = EndpointSidebarModel(source: source)
        model.start()
        model.search = search
        return model
    }

    private func loadedUpdate(
        connection: EndpointConnection = .live,
        updatedAt: Date? = Date()
    ) -> EndpointSidebarUpdate {
        EndpointSidebarUpdate(
            status: .loaded,
            connection: connection,
            endpoints: EndpointSidebarPreviewData.endpoints,
            selected: EndpointSidebarPreviewData.selected,
            updatedAt: updatedAt
        )
    }

    private struct EndpointSidebarPreviewFrame<Content: View>: View {
        let content: Content
        init(@ViewBuilder content: () -> Content) {
            self.content = content()
        }

        var body: some View {
            content
                .frame(width: 300, height: 520)
                .background(Color.TS.bg)
        }
    }

    #Preview("Content (live)") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(model: endpointPreviewModel(loadedUpdate()))
        }
    }

    #Preview("Filtered (search)") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(model: endpointPreviewModel(loadedUpdate(), search: "charg"))
        }
    }

    #Preview("No matches") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(model: endpointPreviewModel(loadedUpdate(), search: "zzzzz"))
        }
    }

    #Preview("Loading") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(model: endpointPreviewModel(EndpointSidebarUpdate(status: .loading)))
        }
    }

    #Preview("Empty") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(
                model: endpointPreviewModel(EndpointSidebarUpdate(status: .empty, endpoints: []))
            )
        }
    }

    #Preview("Error") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(
                model: endpointPreviewModel(EndpointSidebarUpdate(status: .failed("Network unavailable")))
            )
        }
    }

    #Preview("Stale") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(
                model: endpointPreviewModel(
                    loadedUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-180))
                )
            )
        }
    }

    #Preview("Offline (cached)") {
        EndpointSidebarPreviewFrame {
            EndpointSidebarView(
                model: endpointPreviewModel(
                    loadedUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-900))
                )
            )
        }
    }
#endif
