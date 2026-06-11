using System.Globalization;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The two input modes of the TOU-settings modal — the native mirror of the web component's
/// <c>activeTab</c> (<c>'preset' | 'custom'</c>, web/src/features/battery/components/TOUSettingsModal.tsx).
/// <see cref="Preset"/> picks a bundled utility tariff; <see cref="Custom"/> pastes a raw
/// <c>tou_settings</c> JSON payload.
/// </summary>
public enum TouInputMode
{
    /// <summary>Choose one of the bundled preset tariffs (the web "Preset Tariff" tab; the default).</summary>
    Preset,

    /// <summary>Paste a raw <c>tou_settings</c> JSON payload (the web "Custom JSON" tab).</summary>
    Custom,
}

/// <summary>
/// The validation outcomes the modal can surface before it submits — the native mirror of the four
/// <c>setError(...)</c> branches in the web <c>getPayload()</c>. <see cref="None"/> means the chosen input
/// produced a valid payload.
/// </summary>
public enum TouValidationError
{
    /// <summary>The input is valid and a payload was produced.</summary>
    None,

    /// <summary>Preset mode with no rate plan chosen (web <c>energy.tou.errorNoPreset</c>).</summary>
    NoPresetSelected,

    /// <summary>Custom mode with an empty JSON field (web <c>energy.tou.errorEmptyJSON</c>).</summary>
    EmptyJson,

    /// <summary>Custom JSON that parsed to a non-object (array / value / null) (web <c>energy.tou.errorNotObject</c>).</summary>
    NotAnObject,

    /// <summary>Custom JSON that failed to parse (web <c>energy.tou.errorInvalidJSON</c>).</summary>
    InvalidJson,
}

/// <summary>
/// One bundled preset tariff — the native mirror of the web <c>TOUPreset</c> entries in the modal's
/// <c>PRESETS</c> array (web/src/types/energy.ts <c>TOUPreset</c>). <see cref="SettingsJson"/> is the verbatim
/// <c>TOUSettingsPayload</c> envelope (<c>{ "tou_settings": { … } }</c>) the web object literal encodes; it is
/// parsed on demand for the read-only preview and for the submit body so the wire shape matches the web's
/// <c>JSON.stringify(preset.settings)</c> exactly.
/// </summary>
public sealed record TouRatePlan(string Id, string Name, string Utility, string SettingsJson)
{
    /// <summary>The dropdown label (web <c>`${p.name} — ${p.utility}`</c>).</summary>
    public string Label => string.Create(CultureInfo.InvariantCulture, $"{Name} \u2014 {Utility}");
}

/// <summary>One rate-plan dropdown option (value = preset id, label = "name — utility").</summary>
public sealed record TouRatePlanOption(string Value, string Label);

/// <summary>
/// The result of assembling the submit payload from the current input — the native mirror of the web
/// <c>getPayload(): TOUSettingsPayload | null</c>. On success it carries the <see cref="Payload"/> node to send;
/// on failure it carries the specific <see cref="Error"/> the view-model resolves to a localized message.
/// </summary>
public sealed record TouPayloadResult(JsonNode? Payload, TouValidationError Error)
{
    /// <summary>True when a payload was produced (web <c>getPayload()</c> returned non-null).</summary>
    public bool Success => Error == TouValidationError.None && Payload is not null;

    /// <summary>A successful assembly carrying the payload node to submit.</summary>
    public static TouPayloadResult Ok(JsonNode payload) => new(payload, TouValidationError.None);

    /// <summary>A failed assembly carrying the validation error to surface.</summary>
    public static TouPayloadResult Fail(TouValidationError error) => new(null, error);
}

/// <summary>
/// A localized transient message for the toast surface — the native analogue of the web
/// <c>useUpdateTOUSettings</c> / <c>useRefreshTeslaEnergySiteInfo</c> mutation toasts. <see cref="IsError"/>
/// selects the error vs. success presentation.
/// </summary>
public sealed record TouSettingsToast(string Message, bool IsError);

