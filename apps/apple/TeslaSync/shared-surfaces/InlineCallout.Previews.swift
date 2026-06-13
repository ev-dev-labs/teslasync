//
//  InlineCallout.Previews.swift
//  TeslaSync — P4 shared surface · 0124 · InlineCallout (Apple)
//
//  Xcode previews for every branch of the contextual callout: the four severity variants, the
//  with-/without-icon forms, and the three wrapper interactions (status row / link / button), plus a
//  long-message wrap and a dense stack. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 380, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Variants — status rows") {
        staged("info · success · warning · danger") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                InlineCallout(.info, message: "Live data is up to date.", icon: "info.circle.fill")
                InlineCallout(.success, message: "All 4 vehicles synced.", icon: "checkmark.circle.fill")
                InlineCallout(.warning, message: "1 anomaly in this range.", icon: "exclamationmark.triangle.fill")
                InlineCallout(.danger, message: "Fleet telemetry stream offline.", icon: "xmark.octagon.fill")
            }
        }
    }

    #Preview("Actions — link / button") {
        staged("href link · onClick button · no action") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                InlineCallout(
                    .warning,
                    message: "1 anomaly in this range — Apr 24",
                    icon: "exclamationmark.triangle.fill",
                    action: .link("View", url: URL(string: "https://teslasync.local/drives")!)
                )
                InlineCallout(
                    .info,
                    message: "New firmware available for review.",
                    icon: "info.circle.fill",
                    action: .button("Details") {}
                )
                InlineCallout(.success, message: "Export ready.", icon: "checkmark.circle.fill")
            }
        }
    }

    #Preview("No icon + long wrap") {
        staged("iconless · multi-line body") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                InlineCallout(.info, message: "No leading icon — just the tinted status row.")
                InlineCallout(
                    .danger,
                    message: "This is a longer callout body that wraps across multiple lines to verify "
                        + "the layout stays left-aligned and the trailing affordance keeps its place.",
                    icon: "xmark.octagon.fill",
                    action: .button("Fix") {}
                )
            }
        }
    }
#endif
