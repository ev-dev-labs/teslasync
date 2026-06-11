//
//  VehicleConfigSection.Previews.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a fully-populated config),
//  a partial variant (some fields null → `—` rows, exercising the boolean + nil-coalesce
//  ports), empty (resolved, no snapshot → web `EmptyState`), loading (initial skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentVCSectionTelemetry: VCSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum VCSectionPreviewData {
        /// A fully-populated configuration (every field present).
        static let full = VCSectionSnapshot(
            carType: "Model 3",
            trim: "Long Range AWD",
            exteriorColor: "Deep Blue Metallic",
            wheelType: "Stiletto 19\"",
            roofColor: "Glass",
            chargePort: "CCS",
            rightHandDrive: false,
            europeVehicle: true,
            offroadLightbarPresent: false,
            rearSeatHeaters: "Standard",
            sunroofInstalled: "None",
            softwareUpdateVersion: "2024.44.25.2",
            softwareVersion: "2024.44.25"
        )

        /// A partial configuration: some strings + booleans missing (→ `—`), and the software
        /// row falling back to the `softwareVersion` prop.
        static let partial = VCSectionSnapshot(
            carType: "Model Y",
            trim: nil,
            exteriorColor: "Pearl White",
            wheelType: nil,
            roofColor: nil,
            chargePort: nil,
            rightHandDrive: true,
            europeVehicle: nil,
            offroadLightbarPresent: nil,
            rearSeatHeaters: nil,
            sunroofInstalled: nil,
            softwareUpdateVersion: nil,
            softwareVersion: "2024.38.6"
        )

        static func update(
            status: VCSectionLoadStatus = .loaded,
            snapshot: VCSectionSnapshot? = VCSectionPreviewData.full,
            connection: VCSectionConnection = .live
        ) -> VCSectionUpdate {
            VCSectionUpdate(status: status, snapshot: snapshot, connection: connection)
        }
    }

    @MainActor
    private func vcSectionPreview(_ update: VCSectionUpdate) -> VehicleConfigSection {
        VehicleConfigSection(
            model: VehicleConfigSectionModel(
                source: InMemoryVehicleConfigSectionSource(initial: update),
                telemetry: SilentVCSectionTelemetry()
            )
        )
    }

    #Preview("Content") {
        vcSectionPreview(VCSectionPreviewData.update())
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Content · partial") {
        vcSectionPreview(VCSectionPreviewData.update(snapshot: VCSectionPreviewData.partial))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Empty") {
        vcSectionPreview(VCSectionPreviewData.update(snapshot: nil))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Loading") {
        vcSectionPreview(VCSectionPreviewData.update(status: .loading, snapshot: nil))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Error") {
        vcSectionPreview(VCSectionPreviewData.update(status: .failed("Request timed out"), snapshot: nil))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Stale") {
        vcSectionPreview(VCSectionPreviewData.update(connection: .stale))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Offline") {
        vcSectionPreview(VCSectionPreviewData.update(connection: .offline))
            .padding()
            .frame(maxWidth: 560)
    }
#endif
