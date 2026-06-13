using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The typed-input kind a per-vehicle setting row renders through — the native mirror of the web
/// <c>VehicleSettingKind</c> union ('text' | 'timestamp' | 'select') in
/// web/src/features/vehicles/components/VehicleSettingsTab.tsx.
/// </summary>
public enum VehicleSettingKind
{
    /// <summary>A free-text single-line field (web <c>&lt;Input type="text"&gt;</c>).</summary>
    Text,

    /// <summary>An RFC3339 instant edited as a local date + time (web <c>&lt;Input type="datetime-local"&gt;</c>).</summary>
    Timestamp,

    /// <summary>A static option set (web <c>&lt;Select&gt;</c>).</summary>
    Select,
}

/// <summary>One static option for a <see cref="VehicleSettingKind.Select"/> row (web <c>SelectOption</c>).</summary>
public sealed record VehicleSettingOption(string Value, string Label);

/// <summary>
/// The whitelist + per-key UI metadata for one editable per-vehicle setting — the native port of the web
/// <c>VehicleSettingDescriptor</c>. The descriptor order drives row rendering order and mirrors
/// <c>vehicleSettingDefs</c> in <c>internal/database/vehicle_settings_repo.go</c>.
/// </summary>
public sealed record VehicleSettingDescriptor(
    string Key,
    VehicleSettingKind Kind,
    IReadOnlyList<VehicleSettingOption> Options,
    int? MaxLength,
    string? AutoComplete)
{
    /// <summary>
    /// The supported keys in the exact render order the web component declares. Do not reorder unless the i18n
    /// labels change (web parity comment).
    /// </summary>
    public static IReadOnlyList<VehicleSettingDescriptor> All { get; } = new[]
    {
        new VehicleSettingDescriptor("nickname", VehicleSettingKind.Text, Array.Empty<VehicleSettingOption>(), 64, "off"),
        new VehicleSettingDescriptor("mute_until", VehicleSettingKind.Timestamp, Array.Empty<VehicleSettingOption>(), null, null),
        new VehicleSettingDescriptor("charge_cost_tariff_id", VehicleSettingKind.Text, Array.Empty<VehicleSettingOption>(), 64, "off"),
        new VehicleSettingDescriptor(
            "units_distance",
            VehicleSettingKind.Select,
            new[] { new VehicleSettingOption("mi", "mi"), new VehicleSettingOption("km", "km") },
            null,
            null),
        new VehicleSettingDescriptor(
            "units_temperature",
            VehicleSettingKind.Select,
            new[] { new VehicleSettingOption("C", "\u00B0C"), new VehicleSettingOption("F", "\u00B0F") },
            null,
            null),
        new VehicleSettingDescriptor(
            "units_energy",
            VehicleSettingKind.Select,
            new[] { new VehicleSettingOption("kWh", "kWh") },
            null,
            null),
    };
}

/// <summary>
/// The resolver layer a per-vehicle effective value comes from — the native port of the web
/// <c>EffectiveSettingSource</c> ('override' | 'user' | 'vehicle' | 'default'). Drives the source pill colour and
/// whether the row can be reset.
/// </summary>
public enum VehicleSettingSource
{
    /// <summary>A per-vehicle override (the only source that can be reset). Web pill variant <c>success</c>.</summary>
    Override,

    /// <summary>An account-wide user default. Web pill variant <c>info</c>.</summary>
    User,

    /// <summary>A value derived from the vehicle itself. Web pill variant <c>neutral</c>.</summary>
    Vehicle,

    /// <summary>A built-in system default. Web pill variant <c>warning</c>.</summary>
    Default,
}

/// <summary>Maps the resolver source token to its enum, status colour and stable token (web parity).</summary>
public static class VehicleSettingSources
{
    /// <summary>Parse the wire source token (web <c>EffectiveSettingSource</c>); unknown tokens fall back to default.</summary>
    public static VehicleSettingSource Parse(string? token) => token?.Trim().ToLowerInvariant() switch
    {
        "override" => VehicleSettingSource.Override,
        "user" => VehicleSettingSource.User,
        "vehicle" => VehicleSettingSource.Vehicle,
        _ => VehicleSettingSource.Default,
    };

