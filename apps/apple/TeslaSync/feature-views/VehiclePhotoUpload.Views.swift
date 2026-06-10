//
//  VehiclePhotoUpload.Views.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The presentational subviews composed by `VehiclePhotoUpload`: the panel header (title +
//  a small spinner / freshness chip), the dashed dropzone (web `border-2 border-dashed`
//  drag-drop + click-to-choose zone) with its `PhotosPicker` + drop target, the rendered
//  photo preview (web `<img>`), the constraints line, and the Choose/Replace + Remove
//  actions (web `<Button>`s). All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no web Tailwind ports live here.
//
//  Colour parity (ADR-006 semantic, not literal): the web drag-active `border-cyan-400
//  bg-cyan-500/10` maps to the brand `accent`; the idle `border-subtle bg-surface-2` maps
//  to `border` + a faint primary wash, so the zone adapts to both light and dark themes.
//

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Localization Text helper

extension VehiclePhotoStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Cross-platform image bridge (web `<img>`)

/// Builds a SwiftUI `Image` from raw bytes on either idiom (UIKit on iOS/iPadOS, AppKit on
/// macOS) — the native analogue of the web `<img src={dataURL}>`. Returns `nil` when the
/// bytes don't decode, so the caller can fall back to the loading chrome.
func vehiclePhotoImage(from data: Data) -> Image? {
    #if canImport(UIKit)
        guard let image = UIImage(data: data) else { return nil }
        return Image(uiImage: image)
    #elseif canImport(AppKit)
        guard let image = NSImage(data: data) else { return nil }
        return Image(nsImage: image)
    #else
        return nil
    #endif
}

// MARK: - Header (web `<h3>` + `meta.isLoading` spinner)

/// The panel header: the title and a trailing indicator — a small spinner during the
/// initial load (web `meta.isLoading ? <Spinner/>`) or the freshness chip when the bound
/// live-state is not fresh (P4 connectivity axis).
struct VehiclePhotoHeader: View {
    @Bindable var model: VehiclePhotoUploadModel

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            VehiclePhotoStrings.text("vehicles.photos.upload.title", "Vehicle photo")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            trailing
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var trailing: some View {
        if model.connection != .live {
            VehiclePhotoFreshnessChip(connection: model.connection)
        } else if model.phase == .loading || model.refreshing {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.loadingA11y", "Loading photo"))
        }
    }
}

// MARK: - Dropzone (web `border-2 border-dashed` drag-drop zone)

/// The dashed drop zone hosting the preview region, the constraints line, and the actions —
/// the native parity of the web dropzone `<div onDrop … onDragOver …>`. Accepts a dropped
/// image (web `e.dataTransfer.files[0]`) and tints its border while a drag is over it.
struct VehiclePhotoDropzone: View {
    @Bindable var model: VehiclePhotoUploadModel
    @State private var dragActive = false

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            previewRegion
            if let inline = model.inlineErrorMessage {
                VehiclePhotoInlineError(message: inline)
            }
            VehiclePhotoConstraintsText()
            VehiclePhotoActions(model: model)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.x2xl)
        .background(background)
        .overlay(border)
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: dragActive)
        .dropDestination(for: Data.self) { items, _ in
            guard let data = items.first else { return false }
            Task { await model.choose(VehiclePhotoCandidate.make(data: data)) }
            return true
        } isTargeted: { dragActive = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder
    private var previewRegion: some View {
        switch model.phase {
        case .loading:
            VehiclePhotoLoadingPreview()
        case let .error(message):
            VehiclePhotoErrorPreview(message: message) { model.refresh() }
        case .empty:
            VehiclePhotoEmptyPrompt()
        case .data:
            VehiclePhotoPreviewImage(data: model.displayImageData)
        }
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(dragActive ? Color.TS.accent.opacity(0.10) : Color.TS.textPrimary.opacity(0.03))
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .strokeBorder(
                dragActive ? Color.TS.accent : Color.TS.border,
                style: StrokeStyle(lineWidth: dragActive ? 2 : 1.5, dash: [6, 4])
            )
    }

    private var accessibilityLabel: String {
        VehiclePhotoAccessibility.dropzoneLabel(
            title: VehiclePhotoStrings.string("vehicles.photos.upload.title", "Vehicle photo"),
            statePhrase: model.previewStatePhrase(localizeChrome: VehiclePhotoStrings.string),
            constraints: VehiclePhotoStrings.string(
                "vehicles.photos.upload.constraints",
                "JPEG or PNG — up to {{max}} MB",
                "{{max}}",
                VehiclePhotoConstraints.maxMegabytesLabel
            )
        )
    }
}

