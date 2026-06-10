//
//  VehiclePhotoUpload.States.swift
//  TeslaSync — P4 feature view · 0307 · VehiclePhotoUpload (Apple)
//
//  The preview-region states `VehiclePhotoUpload` renders inside the dropzone — loading
//  (skeleton chrome), empty (the web drop prompt), error (a first-load failure with retry,
//  the dropzone staying usable), plus the inline list-error above a cached photo, the
//  live-state freshness chip, the cached-data banner, and the upload/delete toast. Every
//  state renders real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial fetch → skeleton)

/// The initial-fetch chrome — a shimmer block sized to the photo preview, so the dropzone
/// keeps its shape while the metadata + bytes resolve (web `meta.isLoading`).
struct VehiclePhotoLoadingPreview: View {
    var body: some View {
        TSSkeleton(height: 192, cornerRadius: TSRadius.md)
            .frame(maxWidth: .infinity)
            .accessibilityElement()
            .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.loadingA11y", "Loading photo"))
    }
}

// MARK: - Empty (web drop prompt)

/// The resolved-but-no-photo state — the web `Drag a photo here or click to choose a file`
/// prompt over a centred glyph, never a blank box. The Choose CTA lives below in the
/// actions row (web layout), so this state carries no button.
struct VehiclePhotoEmptyPrompt: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 32, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VehiclePhotoStrings.text(
                "vehicles.photos.upload.dropPrompt",
                "Drag a photo here or click to choose a file"
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 132)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (first-load failure → retry; dropzone stays usable)

/// The fetch-failure state with a retry affordance — a `QueryError`-style block so a
/// first-load failure with no cached photo isn't a blank box. The Choose CTA below stays
/// usable, so a failed metadata read never blocks a fresh upload.
struct VehiclePhotoErrorPreview: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VehiclePhotoStrings.text("vehicles.photos.upload.errorTitle", "Couldn't load photo")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 132)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            VehiclePhotoStrings.text("vehicles.photos.upload.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.retry", "Retry"))
    }
}

// MARK: - Inline error (failed reload with a cached photo still on screen)

/// The inline error shown above a still-visible cached photo when a reload failed, so the
/// image stays put while the failure surfaces (web keeps the prior `<img>`).
struct VehiclePhotoInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .lineLimit(2)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct VehiclePhotoFreshnessChip: View {
    let connection: VehiclePhotoConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            VehiclePhotoStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(VehiclePhotoStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: VehiclePhotoConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "vehicles.photos.upload.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "vehicles.photos.upload.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "vehicles.photos.upload.offlineChip", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the panel content when the bound source is not live,
/// so a cached photo is clearly labelled (ADR-013).
struct VehiclePhotoConnectivityBanner: View {
    let connection: VehiclePhotoConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "vehicles.photos.upload.offlineBanner" : "vehicles.photos.upload.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded photo"
            : "Reconnecting — this photo may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            VehiclePhotoStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Toast (web `useToast`)

/// The transient upload/delete/reject toast surfaced over the panel top (web
/// `toast.success` / `toast.error`). Renders pre-localized copy verbatim with a manual
/// dismiss.
struct VehiclePhotoToastView: View {
    let toast: VehiclePhotoToast
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: symbol).foregroundStyle(tone).accessibilityHidden(true)
            Text(verbatim: toast.message)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(VehiclePhotoStrings.text("vehicles.photos.upload.toastDismiss", "Dismiss"))
        }
        .padding(TSSpacing.md)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private var tone: Color {
        switch toast.kind {
        case .success: Color.TS.statusSuccess
        case .error: Color.TS.statusDanger
        }
    }

    private var symbol: String {
        switch toast.kind {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }
}
