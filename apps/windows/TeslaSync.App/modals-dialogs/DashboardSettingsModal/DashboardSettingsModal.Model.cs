using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The per-dashboard view options the modal edits — the native mirror of the web <c>DashboardSettings</c>
/// (web/src/features/dashboard/widgets/types.ts). <see cref="RefreshIntervalSeconds"/> is the auto-refresh
/// cadence in whole seconds (<c>0</c> = use each widget's own default, matching the web <c>refreshInterval</c>);
/// <see cref="VehicleId"/> scopes every widget to one vehicle (<c>null</c> = all vehicles, matching the optional
/// web <c>vehicleId</c>); <see cref="ShowWidgetBorders"/> and <see cref="CompactMode"/> mirror the two display
/// booleans. Pure data so it is asserted without a UI host.
/// </summary>
/// <param name="RefreshIntervalSeconds">Auto-refresh cadence in seconds (<c>0</c> = per-widget default).</param>
/// <param name="VehicleId">Optional vehicle scope applied to every widget (<c>null</c> = all vehicles).</param>
/// <param name="ShowWidgetBorders">Whether widget borders are shown in view mode.</param>
/// <param name="CompactMode">Whether the grid uses reduced gaps.</param>
public sealed record DashboardSettingsValues(
    int RefreshIntervalSeconds,
    long? VehicleId,
    bool ShowWidgetBorders,
    bool CompactMode)
{
    /// <summary>The factory defaults — the native mirror of the web <c>DEFAULT_DASHBOARD_SETTINGS</c>.</summary>
    public static DashboardSettingsValues Default { get; } = new(0, null, false, false);
}

/// <summary>
/// The subset of a saved dashboard the settings modal reads — the native mirror of the fields the web
/// <c>DashboardSettingsModal</c> consumes from its <c>SavedDashboard</c> prop
/// (web/src/features/dashboard/widgets/types.ts): the stable <see cref="Id"/> (the web reset key), the editable
/// <see cref="Name"/> and <see cref="Icon"/>, and the optional <see cref="Settings"/>. The modal never reads the
/// dashboard's widgets or layouts, so they are intentionally omitted. Pure data, asserted without a UI host.
/// </summary>
/// <param name="Id">The stable dashboard id (the web form-reset key).</param>
/// <param name="Name">The current dashboard name.</param>
/// <param name="Icon">The current dashboard icon glyph, or <c>null</c> when unset (web <c>icon?</c>).</param>
/// <param name="Settings">The current view options, or <c>null</c> to fall back to the defaults (web <c>settings?</c>).</param>
public sealed record SavedDashboardInput(
    string Id,
    string Name,
    string? Icon,
    DashboardSettingsValues? Settings);

/// <summary>
/// The diff the host applies when the modal is saved — the native mirror of the web <c>handleSave</c> contract
/// (web/src/features/dashboard/components/DashboardSettingsModal.tsx). <see cref="RenameTo"/> is non-<c>null</c>
/// only when the trimmed name is non-empty and differs from the original (web
/// <c>if (name.trim() &amp;&amp; name.trim() !== dashboard.name) onRename(...)</c>); <see cref="IconTo"/> is
/// non-<c>null</c> only when the icon differs from the original (web <c>if (icon !== dashboard.icon) onChangeIcon(...)</c>);
/// <see cref="Settings"/> is always present (web always calls <c>onUpdate(settings)</c>). Pure data so the diff is
/// asserted without a UI host.
/// </summary>
/// <param name="RenameTo">The new name to apply, or <c>null</c> when the name is unchanged / empty.</param>
/// <param name="IconTo">The new icon to apply, or <c>null</c> when the icon is unchanged.</param>
/// <param name="Settings">The view options to apply (always sent).</param>
public sealed record DashboardSettingsSaveResult(
    string? RenameTo,
    string? IconTo,
    DashboardSettingsValues Settings);

