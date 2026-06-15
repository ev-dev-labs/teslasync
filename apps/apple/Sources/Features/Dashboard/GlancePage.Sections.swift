import SwiftUI

// The Quick Glance building blocks (web `GlancePage.tsx`): the big battery `RadialGauge`,
// the four metric cards (Range / Interior / Security / Location), the lock / climate / horn
// quick actions, the online status badge, and the data-freshness chip. The gauge is a
// native SwiftUI ring (the same primitive the P3 `TSRadialGauge` / `BatteryRadialGauge`
// use) — never a WKWebView. Range / temperature format through the shared `Units` facade
// at the render boundary; everything else renders verbatim.

// MARK: - Battery gauge (web `RadialGauge value={battery_level} max={100} unit="%"`)

/// The hero battery ring (web `RadialGauge`): a track + a trimmed arc filled to the battery
/// fraction and tinted by the `batteryColor` band, with the integer percent + "%" at the
/// centre and the localized "Battery" label beneath. Honors Reduce Motion for the fill.
struct GlanceBatteryGauge: View {
    let level: Double?
    var diameter: CGFloat = 180

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var tone: TSTone { GlanceBattery.tone(level) }
    private var fraction: Double { GlanceBattery.fraction(level) }
    private var percent: Int { GlanceBattery.percent(level) }
    private var strokeWidth: CGFloat { diameter * 0.06 }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.4), lineWidth: strokeWidth)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(tone.color, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: fraction
                    )
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(verbatim: "\(percent)")
                        .font(.system(size: diameter * 0.26, weight: .bold))
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "%")
                        .font(.system(size: diameter * 0.13))
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .monospacedDigit()
            }
            .frame(width: diameter, height: diameter)
            Text("glance.battery")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("glance.battery"))
        .accessibilityValue(Text(verbatim: "\(percent)%"))
    }
}

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One glance metric (web `MetricCard`): a tinted icon, the metric label, and the value.
/// The value is a `Text` so localized states (Locked/Unlocked, Home/Work/Saved) and
/// formatted runtime values (range, temperature) compose the same way. Used for Range /
/// Interior / Security / Location.
struct GlanceMetricCard: View {
    let label: LocalizedStringKey
    let value: Text
    let systemImage: String
    var tone: TSTone = .accent

    var body: some View {
        TSCard {
            HStack(spacing: TSSpacing.md) {
                TSIconBox(systemName: systemImage, tone: tone)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    value
                        .font(Font.TS.panel)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Quick action (web `QuickAction` ghost button — icon + label)

/// A glance quick action (web `QuickAction`): a vertical ghost button with an SF Symbol and
/// a localized label, swapping the glyph for a spinner while its command is in flight and
/// disabling when commands are unavailable (web `disabled={!canSendCommands}`).
struct GlanceQuickAction: View {
    let systemImage: String
    let label: LocalizedStringKey
    var isLoading = false
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: TSSpacing.xs) {
                ZStack {
                    Image(systemName: systemImage)
                        .font(.system(size: 18, weight: .semibold))
                        .opacity(isLoading ? 0 : 1)
                    if isLoading {
                        ProgressView().controlSize(.small)
                    }
                }
                .frame(height: 22)
                Text(label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(minWidth: 72, minHeight: 64)
            .padding(.vertical, TSSpacing.sm)
            .padding(.horizontal, TSSpacing.md)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .foregroundStyle(Color.TS.accent)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isDisabled || isLoading)
        .opacity(isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Status badge (web `Badge variant={isOnline} dot>{state ?? 'Unknown'}`)

/// The connectivity badge (web `Badge dot`): a state-coloured dot plus the raw connection
/// state rendered verbatim, or the localized "Unknown" when no state has been reported.
struct GlanceStatusBadge: View {
    let state: String?
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 8, height: 8)
            stateText
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var stateText: some View {
        if let state, !state.isEmpty {
            Text(verbatim: state)
        } else {
            Text("glance.unknown")
        }
    }
}

// MARK: - Freshness chip (web `FreshnessIndicator timestamp=…`)

/// The data-freshness chip (web `FreshnessIndicator`): a clock glyph plus the elapsed-time
/// label, switching to a warning tone + badge glyph once the value is stale (ADR-013).
struct GlanceFreshness: View {
    let timestamp: Date?
    let isStale: Bool

    private var relative: String? {
        GlanceFormat.relativeTime(since: timestamp)
    }

    var body: some View {
        Group {
            if let relative {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: isStale ? "clock.badge.exclamationmark" : "clock")
                        .font(.caption2)
                    Text(verbatim: relative)
                        .font(Font.TS.caption)
                }
                .foregroundStyle(isStale ? Color.TS.statusWarning : Color.TS.textMuted)
                .accessibilityElement(children: .combine)
                .accessibilityValue(Text(verbatim: relative))
            }
        }
    }
}

// MARK: - Loading skeleton (web `PageContainer loading` Skeleton)

/// Mirrors the glance layout while the vehicle list loads (web `loading` → `Skeleton`): the
/// hero ring + metric blocks under SwiftUI redaction (the manifest's `loading →
/// redacted(reason:)`).
struct GlanceSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.x2xl) {
            Circle()
                .fill(Color.TS.surfaceGlass)
                .frame(width: 180, height: 180)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 72)
                }
            }
            .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity)
        .glanceRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("glance.title"))
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web loading Skeleton (the
    /// manifest's `loading → redacted(reason:)` requirement).
    func glanceRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
