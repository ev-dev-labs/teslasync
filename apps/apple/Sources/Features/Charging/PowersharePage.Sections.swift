import SwiftUI

// The two Powershare panels (web `PowersharePage.tsx` GlassPanel1 + GlassPanel5), the
// three status metric cards, the dynamic status / stop-reason badges, and the loading
// skeleton. Power / hours format directly via `PowershareFormat` (the signals arrive in
// kW / hours); status / type / stop-reason render verbatim. Each panel renders its own
// empty state (never a blank region), exactly as the web page always shows both panels.

// MARK: - Status panel (web GlassPanel1 — header + metric grid / no-data empty)

/// The Powershare Status panel (web first `GlassPanel`): a header with the section title
/// and the live status badge, then either the three metric cards (Type, Output Power,
/// Hours Remaining) when any signal has reported, or the no-data empty state.
struct PowershareStatusSection: View {
    let snapshot: PowershareSnapshot

    private let columns = [GridItem(.adaptive(minimum: 170), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if snapshot.hasData {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        PowershareStatCard(
                            title: "powershare.type",
                            value: PowershareFormat.text(snapshot.shareType),
                            systemImage: "house.fill",
                            tone: .accent,
                            sublabel: "powershare.typeSub"
                        )
                        PowershareStatCard(
                            title: "powershare.outputPower",
                            value: PowershareFormat.power(snapshot.powerKw),
                            unit: snapshot.powerKw != nil ? PowershareFormat.powerUnit : nil,
                            systemImage: "powerplug.fill",
                            tone: .warning,
                            sublabel: "powershare.outputPowerSub"
                        )
                        PowershareStatCard(
                            title: "powershare.hoursLeft",
                            value: PowershareFormat.hours(snapshot.hoursLeft),
                            unit: snapshot.hoursLeft != nil ? PowershareFormat.hoursUnit : nil,
                            systemImage: "clock.fill",
                            tone: .info,
                            sublabel: "powershare.hoursLeftSub"
                        )
                    }
                } else {
                    TSEmptyState(title: "powershare.noData", systemImage: "info.circle")
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    /// Web header: a Zap glyph + "Powershare Status" title, with the status badge trailing
    /// (or a neutral no-data badge when the status signal is unreported).
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            TSPanelTitle("powershare.statusSection")
            Spacer(minLength: TSSpacing.sm)
            if let status = snapshot.status {
                PowershareValueBadge(text: status, tone: snapshot.statusTone)
            } else {
                TSBadge("common.noData", tone: .neutral)
            }
        }
    }
}

// MARK: - Stat card (web `StatCard` — label + value + unit + icon + sublabel)

/// One Powershare metric (web `StatCard`): a muted label with a tinted icon, the value
/// with an optional unit suffix, and a supporting sublabel. Composes the shared `TSCard`
/// + typography tokens; the value renders verbatim (the caller pre-formats it).
struct PowershareStatCard: View {
    let title: LocalizedStringKey
    let value: String
    var unit: String?
    let systemImage: String
    var tone: TSTone = .accent
    let sublabel: LocalizedStringKey

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: value)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let unit {
                        Text(verbatim: unit)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                Text(sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stop-reason panel (web GlassPanel5 — header + reason badge / empty)

/// The Stop Reason panel (web second `GlassPanel`): a header with the section title, then
/// either the recorded reason badge plus its help caption, or the no-stop-reason empty.
struct PowershareStopReasonSection: View {
    let snapshot: PowershareSnapshot

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityHidden(true)
                    TSPanelTitle("powershare.stopReasonSection")
                }
                if let reason = snapshot.stopReason {
                    HStack(alignment: .center, spacing: TSSpacing.md) {
                        PowershareValueBadge(text: reason, tone: snapshot.stopReasonTone)
                        Text("powershare.stopReasonHelp")
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    TSEmptyState(title: "powershare.noStopReason", systemImage: "info.circle")
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

// MARK: - Dynamic value badge (web `Badge` rendering a runtime status/reason string)

/// A capsule badge rendering a runtime telemetry string verbatim with a semantic tone
/// (web `<Badge variant=…>{status}</Badge>`). Mirrors `TSBadge` styling but takes a
/// data-derived `String` rather than a localizable key, since status / stop-reason values
/// come from the vehicle, not the string catalog.
struct PowershareValueBadge: View {
    let text: String
    var tone: TSTone = .neutral

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the two
/// panel blocks under SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct PowershareSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonBlock(height: 220)
            skeletonBlock(height: 140)
        }
        .powershareRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("powershare.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func powershareRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