    /// <summary>The stable lower-case token for a source (round-trips <see cref="Parse"/>; web pill key suffix).</summary>
    public static string Token(VehicleSettingSource source) => source switch
    {
        VehicleSettingSource.Override => "override",
        VehicleSettingSource.User => "user",
        VehicleSettingSource.Vehicle => "vehicle",
        _ => "default",
    };

    /// <summary>
    /// The semantic chip colour for a source — the native mirror of the web <c>SOURCE_PILL_VARIANT</c> map
    /// (override→success, user→info, vehicle→neutral, default→warning).
    /// </summary>
    public static StatusKind Status(VehicleSettingSource source) => source switch
    {
        VehicleSettingSource.Override => StatusKind.Success,
        VehicleSettingSource.User => StatusKind.Info,
        VehicleSettingSource.Vehicle => StatusKind.Neutral,
        _ => StatusKind.Warning,
    };
}

/// <summary>
/// A typed value forwarded to the upsert mutation (web <c>VehicleSettingValue = string | number | boolean</c>).
/// Every key in the whitelist carries a string (free text, a select token, or an RFC3339 instant), so
/// <see cref="Text"/> is the only constructor the rows use; the wrapper stays open for a future numeric/boolean key.
/// </summary>
public sealed record VehicleSettingValue(object? Raw)
{
    /// <summary>A string-typed setting value (the only shape the current whitelist produces).</summary>
    public static VehicleSettingValue Text(string value) => new(value);
}

/// <summary>The outcome of validating a row draft (web <c>ParseResult</c>): a ready value, an empty field, or invalid.</summary>
public enum VehicleSettingParseStatus
{
    /// <summary>The draft parsed to a value ready for the upsert mutation.</summary>
    Ok,

    /// <summary>The draft trimmed to empty — the web "Value is required." branch.</summary>
    Empty,

    /// <summary>The draft is non-empty but invalid for the row's kind.</summary>
    Invalid,
}

/// <summary>
/// The result of parsing a row draft into a value (web <c>parseDraft</c>). When <see cref="Status"/> is
/// <see cref="VehicleSettingParseStatus.Invalid"/> the <see cref="MessageKey"/> / <see cref="Fallback"/> name the
/// i18n string to surface; <see cref="VehicleSettingParseStatus.Empty"/> defers to the shared "required" message.
/// </summary>
public sealed record VehicleSettingParseResult(
    VehicleSettingParseStatus Status,
    VehicleSettingValue? Value,
    string? MessageKey,
    string? Fallback)
{
    /// <summary>A parsed, ready-to-save value.</summary>
    public static VehicleSettingParseResult Ok(VehicleSettingValue value) =>
        new(VehicleSettingParseStatus.Ok, value, null, null);

    /// <summary>The empty-field result (web returns <c>{ kind: 'empty' }</c>).</summary>
    public static VehicleSettingParseResult Empty { get; } =
        new(VehicleSettingParseStatus.Empty, null, null, null);

    /// <summary>An invalid result carrying the i18n key + English fallback for the inline error.</summary>
    public static VehicleSettingParseResult Invalid(string messageKey, string fallback) =>
        new(VehicleSettingParseStatus.Invalid, null, messageKey, fallback);
}

/// <summary>
/// The draft conversion + validation helpers — the native port of the web <c>effectiveToDraft</c> / <c>parseDraft</c>
/// and the datetime-local ⇄ RFC3339 bridge (<c>rfc3339ToLocalInput</c> / <c>localInputToRFC3339</c>). WinUI-free so it
/// is unit-tested without a UI host.
/// </summary>
public static class VehicleSettingDraft
{
    /// <summary>The <c>datetime-local</c> shape an instant is edited as (local wall-clock, minute precision).</summary>
    public const string LocalInputFormat = "yyyy-MM-ddTHH:mm";

    /// <summary>
    /// The committed RFC3339 shape sent to the upsert mutation. Seconds + <c>Z</c> (UTC) — Go's
    /// <c>time.Parse(time.RFC3339, …)</c> accepts it.
    /// </summary>
    public const string Rfc3339Format = "yyyy-MM-ddTHH:mm:ssZ";

