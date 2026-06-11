//
//  ChartContainer.Chrome.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The toolbar + connectivity chrome split out of `…Views.swift` (one file ≤ 400 lines per the
//  SwiftLint contract): the P4 leaf connectivity chip + banner and the freshness helper, the category
//  colour palette (web `ANNOTATION_COLORS` → `Color`), the cross-platform image/CSV export helpers,
//  the export menu (web `ChartExportMenu`), and the fullscreen toggle button (web `FullscreenButton`).
//  All copy resolves through the P1/S10 facade and all colour comes from the P1/S9 tokens; no
//  networking, no raw hex outside the generated category palette.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by
/// the chip and the banner so the copy stays consistent and is asserted in one place.
enum ChartContainerFreshness {
    static func label(for connection: ChartContainerConnection) -> String {
        switch connection {
        case .live: ChartContainerStrings.string("chartContainer.live", "Live")
        case .stale: ChartContainerStrings.string("chartContainer.stale", "Stale")
        case .offline: ChartContainerStrings.string("chartContainer.offline", "Offline")
        }
    }

    static func note(for connection: ChartContainerConnection) -> String {
        switch connection {
        case .live:
            ChartContainerStrings.string("chartContainer.live", "Live")
        case .stale:
            ChartContainerStrings.string("chartContainer.staleA11y", "Stale — tap refresh to update")
        case .offline:
            ChartContainerStrings.string("chartContainer.offlineA11y", "Offline — showing the last known chart")
        }
    }

    static func tone(for connection: ChartContainerConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Category palette (web `ANNOTATION_COLORS` → Color)

/// Maps an annotation category to its render colour — the native projection of the web
/// `ANNOTATION_COLORS` hex palette onto a SwiftUI `Color`. Parsing failures fall back to the muted
/// token so a colour is always produced.
enum ChartContainerPalette {
    static func color(for category: ChartContainerAnnotationCategory) -> Color {
        color(hex: category.colorHex) ?? Color.TS.textMuted
    }

    static func color(hex: String) -> Color? {
        var trimmed = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") { trimmed.removeFirst() }
        guard trimmed.count == 6, let value = UInt32(trimmed, radix: 16) else { return nil }
        let red = Double((value >> 16) & 0xFF) / 255
        let green = Double((value >> 8) & 0xFF) / 255
        let blue = Double(value & 0xFF) / 255
        return Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
    }
}

// MARK: - Cross-platform export helpers (web `useChartExport` + CSV)

#if canImport(UIKit)
    typealias ChartContainerPlatformImage = UIImage
#elseif canImport(AppKit)
    typealias ChartContainerPlatformImage = NSImage
#endif

/// Writes an image / text to the system pasteboard — the native parity of the web "Copy image" +
/// "Download data as CSV" affordances (copy is the terminal action on both platforms).
enum ChartContainerPasteboard {
    static func copy(image: ChartContainerPlatformImage) {
        #if canImport(UIKit)
            UIPasteboard.general.image = image
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([image])
        #endif
    }

    static func copy(text: String) {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

// MARK: - Export menu (web `ChartExportMenu`)

/// The chart toolbar's export overflow — the native port of the web `ChartExportMenu`: copy the
/// rendered chart as an image, and (when CSV data is supplied) copy the underlying data as CSV. Both
/// terminal actions are real (pasteboard writes); the menu is only mounted by the toolbar once the
/// chart has rendered with data (web `showExportMenu`).
struct ChartContainerExportMenu: View {
    let hasCsv: Bool
    let renderImage: @MainActor () -> ChartContainerPlatformImage?
    let csv: @MainActor () -> String?

    var body: some View {
        Menu {
            Button {
                if let image = renderImage() { ChartContainerPasteboard.copy(image: image) }
            } label: {
                Label(
                    title: { Text(verbatim: ChartContainerStrings.string("chart.export.copyImage", "Copy image")) },
                    icon: { Image(systemName: "photo.on.rectangle") }
                )
            }
            if hasCsv {
                Button {
                    if let data = csv() { ChartContainerPasteboard.copy(text: data) }
                } label: {
                    Label(
                        title: {
                            Text(verbatim: ChartContainerStrings.string("chart.export.copyCsv", "Copy data as CSV"))
                        },
                        icon: { Image(systemName: "tablecells") }
                    )
                }
            }
        } label: {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 28, height: 28)
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel(Text(verbatim: ChartContainerStrings.string("chart.export.menu", "Export chart")))
    }
}

// MARK: - Fullscreen toggle (web `FullscreenButton`)

/// The toolbar fullscreen toggle — the native port of the web `FullscreenButton`. Flips the surface's
/// expanded binding; the surface presents the enlarged figure (web Fullscreen API). The label tracks
/// the current state so VoiceOver announces the action it will perform.
struct ChartContainerFullscreenButton: View {
    @Binding var expanded: Bool

    private var label: String {
        expanded
            ? ChartContainerStrings.string("chart.fullscreen.exit", "Exit fullscreen")
            : ChartContainerStrings.string("chart.fullscreen.enter", "View fullscreen")
    }

    var body: some View {
        Button {
            expanded.toggle()
        } label: {
            Image(systemName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity chip (P4 leaf — toolbar status)

/// The freshness chip + manual refresh affordance on the chart toolbar — a coloured dot with the
/// freshness label and a refresh button so pointer + VoiceOver users can recover a stale / offline
/// chart. Rendered for every state (live included) so the toolbar has a stable shape.
struct ChartContainerConnectivityChip: View {
    let connection: ChartContainerConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(ChartContainerFreshness.tone(for: connection))
                .frame(width: 6, height: 6)
            Text(verbatim: ChartContainerFreshness.label(for: connection))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: ChartContainerStrings.string("chartContainer.refresh", "Refresh")))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ChartContainerFreshness.note(for: connection)))
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown above the chart body when the snapshot is not live — a tinted
/// inline callout explaining why the chart may show older data. Hidden entirely when live.
struct ChartContainerConnectivityBanner: View {
    let connection: ChartContainerConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? ChartContainerStrings.string("chartContainer.offlineBanner", "Offline — showing last known data")
            : ChartContainerStrings.string("chartContainer.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
