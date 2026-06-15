import SwiftUI

// MARK: - Fleet API tab (web devtools `FleetApiSection` — static reference content)

/// The Fleet API tab: the Fleet-API onboarding checklist (web `ONBOARDING_STEPS`) and a
/// Tesla endpoint reference (web `TESLA_ENDPOINTS`). Static, local reference content — the
/// live partner-registration / status calls belong to the separate FleetAPI parity unit.
struct DevToolsFleetAPITab: View {
    private let steps = DevToolsCatalog.onboardingSteps
    private let endpoints = DevToolsCatalog.teslaEndpoints

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            onboardingSection
            endpointSection
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Onboarding checklist

    private var onboardingSection: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("devtools.fleetApi.setupTitle")
                Text("devtools.fleetApi.setupSubtitle")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    stepRow(number: index + 1, step: step)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("devtools.fleetApi.setupTitle"))
    }

    private func stepRow(number: Int, step: DevToolsOnboardingStep) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Text(verbatim: "\(number)")
                .font(Font.TS.label)
                .foregroundStyle(Color.white)
                .frame(width: 24, height: 24)
                .background(Color.TS.accent, in: Circle())
                .accessibilityHidden(true)
            Image(systemName: step.systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(step.detail)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }

    // MARK: Endpoint reference

    private var endpointSection: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSPanelTitle("devtools.fleetApi.endpointsTitle")
                Text("devtools.fleetApi.endpointsSubtitle")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.bottom, TSSpacing.xs)
                ForEach(endpoints) { endpoint in
                    endpointRow(endpoint)
                    if endpoint.id != endpoints.last?.id {
                        Divider().overlay(Color.TS.border)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("devtools.fleetApi.endpointsTitle"))
    }

    private func endpointRow(_ endpoint: DevToolsTeslaEndpoint) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            DevToolsMethodBadge(method: endpoint.method)
                .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: endpoint.path)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                Text(verbatim: endpoint.detail)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(endpoint.method) \(endpoint.path)"))
    }
}
