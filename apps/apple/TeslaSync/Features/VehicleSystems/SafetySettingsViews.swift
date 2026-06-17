//
//  SafetySettingsViews.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Shared UI + panels
//
//  The shared HIG furniture (the `GlassPanel` peer, the section title, the `Badge`
//  peer, the `MetricCard` peer, the staleness chip, the inline error banner) plus
//  the live-signal card (web GlassPanel 1 / SignalCard), the ADAS feature card
//  (web GlassPanel 2 / SafetyCard), the safety-score section (web GlassPanel 3 +
//  the four Safety-Score / Total-Features / Enabled / Disabled MetricCards), the
//  Live Safety Signals panel (web GlassPanel 8) and the Driving Statistics panel
//  (web GlassPanel 9 + Distance-Since-Reset / Self-Driving-Distance MetricCards)
//  and the ADAS Features panel (web GlassPanel 12). Materials stand in for the web
//  glass (ADR-005); every color/typography value comes from the generated design
//  tokens (P2); every string from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel / Badge)

/// The frosted card that stands in for the web `GlassPanel`.
struct SafetyPanel<Content: View>: View {
    var padding: CGFloat = TSSpacing.xl
    var glowTone: SafetyTone?
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(glowTone?.color.opacity(0.4) ?? Color.TS.border, lineWidth: 1)
            )
    }
}

/// A panel section title (web `<h2 className="text-sm font-semibold">`).
struct SafetySectionTitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Small status pill (web `Badge` with `variant`).
struct SafetyBadge: View {
    let text: String
    let tone: SafetyTone

    var body: some View {
        Text(text)
            .font(Font.TS.label)
            .fontWeight(.semibold)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(tone.color)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().stroke(tone.color.opacity(0.3), lineWidth: 1))
    }
}

/// The metric tile (web `MetricCard`): optional leading icon, big tinted value,
/// caption label, optional subtitle.
struct SafetyMetricCard: View {
    let label: String
    let value: String
    var systemImage: String?
    var subtitle: String?
    var valueTone: SafetyTone = .neutral

    private var valueColor: Color {
        valueTone == .neutral ? Color.TS.textPrimary : valueTone.color
    }

