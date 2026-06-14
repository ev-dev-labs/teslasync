//
//  Typography.Previews.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  Xcode previews for every real branch of the typographic role system: the four heading levels, the
//  thirteen composed roles, the granular size / weight / color / mono composition, and the friendly empty
//  leaf. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        .padding(TSSpacing.lg)
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let allRoles: [TypographyRole] = TypographyRole.allCases

    #Preview("Composed roles") {
        staged("the 13 typography.role kinds") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(allRoles, id: \.self) { role in
                    Typography(role.sampleText, role: role)
                }
            }
        }
    }

    #Preview("Heading levels") {
        staged("page · section · panel · sub (with VoiceOver rank)") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TypographyHeading("Fleet overview", level: .page)
                TypographyHeading("Battery health", level: .section)
                TypographyHeading("Charging sessions", level: .panel)
                TypographyHeading("Last 30 days", level: .sub)
            }
        }
    }

    #Preview("Convenience peers") {
        staged("PageTitle … Code factories") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Typography.pageTitle("Page title")
                Typography.sectionTitle("Section title")
                Typography.panelTitle("Panel title")
                Typography.subhead("Subhead")
                Typography.caption("Caption text")
                Typography.helperText("Helper text under a field")
                Typography.errorText("Something needs attention")
                Typography.label("Field label")
                Typography.metricValue("142.6")
                Typography.metricLabel("kWh delivered")
                Typography.code("vehicle_id")
            }
        }
    }

    #Preview("Granular composition") {
        staged("size × weight × color × mono") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Typography("3xl bold primary", size: .threeXl, weight: .bold, color: .primary)
                Typography("xl semibold secondary", size: .xl, weight: .semibold, color: .secondary)
                Typography("base muted", size: .base, color: .muted)
                Typography("sm disabled", size: .sm, color: .disabled)
                Typography("monospaced 0x1F", size: .sm, mono: true)
            }
        }
    }

    #Preview("Empty leaf") {
        staged("blank text · never a blank box") {
            Typography("", role: .body)
        }
    }

    #Preview("Dynamic Type — accessibility") {
        staged("roles scale with content size") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Typography.pageTitle("Scales up")
                Typography("Body copy scales with the user's preferred content size.", role: .body)
                Typography.caption("Caption scales too.")
            }
        }
        .environment(\.dynamicTypeSize, .accessibility3)
    }

    private extension TypographyRole {
        /// A readable specimen string for each role in the catalog preview. A dictionary (not a `switch`)
        /// keeps the 13-way map declarative and within the lint complexity budget.
        private static let samples: [TypographyRole: String] = [
            .pageTitle: "Page title",
            .sectionTitle: "Section title",
            .panelTitle: "Panel title",
            .subhead: "Subhead",
            .body: "Body copy — the default dense-UI text role.",
            .bodySm: "Small body copy for secondary detail.",
            .caption: "Caption — muted supporting text.",
            .label: "Field label",
            .metricValue: "142.6",
            .metricLabel: "kWh delivered",
            .code: "vehicle_id = 42",
            .helper: "Helper text under a control.",
            .error: "This value needs attention."
        ]

        var sampleText: String {
            Self.samples[self] ?? rawValue
        }
    }

#endif
