//
//  SignalDiffPage.swift
//  TeslaSync — P4 feature view · P7 · SignalDiffPage (Apple)
//
//  SwiftUI parity of web/src/features/telemetry/pages/SignalDiffPage.tsx —
//  compares signal values between two snapshots in time with vehicle selection,
//  datetime window controls, filtering, pinning, and bulk actions.
//

import SwiftUI

// MARK: - Main Page View

public struct SignalDiffPage: View {
    @State private var viewModel = SignalDiffPageModel()
    @State private var selectedVehicleID: Int64 = 0
    @State private var atA: Date = Date(timeIntervalSinceNow: -3600)
    @State private var atB: Date = Date()
    @State private var signalFilter: String = ""
    @State private var selectedSignals: Set<String> = []
    
    public init() {}
    
    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection
                
                vehicleAndTimeControls
                
                switch viewModel.state {
                case .loading:
                    loadingView
                case .empty:
                    emptyView
                case .success:
                    successView
                }
            }
            .padding()
        }
        .navigationTitle(String(
            localized: "translation.signalDiff.title",
            defaultValue: "Signal Diff"
        ))
        .searchable(
            text: $signalFilter,
            prompt: "Filter signals..."
        )
        .task {
            await viewModel.load(
                vehicleID: selectedVehicleID,
                atA: atA,
                atB: atB,
                signalFilter: signalFilter
            )
        }
        .onChange(of: selectedVehicleID) { _, newValue in
            Task { await viewModel.load(
                vehicleID: newValue,
                atA: atA,
                atB: atB,
                signalFilter: signalFilter
            ) }
        }
        .onChange(of: atA) { _, newValue in
            Task { await viewModel.load(
                vehicleID: selectedVehicleID,
                atA: newValue,
                atB: atB,
                signalFilter: signalFilter
            ) }
        }
        .onChange(of: atB) { _, newValue in
            Task { await viewModel.load(
                vehicleID: selectedVehicleID,
                atA: atA,
                atB: newValue,
                signalFilter: signalFilter
            ) }
        }
        .onChange(of: signalFilter) { _, newValue in
            viewModel.applyFilter(newValue)
        }
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(
                localized: "translation.signalDiff.title",
                defaultValue: "Signal Diff"
            ))
            .font(.largeTitle)
            .fontWeight(.bold)
            
            Text(String(
                localized: "translation.signalDiff.subtitle",
                defaultValue: "Compare signal values between two snapshots in time"
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
    
    // MARK: - Vehicle and Time Controls
    
    private var vehicleAndTimeControls: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                // Vehicle picker
                VStack(alignment: .leading, spacing: 8) {
                    Text(String(
                        localized: "translation.signalDiff.vehicle",
                        defaultValue: "Vehicle"
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    
                    Picker(
                        String(
                            localized: "translation.signalDiff.vehicle",
                            defaultValue: "Vehicle"
                        ),
                        selection: $selectedVehicleID
                    ) {
                        ForEach(viewModel.vehicles, id: \.id) { vehicle in
                            Text(vehicle.displayName).tag(vehicle.id)
                        }
                    }
                    .pickerStyle(.menu)
                }
                
                Divider()
                
                // Time window controls
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Window A")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker(
                            "Window A",
                            selection: $atA,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .labelsHidden()
                    }
                    
                    Image(systemName: "arrow.right")
                        .foregroundStyle(.secondary)
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Window B")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker(
                            "Window B",
                            selection: $atB,
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .labelsHidden()
                    }
                }
            }
            .padding(8)
        }
        .accessibilityElement(children: .contain)
    }
    
    // MARK: - Loading State
    
    private var loadingView: some View {
        VStack(spacing: 16) {
            ForEach(0..<5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .frame(height: 80)
                    .redacted(reason: .privacy)
            }
        }
        .accessibilityLabel("Loading signal diff data")
    }
    
    // MARK: - Empty State
    
    private var emptyView: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "translation.signalDiff.noChanges",
                    defaultValue: "No signals changed between the two snapshots"
                ),
                systemImage: "arrow.left.arrow.right"
            )
        } description: {
            Text("Select a different time window or vehicle to compare signals")
        }
        .accessibilityLabel("No signal changes found")
    }
    
    // MARK: - Success State
    
    private var successView: some View {
        VStack(alignment: .leading, spacing: 24) {
            statisticsPanels
            diffTable
            pinnedSignalsSection
        }
    }
    
    // MARK: - Panel 1-4: Statistics Panels (Changed-signals, Visible-after-filter, Pinned, Window-span)
    
    private var statisticsPanels: some View {
        #if os(iOS)
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                statCard(
                    label: String(
                        localized: "translation.signalDiff.totalChanged",
                        defaultValue: "Changed signals"
                    ),
                    value: "\(viewModel.totalChangedCount)"
                )
                statCard(
                    label: String(
                        localized: "translation.signalDiff.visible",
                        defaultValue: "Visible after filter"
                    ),
                    value: "\(viewModel.visibleCount)"
                )
            }
            HStack(spacing: 12) {
                statCard(
                    label: String(
                        localized: "translation.signalDiff.pinnedCount",
                        defaultValue: "Pinned"
                    ),
                    value: "\(viewModel.pinnedCount)"
                )
                statCard(
                    label: String(
                        localized: "translation.signalDiff.windowSpan",
                        defaultValue: "Window span"
                    ),
                    value: viewModel.windowSpanText
                )
            }
        }
        #else
        HStack(spacing: 12) {
            statCard(
                label: String(
                    localized: "translation.signalDiff.totalChanged",
                    defaultValue: "Changed signals"
                ),
                value: "\(viewModel.totalChangedCount)"
            )
            statCard(
                label: String(
                    localized: "translation.signalDiff.visible",
                    defaultValue: "Visible after filter"
                ),
                value: "\(viewModel.visibleCount)"
            )
            statCard(
                label: String(
                    localized: "translation.signalDiff.pinnedCount",
                    defaultValue: "Pinned"
                ),
                value: "\(viewModel.pinnedCount)"
            )
            statCard(
                label: String(
                    localized: "translation.signalDiff.windowSpan",
                    defaultValue: "Window span"
                ),
                value: viewModel.windowSpanText
            )
        }
        #endif
    }
    
    private func statCard(label: String, value: String) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.title2)
                    .fontWeight(.bold)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
    
    // MARK: - Panel 5: Diff Table (GlassPanel5)
    
    private var diffTable: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                // Bulk actions toolbar
                if !selectedSignals.isEmpty {
                    bulkActionsToolbar
                }
                
                // Table content
                if viewModel.filteredRows.isEmpty && !signalFilter.isEmpty {
                    ContentUnavailableView {
                        Label("No matches", systemImage: "magnifyingglass")
                    } description: {
                        Text("No signals match your filter")
                    }
                } else if viewModel.filteredRows.isEmpty {
                    ContentUnavailableView {
                        Label(
                            String(
                                localized: "translation.signalDiff.noChanges",
                                defaultValue: "No signals changed between the two snapshots"
                            ),
                            systemImage: "arrow.left.arrow.right"
                        )
                    }
                } else {
                    diffTableContent
                }
            }
            .padding(8)
        }
    }
    
    private var bulkActionsToolbar: some View {
        HStack {
            Text("\(selectedSignals.count) selected")
                .font(.caption)
                .foregroundStyle(.secondary)
            
            Spacer()
            
            Button {
                Task { await viewModel.pinSelected(selectedSignals) }
            } label: {
                Label(
                    String(
                        localized: "translation.signalDiff.bulk.pin",
                        defaultValue: "Pin selected"
                    ),
                    systemImage: "pin"
                )
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            
            Button {
                Task { await viewModel.unpinSelected(selectedSignals) }
            } label: {
                Label(
                    String(
                        localized: "translation.signalDiff.bulk.unpin",
                        defaultValue: "Unpin selected"
                    ),
                    systemImage: "pin.slash"
                )
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            
            Button {
                viewModel.exportToCSV(selectedSignals)
            } label: {
                Label(
                    String(
                        localized: "translation.signalDiff.bulk.csv",
                        defaultValue: "Copy CSV"
                    ),
                    systemImage: "doc.text"
                )
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            
            Button {
                selectedSignals.removeAll()
            } label: {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(8)
        .background(.quaternary.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    
    private var diffTableContent: some View {
        Table(of: SignalDiffRow.self, selection: $selectedSignals) {
            TableColumn("Signal") { (row: SignalDiffRow) in
                HStack(spacing: 8) {
                    Button {
                        Task { await viewModel.togglePin(row.name) }
                    } label: {
                        Image(systemName: viewModel.isPinned(row.name) ? "pin.fill" : "pin")
                            .foregroundStyle(viewModel.isPinned(row.name) ? .cyan : .secondary)
                    }
                    .buttonStyle(.plain)
                    
                    Text(row.name)
                        .font(.system(.body, design: .monospaced))
                }
            }
            
            TableColumn("Value A") { (row: SignalDiffRow) in
                Text(formatValue(row.valueA))
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            
            TableColumn("Value B") { (row: SignalDiffRow) in
                Text(formatValue(row.valueB))
                    .font(.system(.body, design: .monospaced))
            }
            
            TableColumn("Δ") { (row: SignalDiffRow) in
                if let delta = row.delta {
                    HStack(spacing: 4) {
                        Image(systemName: delta > 0 ? "arrow.up" : delta < 0 ? "arrow.down" : "minus")
                            .foregroundStyle(delta > 0 ? .green : delta < 0 ? .red : .secondary)
                        Text(formatDelta(delta))
                            .font(.system(.caption, design: .monospaced))
                    }
                }
            }
            
            TableColumn("Source A") { (row: SignalDiffRow) in
                if let source = row.sourceA {
                    sourceLayerBadge(source)
                }
            }
            
            TableColumn("Source B") { (row: SignalDiffRow) in
                if let source = row.sourceB {
                    sourceLayerBadge(source)
                }
            }
        } rows: {
            ForEach(viewModel.filteredRows, id: \.name) { row in
                TableRow(row)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Signal diff table")
    }
    
    private func sourceLayerBadge(_ source: String) -> some View {
        Text(source)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(sourceColor(source).opacity(0.2))
            .foregroundStyle(sourceColor(source))
            .clipShape(Capsule())
    }
    
    private func sourceColor(_ source: String) -> Color {
        switch source.uppercased() {
        case "L1": return .green
        case "L2": return .cyan
        case "LOG": return .blue
        case "STALE": return .orange
        default: return .secondary
        }
    }
    
    // MARK: - Pinned Signals Section
    
    private var pinnedSignalsSection: some View {
        Group {
            if viewModel.pinnedCount > 0 {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(String(
                            localized: "translation.signalDiff.pinnedLabel",
                            defaultValue: "Pinned:"
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(viewModel.pinnedSignalNames, id: \.self) { signal in
                                    HStack(spacing: 4) {
                                        Image(systemName: "pin.fill")
                                            .font(.caption2)
                                        Text(signal)
                                            .font(.caption)
                                    }
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(.cyan.opacity(0.15))
                                    .foregroundStyle(.cyan)
                                    .clipShape(Capsule())
                                    .contextMenu {
                                        Button {
                                            Task { await viewModel.togglePin(signal) }
                                        } label: {
                                            Label("Unpin", systemImage: "pin.slash")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(8)
                }
            }
        }
    }
    
    // MARK: - Helper Functions
    
    private func formatValue(_ value: Any?) -> String {
        guard let value = value else { return "—" }
        
        if let num = value as? Double {
            return String(format: "%.3f", num)
        } else if let num = value as? Int {
            return "\(num)"
        } else if let bool = value as? Bool {
            return bool ? "true" : "false"
        } else if let str = value as? String {
            return str
        }
        
        return "\(value)"
    }
    
    private func formatDelta(_ delta: Double) -> String {
        if abs(delta) < 0.001 {
            return "0"
        }
        return String(format: "%+.3f", delta)
    }
}

// MARK: - View Model

@Observable
public final class SignalDiffPageModel {
    enum State {
        case loading
        case empty
        case success
    }
    
    var state: State = .loading
    
    // Data
    private(set) var vehicles: [SignalDiffVehicle] = []
    private(set) var allRows: [SignalDiffRow] = []
    private(set) var filteredRows: [SignalDiffRow] = []
    private(set) var pinnedSignals: Set<String> = []
    
    // Computed stats (Panels 1-4)
    var totalChangedCount: Int { allRows.count }
    var visibleCount: Int { filteredRows.count }
    var pinnedCount: Int { pinnedSignals.count }
    var windowSpanText: String = "—"
    
    // Pinned signal names (sorted)
    var pinnedSignalNames: [String] {
        Array(pinnedSignals).sorted()
    }
    
    func load(vehicleID: Int64, atA: Date, atB: Date, signalFilter: String) async {
        state = .loading
        
        // Simulate loading delay
        try? await Task.sleep(for: .milliseconds(300))
        
        // Load vehicles if empty
        if vehicles.isEmpty {
            vehicles = await loadVehicles()
        }
        
        // Load signal diff
        let diff = await loadSignalDiff(vehicleID: vehicleID, atA: atA, atB: atB)
        allRows = diff
        
        // Load pinned signals
        pinnedSignals = await loadPinnedSignals(vehicleID: vehicleID)
        
        // Calculate window span
        let span = atB.timeIntervalSince(atA)
        if span >= 3600 {
            windowSpanText = String(format: "%.1f h", span / 3600)
        } else if span >= 60 {
            windowSpanText = String(format: "%.0f min", span / 60)
        } else {
            windowSpanText = String(format: "%.0f s", span)
        }
        
        // Apply filter
        applyFilter(signalFilter)
        
        state = allRows.isEmpty ? .empty : .success
    }
    
    func applyFilter(_ filter: String) {
        if filter.isEmpty {
            filteredRows = allRows
        } else {
            let needle = filter.lowercased()
            filteredRows = allRows.filter { $0.name.lowercased().contains(needle) }
        }
    }
    
    func isPinned(_ signal: String) -> Bool {
        pinnedSignals.contains(signal)
    }
    
    func togglePin(_ signal: String) async {
        if pinnedSignals.contains(signal) {
            pinnedSignals.remove(signal)
            await unpinSignal(signal)
        } else {
            pinnedSignals.insert(signal)
            await pinSignal(signal)
        }
    }
    
    func pinSelected(_ signals: Set<String>) async {
        for signal in signals {
            if !pinnedSignals.contains(signal) {
                pinnedSignals.insert(signal)
                await pinSignal(signal)
            }
        }
    }
    
    func unpinSelected(_ signals: Set<String>) async {
        for signal in signals {
            if pinnedSignals.contains(signal) {
                pinnedSignals.remove(signal)
                await unpinSignal(signal)
            }
        }
    }
    
    func exportToCSV(_ signals: Set<String>) {
        let rows = filteredRows.filter { signals.contains($0.name) }
        var csv = "signal,value_a,value_b,source_a,source_b\n"
        for row in rows {
            csv += "\(row.name),\(formatCSVValue(row.valueA)),\(formatCSVValue(row.valueB)),\(row.sourceA ?? ""),\(row.sourceB ?? "")\n"
        }
        
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(csv, forType: .string)
        #else
        UIPasteboard.general.string = csv
        #endif
    }
    
    private func formatCSVValue(_ value: Any?) -> String {
        guard let value = value else { return "" }
        if let num = value as? Double {
            return String(format: "%.6f", num)
        } else if let num = value as? Int {
            return "\(num)"
        } else if let bool = value as? Bool {
            return bool ? "true" : "false"
        } else if let str = value as? String {
            return "\"\(str.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return "\(value)"
    }
    
    // MARK: - Data Source Methods (KMP core binding points)
    
    private func loadVehicles() async -> [SignalDiffVehicle] {
        // KMP binding: useVehicles → GET /vehicles
        // Mock data until AppContainer.vehiclesRepository is wired
        return [
            SignalDiffVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA1KF123456"),
            SignalDiffVehicle(id: 2, displayName: "Model Y", vin: "5YJSA1E2XKF234567")
        ]
    }
    
    private func loadSignalDiff(vehicleID: Int64, atA: Date, atB: Date) async -> [SignalDiffRow] {
        // KMP binding: useSignalDiffServer → GET /signals/{vehicleId}/diff
        // Mock data until AppContainer.signalsRepository.diff is wired
        guard vehicleID > 0 else { return [] }
        
        return [
            SignalDiffRow(
                name: "BatteryLevel",
                valueA: 82.5,
                valueB: 78.3,
                sourceA: "L1",
                sourceB: "L1",
                changed: true,
                delta: -4.2
            ),
            SignalDiffRow(
                name: "ChargeState",
                valueA: "Charging",
                valueB: "Complete",
                sourceA: "L2",
                sourceB: "L1",
                changed: true,
                delta: nil
            ),
            SignalDiffRow(
                name: "VehicleSpeed",
                valueA: 0.0,
                valueB: 65.5,
                sourceA: "LOG",
                sourceB: "L1",
                changed: true,
                delta: 65.5
            ),
            SignalDiffRow(
                name: "Odometer",
                valueA: 12345.2,
                valueB: 12367.8,
                sourceA: "L1",
                sourceB: "L1",
                changed: true,
                delta: 22.6
            ),
            SignalDiffRow(
                name: "TirePressureFL",
                valueA: 42.5,
                valueB: 42.3,
                sourceA: "L2",
                sourceB: "L2",
                changed: true,
                delta: -0.2
            )
        ]
    }
    
    private func loadPinnedSignals(vehicleID: Int64) async -> Set<String> {
        // KMP binding: usePinned → GET /pinned?type=widget&context=signal-diff:vehicle:{id}
        // Mock data until AppContainer.pinnedRepository.list is wired
        return Set(["BatteryLevel", "Odometer"])
    }
    
    private func pinSignal(_ signal: String) async {
        // KMP binding: useTogglePin → POST /pinned (item_type=widget, item_id=signal:{name})
    }
    
    private func unpinSignal(_ signal: String) async {
        // KMP binding: useTogglePin → DELETE /pinned/{id} (looked up from cache)
    }
}

// MARK: - Data Models

struct SignalDiffVehicle: Identifiable {
    let id: Int64
    let displayName: String
    let vin: String
}

struct SignalDiffRow: Identifiable {
    var id: String { name }
    let name: String
    let valueA: Any?
    let valueB: Any?
    let sourceA: String?
    let sourceB: String?
    let changed: Bool
    let delta: Double?
}

// MARK: - Preview

#if DEBUG
#Preview("SignalDiff - Success") {
    NavigationStack {
        SignalDiffPage()
    }
}

#Preview("SignalDiff - Empty") {
    NavigationStack {
        let page = SignalDiffPage()
        page
    }
}
#endif
