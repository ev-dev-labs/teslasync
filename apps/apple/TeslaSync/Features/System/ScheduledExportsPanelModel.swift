//
//  ScheduledExportsPanelModel.swift
//  TeslaSync — P4 feature view · P7 · ScheduledExportsPanel (Apple) — View Model
//

import Observation
import SwiftUI

// MARK: - Data Models

/// Wire type for scheduled export delivery configuration
struct ScheduledExportDelivery: Codable, Equatable {
    let kind: DeliveryKind
    let target: String?

    enum DeliveryKind: String, Codable {
        case download
        case email
        case webhook
    }
}

/// Wire type for a scheduled export row (snake_case matching Go JSON tags)
struct ScheduledExport: Identifiable, Codable {
    let id: Int
    let ownerSubject: String
    let name: String
    let exportType: ExportType
    let format: Format
    let vehicleId: Int?
    let columns: [String]?
    let scheduleCron: String
    let delivery: ScheduledExportDelivery
    let rangeWindow: String
    let enabled: Bool
    let lastRunAt: String?
    let lastStatus: Status?
    let lastError: String?
    let nextRunAt: String?
    let createdAt: String
    let updatedAt: String

    enum ExportType: String, Codable, CaseIterable {
        case drives
        case charging
        case trips
        case positions
        case signals
    }

    enum Format: String, Codable, CaseIterable {
        case csv
        case json
    }

    enum Status: String, Codable {
        case ok
        case failed
    }

    enum CodingKeys: String, CodingKey {
        case id
        case ownerSubject = "owner_subject"
        case name
        case exportType = "export_type"
        case format
        case vehicleId = "vehicle_id"
        case columns
        case scheduleCron = "schedule_cron"
        case delivery
        case rangeWindow = "range_window"
        case enabled
        case lastRunAt = "last_run_at"
        case lastStatus = "last_status"
        case lastError = "last_error"
        case nextRunAt = "next_run_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Create/update payload (no owner_subject — server takes from auth header)
struct ScheduledExportInput: Codable {
    var name: String
    var exportType: ScheduledExport.ExportType
    var format: ScheduledExport.Format
    var vehicleId: Int?
    var columns: [String]?
    var scheduleCron: String
    var delivery: ScheduledExportDelivery
    var rangeWindow: String?
    var enabled: Bool

    enum CodingKeys: String, CodingKey {
        case name
        case exportType = "export_type"
        case format
        case vehicleId = "vehicle_id"
        case columns
        case scheduleCron = "schedule_cron"
        case delivery
        case rangeWindow = "range_window"
        case enabled
    }
}

enum ScheduledExportsPanelState {
    case loading
    case empty
    case error(String)
    case success([ScheduledExport])
}

// MARK: - ViewModel

@Observable
@MainActor
final class ScheduledExportsPanelModel {
    var state: ScheduledExportsPanelState = .loading
    var showForm: Bool = false
    var editingId: Int?
    var form: ScheduledExportInput = emptyInput()
    var pendingDeleteExport: ScheduledExport?

    // Mutation loading states
    var isCreating: Bool = false
    var isUpdating: Bool = false
    var isDeleting: Bool = false
    var runningNowId: Int?

    var exports: [ScheduledExport] {
        switch state {
        case let .success(list):
            list
        default:
            []
        }
    }

    // MARK: - Load

    func load() async {
        state = .loading

        // Integration point: GET /scheduled-exports via KMP core
        // Currently returns empty state until KMP integration is wired
        try? await Task.sleep(for: .milliseconds(500))

        state = .success([])
    }

    func refresh() async {
        await load()
    }

    // MARK: - Form Actions

    func startCreate() {
        form = Self.emptyInput()
        editingId = nil
        showForm = true
    }

    func startEdit(_ export: ScheduledExport) {
        form = Self.inputFromRow(export)
        editingId = export.id
        showForm = true
    }

    func closeForm() {
        showForm = false
        editingId = nil
        form = Self.emptyInput()
    }

    // MARK: - Mutations

    func submit() async -> Result<Void, Error> {
        // Drop optional target for download deliveries
        var payload = form
        if payload.delivery.kind == .download {
            payload.delivery = ScheduledExportDelivery(kind: .download, target: nil)
        } else if let target = payload.delivery.target?.trimmingCharacters(in: .whitespaces), !target.isEmpty {
            payload.delivery = ScheduledExportDelivery(
                kind: payload.delivery.kind,
                target: target
            )
        }

        if let id = editingId {
            // Update
            isUpdating = true
            defer { isUpdating = false }

            // Integration point: PUT /scheduled-exports/{id} via KMP core
            try? await Task.sleep(for: .milliseconds(300))

            closeForm()
            await refresh()
            return .success(())
        } else {
            // Create
            isCreating = true
            defer { isCreating = false }

            // Integration point: POST /scheduled-exports via KMP core
            try? await Task.sleep(for: .milliseconds(300))

            closeForm()
            await refresh()
            return .success(())
        }
    }

    func toggleEnabled(_ export: ScheduledExport) async -> Result<Void, Error> {
        isUpdating = true
        defer { isUpdating = false }

        var input = Self.inputFromRow(export)
        input.enabled = !export.enabled

        // Integration point: PUT /scheduled-exports/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))

        await refresh()
        return .success(())
    }

    func deleteExport(_: Int) async -> Result<Void, Error> {
        isDeleting = true
        defer { isDeleting = false }

        // Integration point: DELETE /scheduled-exports/{id} via KMP core
        try? await Task.sleep(for: .milliseconds(200))

        await refresh()
        return .success(())
    }

    func runNow(_ id: Int) async -> Result<Void, Error> {
        runningNowId = id
        defer { runningNowId = nil }

        // Integration point: POST /scheduled-exports/{id}/run via KMP core
        try? await Task.sleep(for: .milliseconds(200))

        await refresh()
        return .success(())
    }

    // MARK: - Helpers

    static func emptyInput() -> ScheduledExportInput {
        ScheduledExportInput(
            name: "",
            exportType: .drives,
            format: .csv,
            vehicleId: nil,
            columns: nil,
            scheduleCron: "0 9 * * 0",
            delivery: ScheduledExportDelivery(kind: .download, target: nil),
            rangeWindow: "7d",
            enabled: true
        )
    }

    static func inputFromRow(_ row: ScheduledExport) -> ScheduledExportInput {
        ScheduledExportInput(
            name: row.name,
            exportType: row.exportType,
            format: row.format,
            vehicleId: row.vehicleId,
            columns: row.columns,
            scheduleCron: row.scheduleCron,
            delivery: row.delivery,
            rangeWindow: row.rangeWindow,
            enabled: row.enabled
        )
    }
}