    /// <summary>
    /// Seed a row's editable draft from the resolved effective value (web <c>effectiveToDraft</c>). The reused
    /// resolver row stringifies its scalar and <c>ValueIsText</c> preserves whether the wire value was a JSON string
    /// (web <c>typeof value === 'string'</c>); every whitelist key carries a string or is absent, so a non-string /
    /// absent value drafts as empty — the web <c>: ''</c> branch.
    /// </summary>
    public static string EffectiveToDraft(VehicleSettingDescriptor descriptor, EffectiveSettingData? effective)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        if (effective is not { ValueIsText: true })
        {
            return string.Empty;
        }

        return descriptor.Kind == VehicleSettingKind.Timestamp
            ? Rfc3339ToLocalInput(effective.Value)
            : effective.Value;
    }

    /// <summary>
    /// Validate + convert a row draft into a value (web <c>parseDraft</c>): an empty trim is
    /// <see cref="VehicleSettingParseStatus.Empty"/>; a timestamp must parse to RFC3339; a select value must be in
    /// the option set; text passes through trimmed.
    /// </summary>
    public static VehicleSettingParseResult ParseDraft(VehicleSettingDescriptor descriptor, string draft)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        string trimmed = (draft ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return VehicleSettingParseResult.Empty;
        }

        switch (descriptor.Kind)
        {
            case VehicleSettingKind.Timestamp:
                string? iso = LocalInputToRfc3339(trimmed);
                return iso is null
                    ? VehicleSettingParseResult.Invalid("vehicleSettings.validation.invalidDate", "Enter a valid date and time.")
                    : VehicleSettingParseResult.Ok(VehicleSettingValue.Text(iso));

            case VehicleSettingKind.Select:
                bool allowed = descriptor.Options.Any(option => string.Equals(option.Value, trimmed, StringComparison.Ordinal));
                return allowed
                    ? VehicleSettingParseResult.Ok(VehicleSettingValue.Text(trimmed))
                    : VehicleSettingParseResult.Invalid("vehicleSettings.validation.invalid", "Value is not valid for this setting.");

            default:
                return VehicleSettingParseResult.Ok(VehicleSettingValue.Text(trimmed));
        }
    }

    /// <summary>
    /// Convert an RFC3339 instant from the API into the local <c>yyyy-MM-ddTHH:mm</c> shape the date + time pickers
    /// edit (web <c>rfc3339ToLocalInput</c>). Unparseable input drafts as empty ("no value").
    /// </summary>
    public static string Rfc3339ToLocalInput(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        if (!DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return string.Empty;
        }

        return parsed.ToLocalTime().ToString(LocalInputFormat, CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Convert the local <c>yyyy-MM-ddTHH:mm</c> draft the user edited back into an RFC3339 (UTC) instant
    /// (web <c>localInputToRFC3339</c>). Empty / unparseable input returns null so the caller short-circuits.
    /// </summary>
    public static string? LocalInputToRfc3339(string local)
    {
        if (string.IsNullOrEmpty(local))
        {
            return null;
        }

        if (!DateTime.TryParse(
                local,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var parsed))
        {
            return null;
        }

        return DateTime.SpecifyKind(parsed, DateTimeKind.Local)
            .ToUniversalTime()
            .ToString(Rfc3339Format, CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// The mutually-exclusive top-level data state for the surface — the native superset of the web component's
/// <c>isLoading</c> / <c>isError</c> / content branches plus the cache-then-network freshness states (Stale /
/// Offline / Empty) every P2 surface renders.
/// </summary>
public enum VehicleSettingsTabState
{
    /// <summary>Initial fetch with no cached value — the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh resolver payload arrived — the editable rows.</summary>
    Loaded,

    /// <summary>The resolver returned no rows — the rows still render with their system defaults.</summary>
    Empty,

    /// <summary>The load failed with no cached value — the retry surface (web <c>ErrorDisplay</c>).</summary>
    Error,

    /// <summary>A cached payload older than the freshness window — rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached payload remains — rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One render-ready per-vehicle setting row (the native projection of a web <c>VehicleSettingRow</c>). Carries the
/// descriptor metadata, the localized label / help text, the resolver source (pill text + colour) and the seeded
/// draft so the view is a thin renderer.
/// </summary>
public sealed record VehicleSettingRowDisplay(
    string Key,
    VehicleSettingKind Kind,
    IReadOnlyList<VehicleSettingOption> Options,
    int? MaxLength,
    string? AutoComplete,
    string Label,
    string Help,
    VehicleSettingSource Source,
    string SourceText,
    StatusKind SourceStatus,
    bool IsOverride,
    string InitialDraft,
    string RowAutomationId,
    string InputAutomationId,
    string SaveAutomationId,
    string ResetAutomationId,
    string SourceAutomationId);

/// <summary>
/// The fully projected, render-ready surface (web <c>VehicleSettingsTab</c>). Holds the panel chrome, the shared
/// action / validation / freshness labels and the ordered rows, so the WinUI view binds without touching the
/// localizer or the raw resolver payload.
/// </summary>
public sealed record VehicleSettingsTabDisplay(
    VehicleSettingsTabState State,
    string Title,
    string Subtitle,
    string AutomationName,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    string SaveLabel,
    string SavingLabel,
    string ResetLabel,
    string ResettingLabel,
    string RequiredMessage,
    string StaleLabel,
    string OfflineLabel,
    string SavedToast,
    string ResetToast,
    string SaveFailedToast,
    string ResetFailedToast,
    IReadOnlyList<VehicleSettingRowDisplay> Rows)
{
    /// <summary>True for the initial skeleton state.</summary>
    public bool ShowLoading => State == VehicleSettingsTabState.Loading;

    /// <summary>True for the hard-failure retry surface.</summary>
    public bool ShowError => State == VehicleSettingsTabState.Error;

    /// <summary>True for every content state (the rows always render — never a blank panel).</summary>
    public bool ShowContent => State is VehicleSettingsTabState.Loaded
        or VehicleSettingsTabState.Empty
        or VehicleSettingsTabState.Stale
        or VehicleSettingsTabState.Offline;

    /// <summary>True when a stale / offline freshness chip should accompany the rows.</summary>
    public bool ShowFreshnessChip => State is VehicleSettingsTabState.Stale or VehicleSettingsTabState.Offline;
}

/// <summary>
/// Pure projection from the resolver payload + localizer to the render-ready <see cref="VehicleSettingsTabDisplay"/>
/// — the native port of the static render logic in
/// web/src/features/vehicles/components/VehicleSettingsTab.tsx. Every string resolves through the i18n facade with
/// the web English literal as the fallback, so the resource keys are asserted in tests and resolved for real in the
/// app. WinUI-free.
/// </summary>
public static class VehicleSettingsTabProjection
{
    /// <summary>Project the state + resolved settings into the render-ready display.</summary>
    public static VehicleSettingsTabDisplay Project(
        VehicleSettingsTabState state,
        VehicleSettingsData? settings,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<VehicleSettingRowDisplay>(VehicleSettingDescriptor.All.Count);
        foreach (var descriptor in VehicleSettingDescriptor.All)
        {
            rows.Add(ProjectRow(descriptor, settings?.Find(descriptor.Key), localizer));
        }

        return new VehicleSettingsTabDisplay(
            State: state,
            Title: VehicleSettingsTabRegistration.Title(localizer),
            Subtitle: VehicleSettingsTabRegistration.Subtitle(localizer),
            AutomationName: VehicleSettingsTabRegistration.Title(localizer),
            ErrorText: localizer.GetString("vehicleSettings.error", "Could not load vehicle settings."),
            RetryLabel: localizer.GetString("translation.common.retry", "Retry"),
            EmptyMessage: localizer.GetString("vehicleSettings.empty", "No per-vehicle overrides yet."),
            SaveLabel: localizer.GetString("vehicleSettings.actions.save", "Save"),
            SavingLabel: localizer.GetString("vehicleSettings.actions.saving", "Saving\u2026"),
            ResetLabel: localizer.GetString("vehicleSettings.actions.reset", "Reset to default"),
            ResettingLabel: localizer.GetString("vehicleSettings.actions.resetting", "Resetting\u2026"),
            RequiredMessage: localizer.GetString("vehicleSettings.validation.required", "Value is required."),
            StaleLabel: localizer.GetString("translation.common.stale", "Stale"),
            OfflineLabel: localizer.GetString("translation.common.offline", "Offline"),
            SavedToast: localizer.GetString("vehicleSettings.toasts.saved", "Setting saved."),
            ResetToast: localizer.GetString("vehicleSettings.toasts.reset", "Reverted to default."),
            SaveFailedToast: localizer.GetString("vehicleSettings.errors.save", "Failed to save setting"),
            ResetFailedToast: localizer.GetString("vehicleSettings.errors.reset", "Failed to reset setting"),
            Rows: rows);
    }

    /// <summary>Project a single descriptor + its resolved row into the render-ready row display.</summary>
    public static VehicleSettingRowDisplay ProjectRow(
        VehicleSettingDescriptor descriptor,
        EffectiveSettingData? effective,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(localizer);

        var source = VehicleSettingSources.Parse(effective?.Source);
        string token = VehicleSettingSources.Token(source);

        return new VehicleSettingRowDisplay(
            Key: descriptor.Key,
            Kind: descriptor.Kind,
            Options: descriptor.Options,
            MaxLength: descriptor.MaxLength,
            AutoComplete: descriptor.AutoComplete,
            Label: localizer.GetString($"vehicleSettings.keys.{descriptor.Key}.label", descriptor.Key),
            Help: localizer.GetString($"vehicleSettings.keys.{descriptor.Key}.help", string.Empty),
            Source: source,
            SourceText: localizer.GetString($"vehicleSettings.source.{token}", token),
            SourceStatus: VehicleSettingSources.Status(source),
            IsOverride: source == VehicleSettingSource.Override,
            InitialDraft: VehicleSettingDraft.EffectiveToDraft(descriptor, effective),
            RowAutomationId: $"vehicle-settings-row-{descriptor.Key}",
            InputAutomationId: $"vehicle-settings-input-{descriptor.Key}",
            SaveAutomationId: $"vehicle-settings-save-{descriptor.Key}",
            ResetAutomationId: $"vehicle-settings-reset-{descriptor.Key}",
            SourceAutomationId: $"vehicle-settings-source-{token}");
    }
}

/// <summary>
/// Canonical registration metadata for the <c>VehicleSettingsTab</c> surface — the diagnostics slug emitted with the
/// <c>view.opened</c> event (P1/S11), the localized title / subtitle backing the Narrator name, and the generated
/// OpenAPI operation ids for the read + upsert + reset the web hooks compose. Every fallback equals its catalog value
/// so a headless <see cref="PassthroughLocalizer"/> renders identically to the app's resource bridge. WinUI-free.
/// </summary>
public static class VehicleSettingsTabRegistration
{
    /// <summary>Stable kebab-case surface id.</summary>
    public const string Id = "vehicle-settings";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleSettingsTab";

    /// <summary>The per-vehicle settings read — web <c>useVehicleSettings</c> (GET /vehicles/{id}/settings).</summary>
    public const string SettingsOperation = "get_api_v1_vehicles_vehicleID_settings";

    /// <summary>The per-key upsert — web <c>useUpsertVehicleSetting</c> (PUT /vehicles/{id}/settings/{key}).</summary>
    public const string UpsertOperation = "put_api_v1_vehicles_vehicleID_settings_key";

    /// <summary>The per-key reset — web <c>useResetVehicleSetting</c> (DELETE /vehicles/{id}/settings/{key}).</summary>
    public const string ResetOperation = "delete_api_v1_vehicles_vehicleID_settings_key";

    /// <summary>Localized surface title (web <c>t('vehicleSettings.title', 'Per-vehicle settings')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicleSettings.title", "Per-vehicle settings");
    }

    /// <summary>Localized surface subtitle (web <c>t('vehicleSettings.subtitle', …)</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "vehicleSettings.subtitle",
            "Override individual settings for this vehicle. Resets fall back to your account-wide values.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleSettingsTab</c> surface. Records only the operational <c>view.opened</c>
/// event with the surface slug — never a vehicle id, nickname or override value — so a diagnostics line can never leak
/// fleet data. Thread-safe.
/// </summary>
public sealed class VehicleSettingsTabDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleSettingsTabDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleSettingsTab</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleSettingsTabRegistration.Slug}");
    }
}
