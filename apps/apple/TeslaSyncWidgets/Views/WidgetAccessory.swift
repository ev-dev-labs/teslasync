#if os(iOS)
    import SwiftUI
    import WidgetKit

    // Reusable Lock Screen / StandBy accessory renderers (iOS only). These stay
    // deliberately monochrome-friendly so they read correctly in the system's
    // vibrant accessory rendering mode. They take prebuilt `Text` so callers can
    // mix localized words and live values freely.

    /// A circular accessory gauge (battery, charge, alert load).
    struct WidgetAccessoryGauge: View {
        let fraction: Double
        let label: String
        var systemImage: String?

        var body: some View {
            Gauge(value: max(0, min(1, fraction))) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
            } currentValueLabel: {
                Text(verbatim: label)
                    .minimumScaleFactor(0.5)
            }
            .gaugeStyle(.accessoryCircular)
            .widgetAccentable()
        }
    }

    /// A single-line inline accessory (above the clock).
    struct WidgetAccessoryInline: View {
        let systemImage: String
        let text: Text

        var body: some View {
            Label {
                text
            } icon: {
                Image(systemName: systemImage)
            }
        }
    }

    /// A rectangular accessory: a titled two-line readout.
    struct WidgetAccessoryRectangular: View {
        let titleKey: LocalizedStringKey
        let systemImage: String
        let primary: Text
        var secondary: Text?

        var body: some View {
            VStack(alignment: .leading, spacing: 1) {
                Label {
                    Text(titleKey)
                } icon: {
                    Image(systemName: systemImage)
                }
                .font(.headline)
                .widgetAccentable()
                primary
                    .font(.body)
                if let secondary {
                    secondary
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The honest offline state for any accessory family.
    struct WidgetAccessoryUnavailable: View {
        let family: WidgetFamily

        var body: some View {
            switch family {
            case .accessoryCircular:
                Image(systemName: WidgetFreshness.offline.symbolName)
                    .widgetAccentable()
            case .accessoryInline:
                WidgetAccessoryInline(
                    systemImage: WidgetFreshness.offline.symbolName,
                    text: Text("widget.freshness.offline")
                )
            default:
                WidgetAccessoryRectangular(
                    titleKey: "widget.unavailable.title",
                    systemImage: WidgetFreshness.offline.symbolName,
                    primary: Text("widget.unavailable.message")
                )
            }
        }
    }
#endif
