//
//  VehiclePhotoUpload.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The vehicle-photo uploader — the SwiftUI parity of
//  features/vehicles/components/VehiclePhotoUpload.tsx. Fades in on appear (web `<FadeIn>`
//  is implicit in the page) inside a GlassPanel, shows the cached-data banner when the
//  bound live-state is not fresh, renders an always-on header (title + a small spinner /
//  freshness chip), and hosts the dashed dropzone: a drag-drop + PhotosPicker zone whose
//  preview region switches over the model's resolved phase so every prompt-required state
//  renders (loading / empty / error / data, with the inline-error + stale + offline
//  branches), the constraints line ("JPEG or PNG — up to {{max}} MB"), and the
//  Choose/Replace + Remove actions. A destructive confirmation gates the delete (web
//  `ConfirmDialog`), and the save/delete/reject toast floats over the top. All data +
//  mutations bind through `VehiclePhotoUploadModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The vehicle-photo uploader — the SwiftUI parity of the web `VehiclePhotoUpload`,
/// binding through `VehiclePhotoUploadModel` (P1/S8).
public struct VehiclePhotoUpload: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehiclePhotoSurface.slug

    @State private var model: VehiclePhotoUploadModel

    public init(model: VehiclePhotoUploadModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    VehiclePhotoConnectivityBanner(connection: model.connection)
                }
                VehiclePhotoHeader(model: model)
                VehiclePhotoDropzone(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .overlay(alignment: .top) { toastOverlay }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .vehiclePhotoRemoveConfirmation(model: model)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            VehiclePhotoToastView(toast: toast) { model.dismissToast() }
                .padding(.horizontal, TSSpacing.lg)
                .padding(.top, TSSpacing.sm)
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

// MARK: - Delete confirmation (web `ConfirmDialog variant="danger"`)

/// Confirms removing the current photo — the native parity of the web `ConfirmDialog`
/// ("Remove vehicle photo?" / "The hero card will fall back to the stock model render…").
/// Presented while the model holds `pendingRemove`; the destructive role mirrors the web
/// danger variant. The native dialog dismisses on tap, so the panel's "Remove" CTA carries
/// the in-flight spinner (web `loading`).
private struct VehiclePhotoRemoveConfirmation: ViewModifier {
    @Bindable var model: VehiclePhotoUploadModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            Text(verbatim: VehiclePhotoStrings.string(
                "vehicles.photos.upload.confirmRemoveTitle", "Remove vehicle photo?"
            )),
            isPresented: presented,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.confirmRemove() }
            } label: {
                Text(verbatim: VehiclePhotoStrings.string("common.remove", "Remove"))
            }
            Button(role: .cancel) {
                model.cancelRemove()
            } label: {
                Text(verbatim: VehiclePhotoStrings.string("vehicles.photos.upload.confirmRemoveCancel", "Cancel"))
            }
        } message: {
            Text(verbatim: VehiclePhotoStrings.string(
                "vehicles.photos.upload.confirmRemoveMessage",
                "The hero card will fall back to the stock model render until a new photo is uploaded."
            ))
        }
    }

    private var presented: Binding<Bool> {
        Binding(
            get: { model.pendingRemove },
            set: { isPresented in if !isPresented { model.cancelRemove() } }
        )
    }
}

extension View {
    /// Attaches the delete confirmation bound through the model. Applied once by
    /// `VehiclePhotoUpload`.
    func vehiclePhotoRemoveConfirmation(model: VehiclePhotoUploadModel) -> some View {
        modifier(VehiclePhotoRemoveConfirmation(model: model))
    }
}
