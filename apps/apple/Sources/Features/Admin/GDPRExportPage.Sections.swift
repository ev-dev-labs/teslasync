import SwiftUI

// Artifact sub-sections for `GDPRExportPage`, split out so the page file stays an
// orchestrator. Each view maps to a named manifest panel and binds purely from the
// `@Observable` model's loaded artifact (ADR-004 — no networking here). All copy
// resolves from `Localizable.xcstrings` with the web key names; dynamic server tokens
// (status, ids, hashes, timestamps, error text) render verbatim like the web source.

// MARK: - Summary grid (web grid: Status GlassPanel + Format/Size/Storage StatCards)

/// The four-cell artifact summary (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`).
/// Cell 1 is the Status panel (manifest `GlassPanel3`); cells 2–4 are the Format /
/// Size / Storage stat cards (manifest panels `Format` / `Size` / `Storage`).
struct GDPRArtifactSummary: View {
    let artifact: GDPRExportArtifact
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            statusPanel
            TSStatCard(
                title: "admin.gdprExport.formatLabel",
                value: artifact.format.isEmpty ? GDPRExportFormat.emptyValue : artifact.format
            )
            TSStatCard(
                title: "admin.gdprExport.bytesLabel",
                value: GDPRExportFormat.bytes(artifact.bytes)
            )
            TSStatCard(
                title: "admin.gdprExport.storageLabel",
                value: storageValue
            )
        }
    }

    private var storageValue: String {
        guard let storage = artifact.storage, !storage.isEmpty else { return GDPRExportFormat.emptyValue }
        return storage
    }

    /// Manifest `GlassPanel3`: the status label + the verbatim status badge (web
    /// `<Badge variant={STATUS_VARIANT[status]} size="lg">{status}</Badge>`).
    private var statusPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSCaption("admin.gdprExport.statusLabel")
                TSBadge("\(artifact.status.rawValue)", tone: artifact.status.tone)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("admin.gdprExport.statusLabel"))
        .accessibilityValue(Text(verbatim: artifact.status.rawValue))
    }
}

// MARK: - Artifact details (web GlassPanel — `<dl>` of meta rows)

/// Manifest `GlassPanel7`: the artifact metadata list (web `Artifact details` panel).
/// Renders ID + optional User / Completed / Expires / SHA-256 and the always-present
/// Created row, each as a `GDPRMetaRow`, in a 1-col (compact) / 2-col (regular) grid.
struct GDPRArtifactDetails: View {
    let artifact: GDPRExportArtifact
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), alignment: .top)]
            : [GridItem(.flexible(), alignment: .top), GridItem(.flexible(), alignment: .top)]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("admin.gdprExport.metaTitle")
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                    idRow
                    if let userID = artifact.userID, !userID.isEmpty {
                        GDPRMetaRow(label: "admin.gdprExport.metaUser") {
                            Text(verbatim: userID)
                                .font(Font.TS.body)
                                .foregroundStyle(Color.TS.textPrimary)
                        }
                    }
                    timestampRow(label: "admin.gdprExport.metaCreated", iso: artifact.createdAt)
                    if let completed = artifact.completedAt, !completed.isEmpty {
                        timestampRow(label: "admin.gdprExport.metaCompleted", iso: completed)
                    }
                    if let expires = artifact.expiresAt, !expires.isEmpty {
                        timestampRow(label: "admin.gdprExport.metaExpires", iso: expires)
                    }
                    if let sha = artifact.sha256, !sha.isEmpty {
                        GDPRMetaRow(label: "admin.gdprExport.metaSha256") {
                            HStack(spacing: TSSpacing.sm) {
                                Text(verbatim: sha)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(Color.TS.textSecondary)
                                    .textSelection(.enabled)
                                TSCopyButton(value: sha)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web ID row: monospaced id + copy button.
    private var idRow: some View {
        GDPRMetaRow(label: "admin.gdprExport.metaId") {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: artifact.id)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                TSCopyButton(value: artifact.id)
            }
        }
    }

    /// Web timestamp row: absolute datetime + relative caption beneath.
    private func timestampRow(label: LocalizedStringKey, iso: String) -> some View {
        GDPRMetaRow(label: label) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: GDPRExportFormat.dateTime(iso))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: GDPRExportFormat.relative(iso))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// One label/value metadata cell (web `MetaRow`): a caption above caller content.
struct GDPRMetaRow<Content: View>: View {
    let label: LocalizedStringKey
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(label)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Download panel (web GlassPanel — Download)

/// Manifest `GlassPanel8`: the download affordance (web `Download` panel). When the
/// artifact is complete it shows the hint + a button that opens the binary-stream URL;
/// otherwise it shows the status-specific unavailable caption (wait / expired / failed).
struct GDPRDownloadPanel: View {
    let canDownload: Bool
    let downloadURL: URL?
    let unavailableKey: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("admin.gdprExport.downloadTitle")
                if canDownload {
                    TSText("admin.gdprExport.downloadHint", variant: .small)
                    TSButton(variant: .primary, size: .medium) {
                        if let downloadURL { openURL(downloadURL) }
                    } label: {
                        Label("admin.gdprExport.downloadButton", systemImage: "arrow.down.circle.fill")
                    }
                    .disabled(downloadURL == nil)
                } else {
                    TSCaption(LocalizedStringKey(unavailableKey))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.gdprExport.downloadTitle"))
    }
}
