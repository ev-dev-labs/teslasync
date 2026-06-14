import SwiftUI

/// A compact endpoint toggle row (web `EndpointToggle`, a small `GlassPanel`): a title + a
/// muted description on the leading edge and a HIG switch on the trailing edge.
struct FleetAPIEndpointRow: View {
    let title: LocalizedStringKey
    let desc: LocalizedStringKey
    let isOn: Bool
    let isBusy: Bool
    let toggle: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Text(desc)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle(isOn: Binding(get: { isOn }, set: { _ in toggle() })) {
                EmptyView()
            }
            .labelsHidden()
            .tint(Color.TS.accent)
            .controlSize(.small)
            .disabled(isBusy)
            .accessibilityLabel(Text(title))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .fleetAPIGlassRow()
    }
}

/// The leading icon + title/subtitle header shared by the three top-level Fleet API panels
/// (web `IconBox` + heading + caption).
struct FleetAPIPanelHeader<Subtitle: View>: View {
    let systemImage: String
    let tone: TSTone
    let title: LocalizedStringKey
    @ViewBuilder let subtitle: () -> Subtitle

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: systemImage, tone: tone)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                subtitle()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

extension View {
    /// The compact glass surface shared by the small Fleet API rows (web `GlassPanel p-2.5`).
    func fleetAPIGlassRow() -> some View {
        tsGlassPanel(cornerRadius: TSRadius.md)
    }

    /// A tinted, bordered callout surface used by the suspended + capture-stats notes
    /// (web `GlassPanel bg-neon-*/5 border-neon-*/20`).
    func fleetAPITinted(_ tone: TSTone) -> some View {
        modifier(FleetAPITintedSurface(tone: tone))
    }
}

/// Shared tinted-surface chrome for the inline Fleet API callouts.
private struct FleetAPITintedSurface: ViewModifier {
    let tone: TSTone

    func body(content: Content) -> some View {
        content
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone.color.opacity(0.08), in: shape)
            .overlay(shape.strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
    }
}
