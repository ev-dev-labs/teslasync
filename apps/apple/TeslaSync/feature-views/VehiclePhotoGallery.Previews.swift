//
//  VehiclePhotoGallery.Previews.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline)
//  plus the immersive viewer. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

#if DEBUG

    // MARK: - Sample bytes

    /// A small, valid image encoded at preview time so the data/stale/offline previews show a
    /// real decoded photo rather than empty chrome. The hue varies by seed so a grid reads as
    /// distinct tiles. DEBUG-only.
    private func photoGallerySampleData(seed: Int) -> Data {
        let size = CGSize(width: 320, height: 320)
        let hue = Double(seed % 6) / 6.0
        #if canImport(UIKit)
            let renderer = UIGraphicsImageRenderer(size: size)
            return renderer.pngData { context in
                UIColor(hue: CGFloat(hue), saturation: 0.55, brightness: 0.7, alpha: 1).setFill()
                context.fill(CGRect(origin: .zero, size: size))
                UIColor(hue: CGFloat(hue), saturation: 0.85, brightness: 1, alpha: 1).setFill()
                context.fill(CGRect(x: 40, y: 200, width: 240, height: 60))
            }
        #elseif canImport(AppKit)
            let image = NSImage(size: NSSize(width: size.width, height: size.height))
            image.lockFocus()
            NSColor(hue: CGFloat(hue), saturation: 0.55, brightness: 0.7, alpha: 1).setFill()
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

    private func photoGallerySamplePhotos(_ count: Int) -> [PhotoGalleryImage] {
        (0 ..< count).map { index in
            PhotoGalleryImage(
                id: "photo-\(index)",
                alt: "Vehicle photo \(index + 1)",
                caption: index == 0 ? "Front three-quarter" : nil,
                data: photoGallerySampleData(seed: index)
            )
        }
    }

    @MainActor
    private func previewModel(_ update: PhotoGalleryUpdate, vehicleName: String? = nil) -> PhotoGalleryModel {
        let source = InMemoryPhotoGallerySource(initial: update)
        let model = PhotoGalleryModel(source: source, vehicleName: vehicleName)
        model.start()
        return model
    }

    private func framed(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        content()
            .frame(maxWidth: 520)
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
    }

    // MARK: - Full-surface state previews

    #Preview("Data — grid") {
        framed {
            VehiclePhotoGallery(model: previewModel(
                PhotoGalleryUpdate(status: .loaded, photos: photoGallerySamplePhotos(7)),
                vehicleName: "Model 3 Performance"
            ))
        }
    }

    #Preview("Empty — no photos") {
        framed {
            VehiclePhotoGallery(model: previewModel(PhotoGalleryUpdate(status: .loaded, photos: [])))
        }
    }

    #Preview("Loading") {
        framed {
            VehiclePhotoGallery(model: previewModel(PhotoGalleryUpdate(status: .loading)))
        }
    }

    #Preview("Error") {
        framed {
            VehiclePhotoGallery(model: previewModel(
                PhotoGalleryUpdate(status: .failed("Network request timed out"))
            ))
        }
    }

    #Preview("Stale — cached grid") {
        framed {
            VehiclePhotoGallery(model: previewModel(PhotoGalleryUpdate(
                status: .loaded,
                photos: photoGallerySamplePhotos(5),
                connection: .stale
            )))
        }
    }

    #Preview("Offline — cached grid") {
        framed {
            VehiclePhotoGallery(model: previewModel(PhotoGalleryUpdate(
                status: .loaded,
                photos: photoGallerySamplePhotos(4),
                connection: .offline
            )))
        }
    }

    // MARK: - Immersive viewer

    #Preview("Viewer — open") {
        VehiclePhotoGalleryViewerHost()
            .background(Color.black)
    }

    /// Opens the immersive viewer on appear so the preview shows the full-frame image + caption
    /// + controls (web `<Lightbox open>`). DEBUG-only.
    private struct VehiclePhotoGalleryViewerHost: View {
        @State private var model = previewModel(
            PhotoGalleryUpdate(status: .loaded, photos: photoGallerySamplePhotos(6))
        )

        var body: some View {
            PhotoGalleryViewer(model: model)
                .onAppear { model.open(at: 1) }
        }
    }
#endif