    var body: some View {
        SafetyPanel(padding: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(Font.TS.panel)
                        .foregroundStyle(valueTone == .neutral ? Color.TS.textMuted : valueTone.color)
                        .accessibilityHidden(true)
                }
                Text(value)
                    .font(Font.TS.title)
                    .foregroundStyle(valueColor)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                if let subtitle {
                    Text(subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(label): \(value)"))
    }
}

/// Subtle chip surfaced when the last refresh is older than two minutes (ADR-013).
struct SafetyStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(safetyKey("common.staleData", "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// The inline error banner (web `anyError` AlertBanner) — shown when a request
/// fails while the latest snapshot still rendered.
struct SafetyInlineError: View {
    let message: String

    var body: some View {
        let prefix = safetyKey("error.loadFailed", "Failed to load data")
        return HStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text("\(prefix): \(message)")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .stroke(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 1 — live-signal card (web SignalCard)

/// One live safety-signal tile (web `SignalCard`): an icon, the value (tinted by
/// the tri-state `positive`) and an uppercase label.
struct SafetySignalCardView: View {
    let cell: SafetySignalCellModel

    var body: some View {
        SafetyPanel(padding: TSSpacing.lg) {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: cell.systemImage)
                    .font(Font.TS.section)
                    .foregroundStyle(cell.tone.color)
                    .accessibilityHidden(true)
                Text(cell.value)
                    .font(Font.TS.body)
                    .fontWeight(.bold)
                    .foregroundStyle(cell.tone.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(cell.label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(cell.label): \(cell.value)"))
    }
}

// MARK: - GlassPanel 2 — ADAS feature card (web SafetyCard)

/// One ADAS feature card (web `SafetyCard`): a status dot + label + description,
/// glowing green when enabled, with the value text beneath.
struct SafetyFeatureCardView: View {
    let card: SafetyFeatureCard

    private var tone: SafetyTone { card.enabled ? .success : .neutral }

    var body: some View {
        SafetyPanel(padding: TSSpacing.lg, glowTone: card.enabled ? .success : nil) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.md) {
                    RoundedRectangle(cornerRadius: TSRadius.sm)
                        .fill(card.enabled ? Color.TS.statusSuccess.opacity(0.18) : Color.TS.surface)
                        .frame(width: 34, height: 34)
                        .overlay(
                            Image(systemName: card.enabled ? "checkmark.shield.fill" : "shield.slash")
                                .font(Font.TS.body)
                                .foregroundStyle(card.enabled ? Color.TS.statusSuccess : Color.TS.textMuted)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(card.label)
                            .font(Font.TS.label)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Text(card.detail)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Circle()
                        .fill(card.enabled ? Color.TS.statusSuccess : Color.TS.border)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                }
                Text(card.valueText)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(card.enabled ? Color.TS.statusSuccess : Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(card.label), \(card.detail), \(card.valueText)"))
    }
}

// MARK: - GlassPanel 3 + Safety-Score/Total-Features/Enabled/Disabled MetricCards

/// The safety-score section: the radial-gauge panel (web GlassPanel 3) beside the
/// four summary MetricCards (Safety Score / Total Features / Enabled / Disabled).
struct SafetyScoreSection: View {
    @Bindable var model: SafetySettingsPageModel

    private let statColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                gaugePanel.frame(width: 220)
                statGrid
            }
            VStack(spacing: TSSpacing.lg) {
                gaugePanel
                statGrid
            }
        }
    }

    /// Web GlassPanel 3 — the RadialGauge + the enabled/total badge.
    private var gaugePanel: some View {
        SafetyPanel {
            VStack(spacing: TSSpacing.md) {
                SafetyRadialGauge(
                    value: Double(model.enabledCount),
                    maximum: Double(model.totalFeatures),
                    label: safetyText("Safety Score"),
                    unit: model.scorePercentText,
                    tone: model.scoreTone
                )
                SafetyBadge(
                    text: "\(model.enabledCount)/\(model.totalFeatures) \(safetyText("enabled"))",
                    tone: model.scoreTone
                )
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var statGrid: some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.lg) {
            SafetyMetricCard(
                label: safetyText("Safety Score"),
                value: model.scorePercentText,
                valueTone: model.scoreTone
            )
            SafetyMetricCard(
                label: safetyText("Total Features"),
                value: "\(model.totalFeatures)",
                valueTone: .info
            )
            SafetyMetricCard(
                label: safetyText("Enabled"),
                value: "\(model.enabledCount)",
                valueTone: .success
            )
            SafetyMetricCard(
                label: safetyText("Disabled"),
                value: "\(model.disabledCount)",
                valueTone: model.disabledCount > 0 ? .danger : .success
            )
        }
    }
}

// MARK: - GlassPanel 8 — Live Safety Signals

/// The live safety-signals panel (web GlassPanel 8): the four belt / seat / lock
/// `SignalCard`s in an adaptive grid.
struct SafetyLiveSignalsPanel: View {
    let cells: [SafetySignalCellModel]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        SafetyPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SafetySectionTitle(text: safetyKey("safety.liveSignals", "Live Safety Signals"))
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    ForEach(cells) { cell in
                        SafetySignalCardView(cell: cell)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - GlassPanel 9 + Distance-Since-Reset / Self-Driving-Distance MetricCards

/// The driving-statistics panel (web GlassPanel 9): the Distance-Since-Reset and
/// Self-Driving-Distance MetricCards, distances formatted at the display boundary.
struct SafetyDrivingStatsPanel: View {
    let distanceSinceReset: String
    let selfDrivingDistance: String
    let distanceUnit: SafetyDistanceUnit

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.lg)]

    var body: some View {
        SafetyPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SafetySectionTitle(text: safetyKey("safety.drivingStats", "Driving Statistics"))
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    SafetyMetricCard(
                        label: safetyKey("safety.distanceSinceReset", "Distance Since Reset"),
                        value: distanceSinceReset,
                        systemImage: "location.north.line.fill",
                        subtitle: distanceUnit.label
                    )
                    SafetyMetricCard(
                        label: safetyKey("safety.selfDrivingDistance", "Self-Driving Distance"),
                        value: selfDrivingDistance,
                        systemImage: "cpu.fill",
                        subtitle: SafetyFormat.autopilotSubtitle(unit: distanceUnit)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - GlassPanel 12 — ADAS Features

/// The ADAS feature-card panel (web GlassPanel 12): the section title over the
/// nine `SafetyCard`s in an adaptive three-column grid.
struct SafetyFeaturesPanel: View {
    let cards: [SafetyFeatureCard]

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]

    var body: some View {
        SafetyPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SafetySectionTitle(text: safetyText("ADAS Features"))
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ForEach(cards) { card in
                        SafetyFeatureCardView(card: card)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
