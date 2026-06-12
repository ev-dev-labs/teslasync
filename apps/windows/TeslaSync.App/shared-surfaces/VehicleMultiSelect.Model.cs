using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the multi-vehicle picker surface — the native mirror of the web
/// <c>VehicleMultiSelect</c> (web/src/components/forms/VehicleMultiSelect.tsx), the Alert Studio's
/// "All vehicles (current + future)" vs explicit-subset picker. It carries the diagnostics slug the surface
/// registers under, every render-contract i18n key/fallback the web source passes to <c>t()</c> (verbatim
/// English fallbacks, including the i18next <c>{{name}}</c> / <c>{{count}}</c> / <c>{{total}}</c> / <c>{{id}}</c>
/// tokens), and the canonical <c>common.*</c> / <c>queryError.*</c> keys the native loading / error / stale /
/// offline chrome reuses (the web component receives its fleet as a prop and so has no such chrome of its own).
/// Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the web keys
/// already exist in <c>Strings/en/Resources.resw</c>) and resolves against the English fallback headlessly.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class VehicleMultiSelectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehicleMultiSelect";

    /// <summary>The i18next name token interpolated into the single-selection summary (web <c>{{name}}</c>).</summary>
    public const string NameToken = "{{name}}";

    /// <summary>The i18next count token interpolated into the partial / count summaries (web <c>{{count}}</c>).</summary>
    public const string CountToken = "{{count}}";

    /// <summary>The i18next total token interpolated into the partial summary (web <c>{{total}}</c>).</summary>
    public const string TotalToken = "{{total}}";

    /// <summary>The i18next id token interpolated into the unknown-vehicle label (web <c>{{id}}</c>).</summary>
    public const string IdToken = "{{id}}";

    // ── Field + listbox accessible name ──────────────────────────────────────────────────────────────────

    /// <summary>i18n key for the field + listbox accessible name (web Alert Studio <c>vehiclesLabel</c>).</summary>
    public const string LabelKey = "translation.notifications.alertStudio.editor.vehiclesLabel";

    /// <summary>English fallback for <see cref="LabelKey"/> (catalog copy, verbatim).</summary>
    public const string LabelFallback = "Vehicles";

    // ── Trigger summary (web triggerSummary ternary, L127-L165) ──────────────────────────────────────────

    /// <summary>i18n key for the all-vehicles summary (web <c>vehiclesSummaryAll</c>).</summary>
    public const string SummaryAllKey = "translation.notifications.alertStudio.editor.vehiclesSummaryAll";

    /// <summary>English fallback for <see cref="SummaryAllKey"/> (web second arg, verbatim).</summary>
    public const string SummaryAllFallback = "All vehicles";

    /// <summary>i18n key for the no-selection summary (web <c>vehiclesSummaryNone</c>).</summary>
    public const string SummaryNoneKey = "translation.notifications.alertStudio.editor.vehiclesSummaryNone";

    /// <summary>English fallback for <see cref="SummaryNoneKey"/> (web second arg, verbatim).</summary>
    public const string SummaryNoneFallback = "No vehicles selected";

    /// <summary>i18n key for the single-vehicle summary (web <c>vehiclesSummaryOne</c>).</summary>
    public const string SummaryOneKey = "translation.notifications.alertStudio.editor.vehiclesSummaryOne";

    /// <summary>English fallback for <see cref="SummaryOneKey"/> (web second arg — the bare <c>{{name}}</c> token).</summary>
    public const string SummaryOneFallback = "{{name}}";

    /// <summary>i18n key for the partial-subset summary (web <c>vehiclesSummaryPartial</c>).</summary>
    public const string SummaryPartialKey = "translation.notifications.alertStudio.editor.vehiclesSummaryPartial";

    /// <summary>English fallback for <see cref="SummaryPartialKey"/> (web second arg, verbatim).</summary>
    public const string SummaryPartialFallback = "{{count}} of {{total}} vehicles";

    /// <summary>i18n key for the count summary (web <c>vehiclesSummaryCount</c>).</summary>
    public const string SummaryCountKey = "translation.notifications.alertStudio.editor.vehiclesSummaryCount";

    /// <summary>English fallback for <see cref="SummaryCountKey"/> (web second arg, verbatim).</summary>
    public const string SummaryCountFallback = "{{count}} vehicles";

    // ── Popover body ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>i18n key for the fleet-wide sentinel option (web <c>vehiclesAllOption</c>).</summary>
    public const string AllOptionKey = "translation.notifications.alertStudio.editor.vehiclesAllOption";

    /// <summary>English fallback for <see cref="AllOptionKey"/> (web second arg, verbatim).</summary>
    public const string AllOptionFallback = "All vehicles (current + future)";

    /// <summary>i18n key for an unknown (stored-but-missing) vehicle's row label (web <c>vehiclesUnknownLabel</c>).</summary>
    public const string UnknownLabelKey = "translation.notifications.alertStudio.editor.vehiclesUnknownLabel";

    /// <summary>English fallback for <see cref="UnknownLabelKey"/> (web second arg — carries the <c>{{id}}</c> token).</summary>
    public const string UnknownLabelFallback = "Vehicle #{{id}}";

    /// <summary>i18n key for the unknown-vehicle warning badge (web <c>vehiclesUnknownBadge</c>).</summary>
    public const string UnknownBadgeKey = "translation.notifications.alertStudio.editor.vehiclesUnknownBadge";

    /// <summary>English fallback for <see cref="UnknownBadgeKey"/> (web second arg, verbatim).</summary>
    public const string UnknownBadgeFallback = "Unknown";

    /// <summary>i18n key for the empty-fleet help text (web <c>vehiclesEmptyFleetHelp</c>).</summary>
    public const string EmptyFleetHelpKey = "translation.notifications.alertStudio.editor.vehiclesEmptyFleetHelp";

    /// <summary>English fallback for <see cref="EmptyFleetHelpKey"/> (web second arg, verbatim — the arrow is U+2192).</summary>
    public const string EmptyFleetHelpFallback = "Add a vehicle in Settings \u2192 Vehicles to use this rule.";

    // ── Native state-matrix chrome (no web VehicleMultiSelect equivalent; the useVehicles query has these) ──

    /// <summary>i18n key for the fleet-loading caption (canonical <c>common.loading</c>).</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the fleet-load error title (canonical <c>queryError.title</c>).</summary>
    public const string ErrorKey = "translation.queryError.title";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Failed to load data";

    /// <summary>i18n key for the retry affordance (canonical <c>common.retry</c>).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale chip (canonical <c>common.stale</c>).</summary>
    public const string StaleKey = "translation.common.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>i18n key for the offline chip (canonical <c>common.offline</c>).</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>Resolve the field + listbox accessible name through the localizer.</summary>
    public static string Label(ILocalizer localizer) => Resolve(localizer, LabelKey, LabelFallback);

    /// <summary>Resolve the fleet-wide sentinel option label through the localizer.</summary>
    public static string AllOption(ILocalizer localizer) => Resolve(localizer, AllOptionKey, AllOptionFallback);

    /// <summary>Resolve the empty-fleet help text through the localizer.</summary>
    public static string EmptyFleetHelp(ILocalizer localizer) => Resolve(localizer, EmptyFleetHelpKey, EmptyFleetHelpFallback);

    /// <summary>Resolve the unknown-vehicle warning badge through the localizer.</summary>
    public static string UnknownBadge(ILocalizer localizer) => Resolve(localizer, UnknownBadgeKey, UnknownBadgeFallback);

    /// <summary>Resolve the fleet-loading caption through the localizer.</summary>
    public static string Loading(ILocalizer localizer) => Resolve(localizer, LoadingKey, LoadingFallback);

    /// <summary>Resolve the fleet-load error title through the localizer.</summary>
    public static string ErrorTitle(ILocalizer localizer) => Resolve(localizer, ErrorKey, ErrorFallback);

    /// <summary>Resolve the retry affordance label through the localizer.</summary>
    public static string Retry(ILocalizer localizer) => Resolve(localizer, RetryKey, RetryFallback);

    /// <summary>Resolve the stale chip caption through the localizer.</summary>
    public static string Stale(ILocalizer localizer) => Resolve(localizer, StaleKey, StaleFallback);

    /// <summary>Resolve the offline chip caption through the localizer.</summary>
    public static string Offline(ILocalizer localizer) => Resolve(localizer, OfflineKey, OfflineFallback);

    /// <summary>Resolve an unknown (stored-but-missing) vehicle's row label, interpolating its id (web <c>{{id}}</c>).</summary>
    public static string UnknownLabel(ILocalizer localizer, long id) =>
        Interpolate(Resolve(localizer, UnknownLabelKey, UnknownLabelFallback), "id", id, slot: 0);

    /// <summary>
    /// Resolve + interpolate the trigger summary for a selection over a fleet — the native projection of the web
    /// <c>triggerSummary</c> ternary (web/src/components/forms/VehicleMultiSelect.tsx L127-L165). The structured
    /// <paramref name="summary"/> selects the copy (all / none / one / partial / count) and the localizer
    /// resolves it, with the name / count / total interpolated into the i18next (or native positional) tokens.
    /// </summary>
    public static string Summary(ILocalizer localizer, SelectionSummary summary)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return summary.Kind switch
        {
            SelectionSummaryKind.All => Resolve(localizer, SummaryAllKey, SummaryAllFallback),
            SelectionSummaryKind.None => Resolve(localizer, SummaryNoneKey, SummaryNoneFallback),
            SelectionSummaryKind.One => Interpolate(
                Resolve(localizer, SummaryOneKey, SummaryOneFallback), "name", summary.Name ?? string.Empty, slot: 0),
            SelectionSummaryKind.Partial => InterpolatePartial(
                Resolve(localizer, SummaryPartialKey, SummaryPartialFallback), summary.Count, summary.Total),
            _ => Interpolate(
                Resolve(localizer, SummaryCountKey, SummaryCountFallback), "count", summary.Count, slot: 0),
        };
    }

    private static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }

    private static string InterpolatePartial(string template, int count, int total)
    {
        // web "{{count}} of {{total}} vehicles" / catalog "{0} of {1} vehicles": count fills the i18next
        // {{count}} token and the native {0} slot; total fills {{total}} and {1}.
        string withCount = Interpolate(template, "count", count, slot: 0);
        return Interpolate(withCount, "total", total, slot: 1);
    }

    private static string Interpolate(string template, string token, long value, int slot) =>
        Interpolate(template, token, value.ToString(CultureInfo.CurrentCulture), slot);

    private static string Interpolate(string template, string token, string value, int slot)
    {
        ArgumentNullException.ThrowIfNull(template);

        // Substitute the web i18next token ({{token}}) and the native positional slot ({0}/{1}) so the same
        // projection works whether the string came from the resw catalog (which uses {0}/{1}) or the English
        // fallback (which uses {{token}}). A literal replace (never string.Format) means a localized value
        // carrying a stray brace can never throw a FormatException.
        return template
            .Replace("{{" + token + "}}", value, StringComparison.Ordinal)
            .Replace("{" + slot.ToString(CultureInfo.InvariantCulture) + "}", value, StringComparison.Ordinal);
    }
}

