import SwiftUI

/// Circular initials avatar (web `Avatar`).
public struct TSAvatar: View {
    private let name: String
    private let size: CGFloat

    public init(name: String, size: CGFloat = 36) {
        self.name = name
        self.size = size
    }

    public var body: some View {
        Circle()
            .fill(Color.TS.accent.opacity(0.18))
            .frame(width: size, height: size)
            .overlay(
                Text(verbatim: Self.initials(from: name))
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
            )
            .accessibilityLabel(Text(verbatim: name))
    }

    /// First letters of up to two name words, uppercased. Pure + tested.
    static func initials(from name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        let joined = String(letters).uppercased()
        return joined.isEmpty ? "?" : joined
    }
}

/// User row with avatar, name, and secondary line (web `UserCell`).
public struct TSUserCell: View {
    private let name: String
    private let secondary: String

    public init(name: String, secondary: String) {
        self.name = name
        self.secondary = secondary
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: name).font(Font.TS.bodySm).fontWeight(.medium).foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: secondary).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer()
        }
    }
}

/// Vehicle hero card with name/model and battery (web `VehicleHeroCard`).
public struct TSVehicleHeroCard: View {
    private let name: String
    private let model: LocalizedStringKey
    private let batteryPercent: Int
    private let systemImage: String

    public init(name: String, model: LocalizedStringKey, batteryPercent: Int, systemImage: String = "car.fill") {
        self.name = name
        self.model = model
        self.batteryPercent = batteryPercent
        self.systemImage = systemImage
    }

    public var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.lg) {
                Image(systemName: systemImage)
                    .font(.system(size: 44))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: name).font(Font.TS.section).foregroundStyle(Color.TS.textPrimary)
                    Text(model).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "battery.75").foregroundStyle(Color.TS.statusSuccess)
                        Text("vehicle.batteryPercent \(batteryPercent)")
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
                Spacer()
            }
        }
    }
}

/// Compact vehicle status chip (web `VehicleTwin`).
public struct TSVehicleTwin: View {
    private let name: String
    private let isOnline: Bool
    private let batteryPercent: Int

    public init(name: String, isOnline: Bool, batteryPercent: Int) {
        self.name = name
        self.isOnline = isOnline
        self.batteryPercent = batteryPercent
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSStatusDot(tone: isOnline ? .success : .neutral)
            Text(verbatim: name).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Spacer()
            Text("vehicle.batteryPercent \(batteryPercent)").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

/// A selectable paint swatch.
public struct TSPaintOption: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    public let color: Color

    public init(id: String, name: LocalizedStringKey, color: Color) {
        self.id = id
        self.name = name
        self.color = color
    }
}

/// Vehicle paint color picker (web `VehiclePaintPicker`).
public struct TSVehiclePaintPicker: View {
    @Binding private var selection: String
    private let options: [TSPaintOption]

    public init(selection: Binding<String>, options: [TSPaintOption]) {
        _selection = selection
        self.options = options
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(options) { option in
                Button {
                    selection = option.id
                } label: {
                    Circle()
                        .fill(option.color)
                        .frame(width: 28, height: 28)
                        .overlay(
                            Circle().strokeBorder(
                                selection == option.id ? Color.TS.accent : Color.TS.border,
                                lineWidth: selection == option.id ? 3 : 1
                            )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(option.name))
                .accessibilityAddTraits(selection == option.id ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

/// Origin → destination route display (web `RouteDisplay`).
public struct TSRouteDisplay: View {
    private let origin: LocalizedStringKey
    private let destination: LocalizedStringKey

    public init(origin: LocalizedStringKey, destination: LocalizedStringKey) {
        self.origin = origin
        self.destination = destination
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "location.circle.fill").foregroundStyle(Color.TS.accent)
            Text(origin).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Color.TS.textMuted)
            Image(systemName: "mappin.circle.fill").foregroundStyle(Color.TS.statusDanger)
            Text(destination).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
    }
}