/// <summary>One dropdown choice (value token + localized label) for the vehicle / refresh selects.</summary>
/// <param name="Value">The selection value token (web option <c>value</c>; empty string = "all vehicles").</param>
/// <param name="Label">The localized, render-ready option label.</param>
public sealed record DashboardSelectOption(string Value, string Label);

/// <summary>
/// The mutually-exclusive surface states the <see cref="DashboardSettingsModalViewModel"/> resolves — the native
/// modelling of the web component's controlled <c>open</c> prop. The web source is a controlled form: its only
/// data dependency is <c>useTranslation</c>, and the dashboard + vehicles arrive as props from the parent page,
/// so there is deliberately no loading / error / stale / offline branch (there is no asynchronous read to be in
/// flight, to fail, to go stale or to fall back to a cache). The empty-data branch is reproduced as the
/// vehicle-filter degrading to the lone "All Vehicles" option when no vehicles are supplied — see
/// <see cref="DashboardSettingsModalViewModel.HasVehicles"/>.
/// </summary>
public enum DashboardSettingsModalState
{
    /// <summary>Not yet opened — the controlled modal is closed (web <c>open === false</c>).</summary>
    Closed,

    /// <summary>Opened with the form populated from the target dashboard (web <c>open === true</c>).</summary>
    Ready,
}