/// <summary>
/// The render state of the picker's backing fleet read — the native projection of the web <c>useVehicles</c>
/// query lifecycle onto the states the prompt requires every surface to render. The web
/// <c>VehicleMultiSelect</c> receives its fleet as a prop and so renders only the fleet-empty branch itself;
/// the native surface owns the read and reproduces the full matrix. <see cref="Loaded"/> / <see cref="Empty"/>
/// are terminal success branches; <see cref="Stale"/> / <see cref="Offline"/> keep the cached fleet visible
/// while signalling freshness; <see cref="Error"/> is the hard failure with no cached fleet.
/// </summary>
public enum VehicleMultiSelectFleetState
{
    /// <summary>The fleet is loading and no cached list is visible yet (web query <c>isLoading</c>, no data).</summary>
    Loading,

    /// <summary>A fresh fleet is loaded (web query <c>data</c> with a current network result).</summary>
    Loaded,

    /// <summary>The fleet resolved with no vehicles — the web <c>isFleetEmpty</c> branch (disabled trigger + help).</summary>
    Empty,

    /// <summary>The fleet load failed with no cached list to fall back to (web query <c>isError</c>).</summary>
    Error,

    /// <summary>A cached fleet is shown while a background refresh runs (cache past its freshness window).</summary>
    Stale,

