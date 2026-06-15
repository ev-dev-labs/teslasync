import SwiftUI

/// Shared modal scaffold for the Backup & Restore write/preview dialogs: a titled header, a
/// scrolling body, and a trailing-aligned footer of actions. Reproduces the web `Modal` /
/// `ConfirmDialog` chrome as an HIG-native sheet, adaptive across macOS (sized window) and
/// iOS (content-sized sheet). Mirrors the sibling `FeatureFlagSheetScaffold`.
struct BackupSheetScaffold<Content: View, Footer: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TSPanelTitle(title)
                Spacer(minLength: TSSpacing.md)
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                content()
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                footer()
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 520, minHeight: 440)
        #endif
    }
}