/// <summary>
/// The outcome of a single TOU mutation (the save, or the follow-up site-info refresh) — the native analogue of
/// the web mutations resolving. On success it carries no payload; on an HTTP fault it carries a classified
/// <see cref="Error"/> rather than throwing (web parity: the mutation resolves to a toast, never an unhandled
/// rejection).
/// </summary>
public sealed record TouSettingsOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful mutation.</summary>
    public static TouSettingsOutcome Ok() => new(true, null);

    /// <summary>A classified failure.</summary>
    public static TouSettingsOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// Canonical metadata, the bundled preset tariffs, Segoe Fluent glyph and i18n keys for the
/// <c>TOUSettingsModal</c> surface — the native mirror of
/// <c>web/src/features/battery/components/TOUSettingsModal.tsx</c>. Every literal the web component renders is
/// keyed here (with that literal as the English fallback) so the native view and view-model stay free of inline
/// strings and resolve through the i18n facade. Three keys are native-idiom additions over the web literal set,
/// each justified inline: the keyed custom-field prompt (the web textarea ships a literal template),
/// the empty-preview hint (the web simply hides the preview when no plan is chosen; the native surface shows a
/// friendly hint instead of a blank box) and the saving busy label (the accessible name of the busy
/// indicator that stands in for the web submit-button spinner). The preset toast keys mirror the web
/// <c>useUpdateTOUSettings</c> / <c>useRefreshTeslaEnergySiteInfo</c> hooks. UI-free so every key + bound is
/// asserted in tests.
/// </summary>
public static class TouSettingsModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TOUSettingsModal";

    /// <summary>Segoe Fluent "PowerButton" glyph standing in for the web modal's clock / rate-plan icon.</summary>
    public const string Glyph = "\uE7E8";

    private const string PgeEv2ASettings =
        """
        {
          "tou_settings": {
            "optimization_strategy": "economics",
            "tariff_content_v2": {
              "name": "PG&E EV2-A",
              "utility": "Pacific Gas & Electric",
              "daily_charges": [{ "amount": 0.32854, "name": "Charge" }],
              "demand_charges": { "ALL": { "ALL": 0 } },
              "energy_charges": {
                "Summer": {
                  "ON_PEAK": [{ "rate": 0.49, "start": 16, "end": 21 }],
                  "OFF_PEAK": [
                    { "rate": 0.35, "start": 0, "end": 16 },
                    { "rate": 0.35, "start": 21, "end": 24 }
                  ]
                },
                "Winter": {
                  "ON_PEAK": [{ "rate": 0.42, "start": 16, "end": 21 }],
                  "OFF_PEAK": [
                    { "rate": 0.36, "start": 0, "end": 16 },
                    { "rate": 0.36, "start": 21, "end": 24 }
                  ]
                }
              },
              "seasons": {
                "Summer": { "fromMonth": 6, "fromDay": 1, "toMonth": 9, "toDay": 30 },
                "Winter": { "fromMonth": 10, "fromDay": 1, "toMonth": 5, "toDay": 31 }
              }
            }
          }
        }
        """;

    private const string SceTouDSettings =
        """
        {
          "tou_settings": {
            "optimization_strategy": "economics",
            "tariff_content_v2": {
              "name": "SCE TOU-D",
              "utility": "Southern California Edison",
              "daily_charges": [{ "amount": 0.031, "name": "Charge" }],
              "demand_charges": { "ALL": { "ALL": 0 } },
              "energy_charges": {
                "Summer": {
                  "ON_PEAK": [{ "rate": 0.54, "start": 16, "end": 21 }],
                  "MID_PEAK": [
                    { "rate": 0.41, "start": 8, "end": 16 },
                    { "rate": 0.41, "start": 21, "end": 23 }
                  ],
                  "OFF_PEAK": [
                    { "rate": 0.28, "start": 0, "end": 8 },
                    { "rate": 0.28, "start": 23, "end": 24 }
                  ]
                },
                "Winter": {
                  "MID_PEAK": [{ "rate": 0.43, "start": 8, "end": 21 }],
                  "SUPER_OFF_PEAK": [
                    { "rate": 0.28, "start": 0, "end": 8 },
                    { "rate": 0.28, "start": 21, "end": 24 }
                  ]
                }
              },
              "seasons": {
                "Summer": { "fromMonth": 6, "fromDay": 1, "toMonth": 9, "toDay": 30 },
                "Winter": { "fromMonth": 10, "fromDay": 1, "toMonth": 5, "toDay": 31 }
              }
            }
          }
        }
        """;

    private const string SdgeTouDr1Settings =
        """
        {
          "tou_settings": {
            "optimization_strategy": "economics",
            "tariff_content_v2": {
              "name": "SDG&E TOU-DR1",
              "utility": "San Diego Gas & Electric",
              "daily_charges": [{ "amount": 0.546, "name": "Charge" }],
              "demand_charges": { "ALL": { "ALL": 0 } },
              "energy_charges": {
                "Summer": {
                  "ON_PEAK": [{ "rate": 0.71, "start": 16, "end": 21 }],
                  "OFF_PEAK": [
                    { "rate": 0.45, "start": 0, "end": 16 },
                    { "rate": 0.45, "start": 21, "end": 24 }
                  ]
                },
                "Winter": {
                  "ON_PEAK": [{ "rate": 0.57, "start": 16, "end": 21 }],
                  "OFF_PEAK": [
                    { "rate": 0.45, "start": 0, "end": 16 },
                    { "rate": 0.45, "start": 21, "end": 24 }
                  ]
                }
              },
              "seasons": {
                "Summer": { "fromMonth": 6, "fromDay": 1, "toMonth": 9, "toDay": 30 },
                "Winter": { "fromMonth": 10, "fromDay": 1, "toMonth": 5, "toDay": 31 }
              }
            }
          }
        }
        """;

    /// <summary>The bundled preset tariffs in web render order (PG&amp;E, SCE, SDG&amp;E).</summary>
    public static IReadOnlyList<TouRatePlan> RatePlans { get; } =
    [
        new("pge-ev2a", "PG&E EV2-A", "Pacific Gas & Electric", PgeEv2ASettings),
        new("sce-tou-d", "SCE TOU-D", "Southern California Edison", SceTouDSettings),
        new("sdge-tou-dr1", "SDG&E TOU-DR1", "San Diego Gas & Electric", SdgeTouDr1Settings),
    ];

    /// <summary>Modal title (web <c>energy.tou.title</c> "Update Rate Plan").</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.title", "Update Rate Plan");

    /// <summary>Intro description paragraph (web <c>energy.tou.description</c>).</summary>
    public static string Description(ILocalizer localizer) =>
        Require(localizer).GetString(
            "energy.tou.description",
            "Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.");

    /// <summary>Preset tab label (web <c>energy.tou.tabPreset</c> "Preset Tariff").</summary>
    public static string PresetTabLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.tabPreset", "Preset Tariff");

    /// <summary>Custom tab label (web <c>energy.tou.tabCustom</c> "Custom JSON").</summary>
    public static string CustomTabLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.tabCustom", "Custom JSON");

    /// <summary>Rate-plan dropdown label (web <c>energy.tou.selectPlan</c> "Rate Plan").</summary>
    public static string SelectPlanLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.selectPlan", "Rate Plan");

    /// <summary>Rate-plan dropdown prompt (the web select's empty-choice text).</summary>
    public static string SelectPrompt(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.selectPlaceholder", "Choose a rate plan\u2026"); // parity:allow web i18n key kept verbatim for catalog parity

    /// <summary>Preset preview panel label (web <c>energy.tou.previewLabel</c> "Preview").</summary>
    public static string PreviewLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.previewLabel", "Preview");

    /// <summary>
    /// Friendly empty-state shown in the preview panel before a plan is chosen. Native-idiom addition: the web
    /// modal hides the preview entirely when no plan is selected; the native surface shows a friendly hint rather
    /// than a blank box (the no-hidden-surface rule).
    /// </summary>
    public static string PreviewEmpty(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.previewEmpty", "Choose a rate plan to preview its tariff.");

    /// <summary>Custom JSON field label (web <c>energy.tou.customLabel</c> "TOU Settings JSON").</summary>
    public static string CustomLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.customLabel", "TOU Settings JSON");

    /// <summary>
    /// Custom JSON field prompt. The web textarea ships this literal JSON template inline; it is keyed here
    /// so the native field carries no inline literal (the no-inline-string rule).
    /// </summary>
    public static string CustomPrompt(ILocalizer localizer) =>
        Require(localizer).GetString(
            "energy.tou.customPrompt",
            "{\n  \"tou_settings\": {\n    \"optimization_strategy\": \"economics\",\n    \"tariff_content_v2\": { ... }\n  }\n}");

    /// <summary>Custom JSON field hint (web <c>energy.tou.customHint</c>).</summary>
    public static string CustomHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "energy.tou.customHint",
            "Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.");

    /// <summary>Submit button label (web <c>energy.tou.submit</c> "Update Rate Plan").</summary>
    public static string SubmitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.submit", "Update Rate Plan");

    /// <summary>
    /// Busy-indicator accessible label. Native-idiom addition: the accessible name of the progress indicator
    /// that stands in for the web submit button's <c>loading</c> spinner while the save mutation is in flight.
    /// </summary>
    public static string SavingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("energy.tou.saving", "Saving rate plan\u2026");

    /// <summary>Cancel button label (web <c>common.cancel</c> "Cancel").</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>Save-success toast (web <c>useUpdateTOUSettings</c> <c>toast.energy.tou.success</c>).</summary>
    public static string SaveSuccessToast(ILocalizer localizer) =>
        Require(localizer).GetString("toast.energy.tou.success", "TOU settings saved");

    /// <summary>Save-failure toast (web <c>useUpdateTOUSettings</c> <c>toast.energy.tou.error</c>).</summary>
    public static string SaveErrorToast(ILocalizer localizer) =>
        Require(localizer).GetString("toast.energy.tou.error", "Failed to save TOU settings");

    /// <summary>Site-info refresh-success toast (web <c>useRefreshTeslaEnergySiteInfo</c> <c>toast.energy.siteInfo.success</c>).</summary>
    public static string RefreshSuccessToast(ILocalizer localizer) =>
        Require(localizer).GetString("toast.energy.siteInfo.success", "Site info refreshed");

    /// <summary>Site-info refresh-failure toast (web <c>useRefreshTeslaEnergySiteInfo</c> <c>toast.energy.siteInfo.error</c>).</summary>
    public static string RefreshErrorToast(ILocalizer localizer) =>
        Require(localizer).GetString("toast.energy.siteInfo.error", "Failed to refresh site info");

    /// <summary>The localized inline message for a validation <paramref name="error"/> (the web <c>setError(...)</c> text).</summary>
    public static string ValidationMessage(ILocalizer localizer, TouValidationError error) => error switch
    {
        TouValidationError.NoPresetSelected =>
            Require(localizer).GetString("energy.tou.errorNoPreset", "Please select a rate plan"),
        TouValidationError.EmptyJson =>
            Require(localizer).GetString("energy.tou.errorEmptyJSON", "Please enter the TOU settings JSON"),
        TouValidationError.NotAnObject =>
            Require(localizer).GetString("energy.tou.errorNotObject", "JSON must be an object"),
        TouValidationError.InvalidJson =>
            Require(localizer).GetString("energy.tou.errorInvalidJSON", "Invalid JSON \u2014 please check syntax"),
        _ => string.Empty,
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>TOUSettingsModal</c> surface — the native analogue of the web component's preset
/// option list, the read-only preset preview (web <c>JSON.stringify(settings, null, 2)</c>) and the
/// <c>getPayload()</c> payload assembly + validation. UI-free and i18n-free (validation returns a
/// <see cref="TouValidationError"/> the view-model localizes) so it is unit-tested headlessly and the view-model
/// never resolves a literal.
/// </summary>
public static class TouSettingsModalProjection
{
    private static readonly JsonSerializerOptions PreviewOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>The rate-plan dropdown options in web render order (web <c>presetOptions</c>).</summary>
    public static IReadOnlyList<TouRatePlanOption> RatePlanOptions =>
        TouSettingsModalRegistration.RatePlans
            .Select(p => new TouRatePlanOption(p.Id, p.Label))
            .ToArray();

    /// <summary>Whether <paramref name="planId"/> names a bundled preset.</summary>
    public static bool IsKnownPlan(string? planId) =>
        TouSettingsModalRegistration.RatePlans.Any(p => p.Id == planId);

    /// <summary>
    /// The pretty-printed preview of the preset <paramref name="planId"/> (web
    /// <c>JSON.stringify(preset.settings, null, 2)</c>), or an empty string when no/unknown plan is selected.
    /// </summary>
    public static string PreviewFor(string? planId)
    {
        var plan = Find(planId);
        if (plan is null)
        {
            return string.Empty;
        }

        var node = JsonNode.Parse(plan.SettingsJson);
        return node?.ToJsonString(PreviewOptions) ?? string.Empty;
    }

    /// <summary>
    /// Assemble the submit payload from the current input — the exact web <c>getPayload()</c> logic. In preset
    /// mode the chosen plan's settings envelope is returned (or <see cref="TouValidationError.NoPresetSelected"/>);
    /// in custom mode the trimmed JSON is parsed (empty → <see cref="TouValidationError.EmptyJson"/>,
    /// non-object → <see cref="TouValidationError.NotAnObject"/>, unparseable →
    /// <see cref="TouValidationError.InvalidJson"/>), and a parsed object that already carries a
    /// <c>tou_settings</c> key is sent as-is while a bare object is wrapped as <c>{ "tou_settings": obj }</c>.
    /// </summary>
    public static TouPayloadResult BuildPayload(TouInputMode mode, string? selectedPlanId, string? customJson)
    {
        if (mode == TouInputMode.Preset)
        {
            var plan = Find(selectedPlanId);
            if (plan is null)
            {
                return TouPayloadResult.Fail(TouValidationError.NoPresetSelected);
            }

            // Never null for the bundled, hand-authored preset envelopes.
            return TouPayloadResult.Ok(JsonNode.Parse(plan.SettingsJson)!);
        }

        string trimmed = (customJson ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return TouPayloadResult.Fail(TouValidationError.EmptyJson);
        }

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(trimmed);
        }
        catch (JsonException)
        {
            return TouPayloadResult.Fail(TouValidationError.InvalidJson);
        }

        // The web rejects arrays, primitives and null — only a plain object is accepted.
        if (parsed is not JsonObject obj)
        {
            return TouPayloadResult.Fail(TouValidationError.NotAnObject);
        }

        if (obj.ContainsKey("tou_settings"))
        {
            return TouPayloadResult.Ok(obj);
        }

        // Bare inner object — wrap it in the envelope (web: { tou_settings: obj }).
        var wrapper = new JsonObject { ["tou_settings"] = obj };
        return TouPayloadResult.Ok(wrapper);
    }

    private static TouRatePlan? Find(string? planId) =>
        string.IsNullOrEmpty(planId)
            ? null
            : TouSettingsModalRegistration.RatePlans.FirstOrDefault(p => p.Id == planId);
}

/// <summary>
/// PII-safe diagnostics for the <c>TOUSettingsModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the chosen plan, the pasted JSON or the site id — so a
/// diagnostics line can never leak tariff content. Thread-safe.
/// </summary>
public sealed class TouSettingsModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _settingsSaved;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TouSettingsModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of rate plans successfully saved from this surface.</summary>
    public long SettingsSaved => Interlocked.Read(ref _settingsSaved);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TOUSettingsModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={TouSettingsModalRegistration.Slug}"));
    }

    /// <summary>Record that a rate plan was saved (the plan / JSON / site id are never logged).</summary>
    public void RecordSettingsSaved()
    {
        Interlocked.Increment(ref _settingsSaved);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"tou.saved slug={TouSettingsModalRegistration.Slug}"));
    }
}