// MARK: - Preview image (web `<img alt="Vehicle photo preview">`)

/// The rendered photo (web `<img>`), decoded from the bound bytes and clipped to a rounded
/// rect. Falls back to the loading chrome when the bytes don't decode, so the data branch
/// never collapses to a blank box.
struct VehiclePhotoPreviewImage: View {
    let data: Data?

    var body: some View {
        Group {
            if let data, let image = vehiclePhotoImage(from: data) {
                image
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 192)
                    .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            } else {
                VehiclePhotoLoadingPreview()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.previewAlt", "Vehicle photo preview"))
    }
}

// MARK: - Constraints line (web `JPEG or PNG — up to {{max}} MB`)

/// The size/format constraints copy, interpolating the megabyte cap (web
/// `t('…constraints', { max })`).
struct VehiclePhotoConstraintsText: View {
    var body: some View {
        Text(verbatim: VehiclePhotoStrings.string(
            "vehicles.photos.upload.constraints",
            "JPEG or PNG — up to {{max}} MB",
            "{{max}}",
            VehiclePhotoConstraints.maxMegabytesLabel
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Actions (web Choose/Replace + Remove `<Button>`s)

/// The action row: the primary `PhotosPicker` (Choose/Replace/Uploading…) and the optional
/// destructive "Remove photo" — the native parity of the web button cluster. Picking loads
/// the bytes locally and hands a validated candidate to the model; no networking lives here.
struct VehiclePhotoActions: View {
    @Bindable var model: VehiclePhotoUploadModel
    @State private var pickerItem: PhotosPickerItem?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            picker
            if model.canRemove {
                removeButton
            }
        }
        .frame(maxWidth: .infinity)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task { await load(item) }
        }
    }

    private var picker: some View {
        PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
            VehiclePhotoPrimaryButtonLabel(label: model.primaryLabel, isUploading: model.isUploading)
        }
        .disabled(model.isPrimaryDisabled)
        .accessibilityLabel(Text(verbatim: model.primaryLabel))
    }

    private var removeButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: model.isRemoving) {
            model.requestRemove()
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "trash")
                    .font(.system(size: 12, weight: .semibold))
                VehiclePhotoStrings.text("vehicles.photos.upload.remove", "Remove photo")
            }
        }
        .disabled(model.isRemoveDisabled)
        .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.remove", "Remove photo"))
    }

    /// Loads the picked item's bytes, resolves its MIME type, and hands a candidate to the
    /// model (which validates + uploads). Resets the selection so the same item can be
    /// re-picked after a rejection (web resets `input.value`).
    private func load(_ item: PhotosPickerItem) async {
        defer { pickerItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else { return }
        let candidate = VehiclePhotoCandidate.make(
            data: data,
            declaredMimeType: item.supportedContentTypes.first?.preferredMIMEType
        )
        await model.choose(candidate)
    }
}

// MARK: - Primary CTA label (styled to match the web primary `<Button>`)

/// The accent-filled label for the `PhotosPicker` trigger — the visual parity of the web
/// primary button, with a leading spinner while an upload runs (web `Uploading…`).
struct VehiclePhotoPrimaryButtonLabel: View {
    let label: String
    let isUploading: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if isUploading {
                ProgressView().controlSize(.small).tint(.white)
            } else {
                Image(systemName: "photo.on.rectangle.angled").font(.system(size: 12, weight: .semibold))
            }
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.semibold)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 28)
        .background(Color.TS.accent, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .opacity(isUploading ? 0.85 : 1)
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}