    /// <summary>The network failed but a cached fleet remains usable (offline).</summary>
    Offline,
}

/// <summary>Which arm of the popover option list a row belongs to.</summary>
public enum VehicleMultiSelectOptionKind
{
    /// <summary>The "All vehicles (current + future)" sentinel row (web L282-L317).</summary>
    AllSentinel,

    /// <summary>A known fleet vehicle row (web <c>vehicles.map</c>, L321-L363).</summary>
    Vehicle,

    /// <summary>A stored-but-missing vehicle row carrying the "Unknown" badge (web L365-L410).</summary>
    Unknown,
}

/// <summary>
/// One projected popover row — the native analogue of a single web option <c>button role="checkbox"</c>
/// (web/src/components/forms/VehicleMultiSelect.tsx). The view renders these without any selection logic of its
/// own: <see cref="Kind"/> selects the row chrome (the sentinel, a vehicle, or an unknown row with its badge),
/// <see cref="Label"/> is the already-localized text, <see cref="IsChecked"/> drives the checkbox glyph +
/// <c>aria-checked</c>, and <see cref="AutomationId"/> mirrors the web <c>data-testid</c> for UI automation.
/// </summary>
/// <param name="Kind">Which arm of the list the row belongs to.</param>
/// <param name="Id">The vehicle id (0 for the sentinel).</param>
/// <param name="Label">The already-localized row label.</param>
/// <param name="IsChecked">Whether the row is currently selected (drives the glyph + <c>aria-checked</c>).</param>
/// <param name="AutomationId">The stable automation id (web <c>data-testid</c>).</param>
public sealed record VehicleMultiSelectOption(
    VehicleMultiSelectOptionKind Kind,
    long Id,
    string Label,
    bool IsChecked,
    string AutomationId);

/// <summary>
/// PII-safe diagnostics for the multi-vehicle picker (P1/S11 diagnostics contract). A fleet picker's labels
/// carry user-facing content (vehicle display names, VIN suffixes), so the collector records ONLY the
/// operational <see cref="RecordViewOpened"/> signal with the surface slug — never the fleet, the labels, or
/// the committed selection. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class VehicleMultiSelectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleMultiSelectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleMultiSelect</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={VehicleMultiSelectRegistration.Slug}"));
    }
}