/// <summary>
/// Canonical metadata, glyph ordering and i18n keys for the <c>DashboardSettingsModal</c> surface — the native
/// mirror of <c>web/src/features/dashboard/components/DashboardSettingsModal.tsx</c>. The web component ships
/// literal copy under the <c>dashboard</c> translation namespace; every literal is keyed here (with that literal
/// as the English fallback, matching <c>web/src/i18n/en.json</c> and <c>Strings/en/Resources.resw</c>) so the
/// native view and view-model stay free of inline strings and resolve through the i18n facade. UI-free so every
/// key + bound is asserted headlessly.
/// </summary>
public static class DashboardSettingsModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DashboardSettingsModal";

    /// <summary>Default dashboard icon when none is set — the native mirror of the web <c>dashboard.icon ?? '📊'</c>.</summary>
    public const string DefaultIcon = "📊";

    /// <summary>
    /// The selectable dashboard icons in web render order — the native mirror of the web <c>DASHBOARD_EMOJIS</c>
    /// array (an 8-column picker grid).
    /// </summary>
    public static IReadOnlyList<string> EmojiOrder { get; } =
    [
        "📊", "🔋", "🚗", "⚡", "🛡️", "🗺️", "📈", "🎯",
        "🔧", "🏠", "🌡️", "🎮", "📱", "🖥️", "🔔", "⭐",
    ];

    /// <summary>The refresh-interval choices in seconds, in web render order (<c>0</c> = per-widget default).</summary>
    public static IReadOnlyList<int> RefreshSecondsOrder { get; } = [0, 5, 10, 30, 60, 300];

    /// <summary>Modal title (web <c>dashSettings.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.title", "Dashboard Settings");

    /// <summary>Identity section heading (web <c>dashSettings.identity</c>).</summary>
    public static string Identity(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.identity", "Identity");

    /// <summary>Name field label (web <c>dashSettings.nameLabel</c>).</summary>
    public static string NameLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.nameLabel", "Name");

    /// <summary>Name field prompt shown when empty (web <c>dashSettings.name</c>).</summary>
    public static string NamePrompt(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.name", "Dashboard name");

    /// <summary>Icon picker label (web <c>dashSettings.iconLabel</c>).</summary>
    public static string IconLabel(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.iconLabel", "Icon");

    /// <summary>Vehicle-filter section heading (web <c>dashSettings.vehicleFilter</c>).</summary>
    public static string VehicleFilter(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.vehicleFilter", "Vehicle Filter");

    /// <summary>Vehicle-filter description (web <c>dashSettings.vehicleFilterDesc</c>).</summary>
    public static string VehicleFilterDescription(ILocalizer localizer) =>
        Require(localizer).GetString(
            "dashSettings.vehicleFilterDesc",
            "Show data for a specific vehicle in all widgets. Widget-level filters take precedence.");

    /// <summary>The "all vehicles" vehicle-filter option label (web <c>dashSettings.allVehicles</c>).</summary>
    public static string AllVehicles(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.allVehicles", "All Vehicles");

    /// <summary>Auto-refresh section heading (web <c>dashSettings.refresh</c>).</summary>
    public static string Refresh(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.refresh", "Auto-Refresh");

    /// <summary>Display section heading (web <c>dashSettings.display</c>).</summary>
    public static string Display(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.display", "Display");

    /// <summary>Show-widget-borders toggle label (web <c>dashSettings.showBorders</c>).</summary>
    public static string ShowBorders(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.showBorders", "Show widget borders");

    /// <summary>Compact-mode toggle label (web <c>dashSettings.compactMode</c>).</summary>
    public static string CompactMode(ILocalizer localizer) =>
        Require(localizer).GetString("dashSettings.compactMode", "Compact mode (smaller gaps)");

    /// <summary>Cancel action label (web <c>common.cancel</c>).</summary>
    public static string Cancel(ILocalizer localizer) =>
        Require(localizer).GetString("common.cancel", "Cancel");

    /// <summary>Save action label (web <c>common.save</c>).</summary>
    public static string Save(ILocalizer localizer) =>
        Require(localizer).GetString("common.save", "Save");

    /// <summary>
    /// The localized label for a refresh-interval choice — the native mirror of the web
    /// <c>t(`dashSettings.refresh${value}`, label)</c> lookup, keyed by the option's whole-second value.
    /// </summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="seconds">The option's interval in seconds (one of <see cref="RefreshSecondsOrder"/>).</param>
    public static string RefreshOptionLabel(ILocalizer localizer, int seconds)
    {
        string key = string.Create(
            CultureInfo.InvariantCulture, $"dashSettings.refresh{seconds}");
        return Require(localizer).GetString(key, RefreshOptionFallback(seconds));
    }

    private static string RefreshOptionFallback(int seconds) => seconds switch
    {
        0 => "Default (per widget)",
        5 => "Every 5 seconds",
        10 => "Every 10 seconds",
        30 => "Every 30 seconds",
        60 => "Every minute",
        300 => "Every 5 minutes",
        _ => string.Create(CultureInfo.InvariantCulture, $"Every {seconds} seconds"),
    };

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>DashboardSettingsModal</c> surface — the native analogue of the web component's
/// option lists, icon / settings defaulting and save-diff assembly. Every user-visible string flows through the
/// i18n facade so the projection is unit-tested headlessly and the view-model never resolves a literal.
/// </summary>
public static class DashboardSettingsModalProjection
{
    /// <summary>The selectable dashboard icons in web render order.</summary>
    public static IReadOnlyList<string> Emojis() => DashboardSettingsModalRegistration.EmojiOrder;

    /// <summary>
    /// Normalize a dashboard icon, falling back to the default glyph when none is set — the native mirror of the
    /// web <c>dashboard.icon ?? '📊'</c>.
    /// </summary>
    public static string NormalizeIcon(string? icon) =>
        icon ?? DashboardSettingsModalRegistration.DefaultIcon;

    /// <summary>
    /// Resolve the editable settings, falling back to the defaults when none are set — the native mirror of the
    /// web <c>dashboard.settings ?? { ...DEFAULT_DASHBOARD_SETTINGS }</c>.
    /// </summary>
    public static DashboardSettingsValues ResolveSettings(DashboardSettingsValues? settings) =>
        settings ?? DashboardSettingsValues.Default;

    /// <summary>
    /// Build the vehicle-filter options — the leading localized "All Vehicles" entry (empty value) followed by one
    /// entry per vehicle (id token + display label) — the native mirror of the web <c>vehicleOptions</c>.
    /// </summary>
    /// <param name="vehicles">The vehicles supplied by the host (may be empty).</param>
    /// <param name="localizer">The i18n facade the "All Vehicles" label resolves through.</param>
    public static IReadOnlyList<DashboardSelectOption> VehicleOptions(
        IReadOnlyList<VehicleOption> vehicles, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);

        var options = new List<DashboardSelectOption>(vehicles.Count + 1)
        {
            new(string.Empty, DashboardSettingsModalRegistration.AllVehicles(localizer)),
        };

        foreach (VehicleOption vehicle in vehicles)
        {
            options.Add(new DashboardSelectOption(
                vehicle.Id.ToString(CultureInfo.InvariantCulture),
                VehicleLabels.Short(vehicle)));
        }

        return options;
    }

    /// <summary>
    /// Build the auto-refresh options (value token + localized label) in web render order — the native mirror of
    /// the web <c>REFRESH_OPTIONS</c> mapped through <c>t()</c>.
    /// </summary>
    /// <param name="localizer">The i18n facade the option labels resolve through.</param>
    public static IReadOnlyList<DashboardSelectOption> RefreshOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<int> order = DashboardSettingsModalRegistration.RefreshSecondsOrder;
        var options = new List<DashboardSelectOption>(order.Count);
        foreach (int seconds in order)
        {
            options.Add(new DashboardSelectOption(
                seconds.ToString(CultureInfo.InvariantCulture),
                DashboardSettingsModalRegistration.RefreshOptionLabel(localizer, seconds)));
        }

        return options;
    }

    /// <summary>
    /// Assemble the save diff from the original dashboard and the edited fields — the native mirror of the web
    /// <c>handleSave</c>: a trimmed, non-empty, changed name becomes <see cref="DashboardSettingsSaveResult.RenameTo"/>;
    /// a changed icon becomes <see cref="DashboardSettingsSaveResult.IconTo"/>; the settings are always carried.
    /// </summary>
    /// <param name="original">The dashboard the modal was opened for.</param>
    /// <param name="name">The edited name (trimmed before comparison).</param>
    /// <param name="icon">The edited icon glyph.</param>
    /// <param name="settings">The edited view options.</param>
    public static DashboardSettingsSaveResult BuildSaveResult(
        SavedDashboardInput original, string name, string icon, DashboardSettingsValues settings)
    {
        ArgumentNullException.ThrowIfNull(original);
        ArgumentNullException.ThrowIfNull(settings);

        string trimmed = (name ?? string.Empty).Trim();
        string? renameTo = trimmed.Length > 0 && !string.Equals(trimmed, original.Name, StringComparison.Ordinal)
            ? trimmed
            : null;

        string? iconTo = !string.Equals(icon, original.Icon, StringComparison.Ordinal)
            ? icon
            : null;

        return new DashboardSettingsSaveResult(renameTo, iconTo, settings);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DashboardSettingsModal</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> and <c>settings.saved</c> counters with the surface slug — never a dashboard
/// name, icon or vehicle id — so a diagnostics line can never leak which dashboard a user is editing. Thread-safe.
/// </summary>
public sealed class DashboardSettingsModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _settingsSaved;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public DashboardSettingsModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the modal has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the settings have been saved.</summary>
    public long SettingsSaved => Interlocked.Read(ref _settingsSaved);

    /// <summary>Record that the modal opened, emitting <c>view.opened slug=DashboardSettingsModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DashboardSettingsModalRegistration.Slug}");
    }

    /// <summary>Record that the settings were saved, emitting <c>settings.saved slug=DashboardSettingsModal</c>.</summary>
    public void RecordSettingsSaved()
    {
        Interlocked.Increment(ref _settingsSaved);
        _sink?.Invoke($"settings.saved slug={DashboardSettingsModalRegistration.Slug}");
    }
}
