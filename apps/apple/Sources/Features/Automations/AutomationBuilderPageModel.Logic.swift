import Foundation

// The async load / save / test-run logic + payload assembly for `AutomationBuilderPageModel`,
// split into an extension so the observable type body stays small. Ported 1:1 from the web
// `AutomationBuilderPage.tsx` effects (`useAutomation` / `useAutomationPreset` hydration) and the
// `handleSave` / `handleTestRun` callbacks. The mutated state is `internal(set)`, so this
// same-module extension assigns it directly.

public extension AutomationBuilderPageModel {
    /// Loads the secondary lookups (vehicles + channels, degrading to empty like the web
    /// TanStack `undefined` default), then resolves the page phase from the entry mode.
    func load() async {
        vehicles = await (try? dataSource.useVehicles()) ?? []
        channels = await (try? dataSource.useNotificationChannels()) ?? []
        channelRevision += 1

        switch mode {
        case let .edit(id):
            await loadAutomation(id: id)
        case let .preset(presetID):
            await loadPreset(presetID)
        case .create:
            phase = .ready
        }
    }

    /// Web `handleSave` — validate, assemble the typed payload, then create or update. Returns
    /// `true` on a successful write so the view can navigate back to the list.
    @discardableResult
    func save() async -> Bool {
        if let failure = AutomationBuilderValidation.validate(form) {
            saveError = failure.resolvedMessage
            return false
        }
        saveError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let payload = makePayload()
            let result = try await write(payload)
            dirty = false
            savedID = result.id
            conflicts = []
            return true
        } catch {
            saveError = error.localizedDescription
            return false
        }
    }

    /// Web `handleTestRun` — fire the test run for the saved/edited automation (fire-and-forget).
    func testRun() async {
        guard let id = testRunTargetID else { return }
        isTestRunning = true
        defer { isTestRunning = false }
        do {
            try await dataSource.useTestRunAutomation(id: id)
            testRunStarted = true
        } catch {
            testRunStarted = false
        }
    }
}

// MARK: - Private helpers

private extension AutomationBuilderPageModel {
    func loadAutomation(id: Int64) async {
        phase = .loading
        do {
            guard let automation = try await dataSource.useAutomation(id: id) else {
                phase = .notFound
                return
            }
            hydrate(from: automation)
            phase = .ready
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    func loadPreset(_ presetID: String) async {
        if let preset = try? await dataSource.useAutomationPreset(id: presetID) {
            hydrate(from: preset)
        }
        phase = .ready
    }

    func write(_ payload: AutomationFullInput) async throws -> AutomationSaveResult {
        if let id = mode.automationID {
            return try await dataSource.useUpdateAutomationFull(id: id, input: payload)
        }
        return try await dataSource.useCreateAutomationFull(payload)
    }

    /// Web `formToPayload` — trims name/description and re-expands the single trigger to an array.
    func makePayload() -> AutomationFullInput {
        AutomationFullInput(
            name: form.name.trimmingCharacters(in: .whitespaces),
            description: form.description.trimmingCharacters(in: .whitespaces),
            vehicleID: form.vehicleID,
            enabled: form.enabled,
            triggers: form.trigger.map { [$0] } ?? [],
            conditions: form.conditions,
            actions: form.actions
        )
    }

    func hydrate(from automation: AutomationFull) {
        form = AutomationBuilderForm(
            name: automation.name,
            description: automation.description ?? "",
            vehicleID: automation.vehicleID,
            enabled: automation.enabled,
            trigger: automation.triggers.first,
            conditions: automation.conditions,
            actions: automation.actions
        )
        existingName = automation.name
    }

    func hydrate(from preset: AutomationPreset) {
        form = AutomationBuilderForm(
            name: preset.name,
            description: preset.description,
            vehicleID: nil,
            enabled: true,
            trigger: preset.triggers.first,
            conditions: preset.conditions,
            actions: preset.actions
        )
    }
}

// MARK: - Validation message resolution (web localized `validate()` strings)

extension AutomationBuilderValidationError {
    /// Resolves the rule's `automations.builder.error*` key to its localized string for the banner.
    var resolvedMessage: String {
        switch self {
        case .name: String(localized: "automations.builder.errorName")
        case .trigger: String(localized: "automations.builder.errorTrigger")
        case .triggerPlace: String(localized: "automations.builder.errorTriggerPlace")
        case .conditionPlace: String(localized: "automations.builder.errorConditionPlace")
        case .actions: String(localized: "automations.builder.errorActions")
        case .actionDetails: String(localized: "automations.builder.errorActionDetails")
        }
    }
}
