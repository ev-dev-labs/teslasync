//
//  VehiclePhotoUpload.Previews.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline)
//  plus the in-flight upload chrome and the success/error toasts. DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import PhotosUI
import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

#if DEBUG

    // MARK: - Sample bytes

    /// A small, valid image encoded at preview time so the data/stale/offline previews show
    /// a real decoded photo rather than empty chrome. DEBUG-only.
    private func vehiclePhotoSampleData() -> Data {
        let size = CGSize(width: 360, height: 220)
        #if canImport(UIKit)
            let renderer = UIGraphicsImageRenderer(size: size)
            return renderer.pngData { context in
                UIColor(red: 0.04, green: 0.55, blue: 0.67, alpha: 1).setFill()
                context.fill(CGRect(origin: .zero, size: size))
                UIColor(red: 0.00, green: 0.94, blue: 1.00, alpha: 1).setFill()
                context.fill(CGRect(x: 40, y: 120, width: 280, height: 60))
            }
        #elseif canImport(AppKit)
            let image = NSImage(size: NSSize(width: size.width, height: size.height))
            image.lockFocus()
            NSColor(red: 0.04, green: 0.55, blue: 0.67, alpha: 1).setFill()
            NSRect(origin: .zero, size: image.size).fill()
            image.unlockFocus()
            guard
                let tiff = image.tiffRepresentation,
                let rep = NSBitmapImageRep(data: tiff),
                let png = rep.representation(using: .png, properties: [:])
            else { return Data() }
            return png
        #else
            return Data()
        #endif
    }

    // MARK: - Slow writer (DEBUG-only, drives the in-flight upload preview)

    /// A writer that holds the upload long enough for the "Uploading" preview to show the
    /// in-flight chrome, then reports success. DEBUG-only; never shipped.
    private struct SlowVehiclePhotoWriter: VehiclePhotoWriter {
        func upload(_: VehiclePhotoCandidate) async -> VehiclePhotoWriteResult {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            return .success
        }

        func delete() async -> VehiclePhotoWriteResult {
            .success
        }
    }

    @MainActor
    private func previewModel(
        _ update: VehiclePhotoUpdate,
        writer: any VehiclePhotoWriter = OSLogVehiclePhotoWriter()
    ) -> VehiclePhotoUploadModel {
        let source = InMemoryVehiclePhotoSource(initial: update)
        let model = VehiclePhotoUploadModel(source: source, writer: writer)
        model.start()
        return model
    }

    private func framed(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(maxWidth: 420)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }

    // MARK: - Full-surface state previews

    #Preview("Data — has photo") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(
                status: .loaded,
                meta: VehiclePhotoMeta(hasPhoto: true, uploadedAt: "2024-05-01T10:00:00Z"),
                imageData: vehiclePhotoSampleData()
            )))
        }
    }

    #Preview("Empty — no photo") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(status: .loaded, meta: .absent)))
        }
    }

    #Preview("Loading") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(status: .loading)))
        }
    }

    #Preview("Error") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(
                status: .failed("Network request timed out")
            )))
        }
    }

    #Preview("Stale — cached photo") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(
                status: .loaded,
                meta: VehiclePhotoMeta(hasPhoto: true, uploadedAt: "2024-05-01T10:00:00Z"),
                imageData: vehiclePhotoSampleData(),
                connection: .stale
            )))
        }
    }

    #Preview("Offline — cached photo") {
        framed {
            VehiclePhotoUpload(model: previewModel(VehiclePhotoUpdate(
                status: .loaded,
                meta: VehiclePhotoMeta(hasPhoto: true, uploadedAt: "2024-05-01T10:00:00Z"),
                imageData: vehiclePhotoSampleData(),
                connection: .offline
            )))
        }
    }

    #Preview("Uploading — in flight") {
        framed {
            VehiclePhotoUploadUploadingHost()
        }
    }

    /// Kicks an upload through a slow writer on appear so the surface shows the in-flight
    /// CTA + local preview (web `Uploading…`). DEBUG-only.
    private struct VehiclePhotoUploadUploadingHost: View {
        @State private var model = previewModel(
            VehiclePhotoUpdate(status: .loaded, meta: .absent),
            writer: SlowVehiclePhotoWriter()
        )

        var body: some View {
            VehiclePhotoUpload(model: model)
                .task {
                    await model.choose(VehiclePhotoCandidate.make(
                        data: vehiclePhotoSampleData(),
                        declaredMimeType: "image/png"
                    ))
                }
        }
    }

    // MARK: - Component previews

    #Preview("Toasts") {
        framed {
            VStack(spacing: TSSpacing.md) {
                VehiclePhotoToastView(
                    toast: VehiclePhotoToast(kind: .success, message: "Photo uploaded.")
                ) {}
                VehiclePhotoToastView(
                    toast: VehiclePhotoToast(kind: .error, message: "Photo upload failed.")
                ) {}
            }
        }
    }
#endif
