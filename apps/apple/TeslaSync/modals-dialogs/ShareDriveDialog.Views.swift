//
//  ShareDriveDialog.Views.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The populated content for `ShareDriveDialog`: the modal header (link glyph + "Share Drive" title +
//  freshness chip + close), the scrolling body (the create-or-result section, the connectivity banner,
//  and the "Active Share Links" section), the create form's description / generate footer, and the
//  success result panel (created banner, read-only URL, Copy / open, "Create another link"). All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). The interactive form inputs
//  live in ShareDriveDialog.Controls.swift; the existing-links list lives in ShareDriveDialog.Rows.swift.
//

import SwiftUI

// MARK: - Header (web `Modal` title + close)

/// The dialog header: the link glyph, the "Share Drive" title + freshness chip, and the trailing close
/// button (web `Modal` title bar with its `onClose` "×").
struct ShareDriveHeader: View {
    let connection: ShareDriveConnection
    let title: String
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                ShareDriveFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "link")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: closeLabel))
    }
}

// MARK: - Content (web populated modal body)

/// The scrolling body: the connectivity banner (when not live), the create-or-result section, a
/// divider, and the "Active Share Links" section (web `space-y-6`).
struct ShareDriveContentView: View {
    @Bindable var model: ShareDriveModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    ShareDriveConnectivityBanner(connection: model.connection)
                }
                if model.hasResult {
                    ShareDriveResultView(model: model)
                } else {
                    ShareDriveCreateForm(model: model)
                }
                Divider().overlay(Color.TS.border)
                ShareDriveLinksSection(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Create form (web create branch)

/// The create form (web `!shareUrl` branch): the description, the title field, the two include toggles,
/// the expiry picker, an inline create error, and the full-width "Generate Link" footer.
struct ShareDriveCreateForm: View {
    @Bindable var model: ShareDriveModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ShareDriveDescription()
            ShareDriveTitleField(model: model)
            VStack(spacing: TSSpacing.sm) {
                ShareDriveToggleRow(
                    label: model.localize("share.includeSpeed", "Include speed data"),
                    isOn: $model.includeSpeed
                )
                ShareDriveToggleRow(
                    label: model.localize(
                        "share.includeTelemetry",
                        "Include detailed telemetry (battery, power)"
                    ),
                    isOn: $model.includeTelemetry
                )
            }
            ShareDriveExpiryPicker(model: model)
            if let error = model.createError {
                ShareDriveErrorLine(message: error)
            }
            generateButton
        }
    }

    private var generateButton: some View {
        TSButton(variant: .primary, size: .medium, isLoading: model.isCreating, action: model.generate) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "link")
                    .font(.system(size: 13, weight: .semibold))
                Text(verbatim: model.localize("share.generate", "Generate Link"))
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text(verbatim: model.localize("share.generate", "Generate Link")))
    }
}

/// The intro paragraph above the form (web `share.description`).
struct ShareDriveDescription: View {
    var body: some View {
        ShareDriveStrings.text(
            "share.description",
            "Generate a public link to share this drive report. Anyone with the link can view the "
                + "map, stats, and charts — no login required."
        )
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Result panel (web `shareUrl` branch)

/// The success result panel (web `shareUrl` branch): the "Share link created!" banner, the read-only
/// URL, the Copy / open-in-browser row, and the "Create another link" reset.
struct ShareDriveResultView: View {
    @Bindable var model: ShareDriveModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ShareDriveStrings.text("share.created", "Share link created!")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.statusSuccess)
            ShareDriveReadonlyURL(url: model.resultURL)
            HStack(spacing: TSSpacing.sm) {
                ShareDriveCopyButton(
                    label: model.localize("share.copy", "Copy Link"),
                    onCopy: model.copyResultURL
                )
                .frame(maxWidth: .infinity)
                ShareDriveOpenButton(
                    urlString: model.resultURL,
                    label: model.localize("share.open", "Open in browser")
                )
            }
            TSButton(variant: .ghost, size: .medium, action: model.createAnother) {
                Text(verbatim: model.localize("share.createAnother", "Create another link"))
            }
            .frame(maxWidth: .infinity)
        }
    }
}

/// The read-only share-URL field (web `<Input value={shareUrl} readOnly />`): monospaced + selectable
/// over token chrome.
struct ShareDriveReadonlyURL: View {
    let url: String

    var body: some View {
        Text(verbatim: url)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: url))
    }
}

// MARK: - Shared error line (web create error)

/// A shared inline error line (web create-failure copy) with a warning glyph.
struct ShareDriveErrorLine: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Copy / open buttons (web `CopyButton` / `ExternalLink`)

/// The primary "Copy Link" button with a transient confirmation (web result-panel `CopyButton`). The
/// copy itself is performed by the injected model command (clipboard seam); this view only reflects the
/// brief confirmation.
struct ShareDriveCopyButton: View {
    let label: String
    let onCopy: () -> Void
    @State private var didCopy = false

    var body: some View {
        TSButton(variant: .primary, size: .medium, action: copy) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 13, weight: .semibold))
                Text(verbatim: label)
            }
        }
        .accessibilityLabel(Text(verbatim: label))
    }

    private func copy() {
        onCopy()
        didCopy = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopy = false
        }
    }
}

/// The outline "Open in browser" button (web `Button variant="outline"` with the `ExternalLink` icon
/// that `window.open`s the URL). Uses the SwiftUI `openURL` environment for the HIG-native open.
struct ShareDriveOpenButton: View {
    let urlString: String
    let label: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button(action: open) {
            Image(systemName: "arrow.up.right.square")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 36, height: 36)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(URL(string: urlString) == nil)
        .accessibilityLabel(Text(verbatim: label))
    }

    private func open() {
        guard let url = URL(string: urlString) else { return }
        openURL(url)
    }
}
