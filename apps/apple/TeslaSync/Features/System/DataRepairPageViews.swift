//
//  DataRepairPageViews.swift
//  TeslaSync — P4 feature view · P7 · DataRepairPage (Apple) — Supporting Views
//

import SwiftUI

// MARK: - Supporting Views

struct StatCard: View {
    let label: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: icon)
                        .foregroundStyle(color)
                        .font(.title2)
                    Spacer()
                }

                Text(value)
                    .font(.title)
                    .fontWeight(.bold)

                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}

struct TabButton: View {
    let title: String
    let icon: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                Text(title)
                if count != 0 { // swiftlint:disable:this empty_count
                    Text("\(count)")
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.orange.opacity(0.2))
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.orange.opacity(0.15) : Color.clear)
            .cornerRadius(8)
            .foregroundStyle(isSelected ? .orange : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(count) items")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

struct DataRepairPageViewsChargingSessionRow: View {
    let session: DataRepairPageModelChargingSession
    let isExpanded: Bool
    let onTap: () -> Void
    let viewModel: DataRepairPageModel

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onTap) {
                GroupBox {
                    HStack(spacing: 12) {
                        Text("#\(session.id)")
                            .font(.caption)
                            .monospaced()
                            .foregroundStyle(.tertiary)
                            .frame(width: 40, alignment: .leading)

                        Text(session.startTs)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 150, alignment: .leading)

                        Text("\(session.startBatteryPct)%")
                            .font(.caption)
                            .frame(width: 50, alignment: .leading)

                        Text(String(localized: "Vehicle") + " \(session.vehicleId)")
                            .font(.caption)
                            .foregroundStyle(.tertiary)

                        Spacer()

                        Label(String(localized: "Open"), systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.orange.opacity(0.2))
                            .cornerRadius(6)
                            .foregroundStyle(.orange)
                    }
                }
                .background(isExpanded ? Color.orange.opacity(0.06) : Color.clear)
            }
            .buttonStyle(.plain)

            if isExpanded {
                ChargingEditForm(session: session, viewModel: viewModel)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            """
            Charging session \(session.id), started \(session.startTs), \
            \(session.startBatteryPct) percent battery
            """
        )
    }
}

struct ChargingEditForm: View {
    let session: DataRepairPageModelChargingSession
    let viewModel: DataRepairPageModel

    @State private var endTs = ""
    @State private var energyAdded = ""
    @State private var endBattery = ""
    @State private var peakPower = ""
    @State private var duration = ""
    @State private var cost = ""

    var body: some View {
        GroupBox {
            VStack(spacing: 16) {
                #if os(iOS)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        formFields
                    }
                #else
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ],
                        spacing: 12
                    ) {
                        formFields
                    }
                #endif

                HStack(spacing: 12) {
                    Button(String(localized: "Save")) {
                        // Save action
                    }
                    .buttonStyle(.borderedProminent)

                    Button(String(localized: "Close Session")) {
                        // Close action
                    }
                    .buttonStyle(.bordered)

                    Button(String(localized: "Discard")) {
                        // Discard action
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)

                    Spacer()

                    Button(String(localized: "Cancel")) {
                        viewModel.expandedId = nil
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(.orange.opacity(0.03))
    }

    @ViewBuilder
    private var formFields: some View {
        LabeledContent(String(localized: "End Date (ISO)")) {
            TextField("2026-03-30T04:00:00Z", text: $endTs)
                .textFieldStyle(.roundedBorder)
        }

        LabeledContent(String(localized: "Energy Added (kWh)")) {
            TextField("0", text: $energyAdded)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
        }

        LabeledContent(String(localized: "End Battery %")) {
            TextField("0", text: $endBattery)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.numberPad)
            #endif
        }

        LabeledContent(String(localized: "Charger Power (kW)")) {
            TextField("0", text: $peakPower)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
        }

        LabeledContent(String(localized: "Duration (min)")) {
            TextField("0", text: $duration)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.numberPad)
            #endif
        }

        LabeledContent(String(localized: "Cost ($)")) {
            TextField("0", text: $cost)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
        }
    }
}

struct DriveRow: View {
    let drive: Drive
    let isExpanded: Bool
    let onTap: () -> Void
    let viewModel: DataRepairPageModel

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onTap) {
                GroupBox {
                    HStack(spacing: 12) {
                        Text("#\(drive.id)")
                            .font(.caption)
                            .monospaced()
                            .foregroundStyle(.tertiary)
                            .frame(width: 40, alignment: .leading)

                        Text(drive.startTs)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 150, alignment: .leading)

                        Text(drive.startBatteryPct != nil ? "\(drive.startBatteryPct!)%" : "—")
                            .font(.caption)
                            .frame(width: 50, alignment: .leading)

                        Text(String(localized: "Vehicle") + " \(drive.vehicleId)")
                            .font(.caption)
                            .foregroundStyle(.tertiary)

                        Spacer()

                        Label(String(localized: "Open"), systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.orange.opacity(0.2))
                            .cornerRadius(6)
                            .foregroundStyle(.orange)
                    }
                }
                .background(isExpanded ? Color.orange.opacity(0.06) : Color.clear)
            }
            .buttonStyle(.plain)

            if isExpanded {
                DriveEditForm(drive: drive, viewModel: viewModel)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Drive \(drive.id), started \(drive.startTs)")
    }
}

struct DriveEditForm: View {
    let drive: Drive
    let viewModel: DataRepairPageModel

    @State private var endTs = ""
    @State private var distance = ""
    @State private var duration = ""
    @State private var endBattery = ""
    @State private var maxSpeed = ""

    var body: some View {
        GroupBox {
            VStack(spacing: 16) {
                #if os(iOS)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        formFields
                    }
                #else
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ],
                        spacing: 12
                    ) {
                        formFields
                    }
                #endif

                HStack(spacing: 12) {
                    Button(String(localized: "Save")) {
                        // Save action
                    }
                    .buttonStyle(.borderedProminent)

                    Button(String(localized: "Close Drive")) {
                        // Close action
                    }
                    .buttonStyle(.bordered)

                    Button(String(localized: "Discard")) {
                        // Discard action
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)

                    Spacer()

                    Button(String(localized: "Cancel")) {
                        viewModel.expandedId = nil
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(.orange.opacity(0.03))
    }

    @ViewBuilder
    private var formFields: some View {
        LabeledContent(String(localized: "End Date (ISO)")) {
            TextField("2026-03-30T04:00:00Z", text: $endTs)
                .textFieldStyle(.roundedBorder)
        }

        LabeledContent(String(localized: "Distance (m)")) {
            TextField("0", text: $distance)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
        }

        LabeledContent(String(localized: "Duration (s)")) {
            TextField("0", text: $duration)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.numberPad)
            #endif
        }

        LabeledContent(String(localized: "End Battery %")) {
            TextField("0", text: $endBattery)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.numberPad)
            #endif
        }

        LabeledContent(String(localized: "Max Speed (m/s)")) {
            TextField("0", text: $maxSpeed)
                .textFieldStyle(.roundedBorder)
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
        }
    }
}
