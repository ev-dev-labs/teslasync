//
//  SmartChargePanel.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Panel shell
//
//  The shared frosted-panel chrome every Smart Charge section uses: a glass
//  surface (web `GlassPanel`, ADR-005) with an accent-icon + section-title header
//  and an optional trailing accessory. Centralizing it keeps the individual
//  sections free of repeated header markup (DRY) and guarantees every panel reads
//  from the design tokens (P2).
//

import SwiftUI

/// A titled glass panel (web `GlassPanel` + its `<h2>` header) with an optional
/// trailing accessory (e.g. the schedule's Apply control).
struct SmartChargePanel<Content: View, Trailing: View>: View {
    let icon: String
    let titleKey: String
    let titleFallback: String
    @ViewBuilder let trailing: () -> Trailing
    @ViewBuilder let content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content()
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: icon)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: SmartChargeStrings.text(titleKey, titleFallback))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            trailing()
        }
    }
}

extension SmartChargePanel where Trailing == EmptyView {
    /// A titled panel with no trailing accessory.
    init(
        icon: String,
        titleKey: String,
        titleFallback: String,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.init(
            icon: icon,
            titleKey: titleKey,
            titleFallback: titleFallback,
            trailing: { EmptyView() },
            content: content
        )
    }
}
