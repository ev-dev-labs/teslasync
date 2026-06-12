using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the vehicle-scope picker surface — the native mirror of the web
/// <c>VehicleSelect</c> (web/src/components/forms/VehicleSelect.tsx). The web component is the canonical
/// per-page vehicle scope picker: a controlled <c>&lt;Select&gt;</c> wired to the global
/// <c>useSelectedVehicle()</c> store that renders one option per fleet vehicle (labelled
/// <c>display_name || vin || `Vehicle ${id}`</c>) and writes the chosen id back to the store; it renders
/// nothing when the fleet is empty and can be prefixed with a small decorative <c>Car</c> icon. This
/// metadata carries the diagnostics slug the surface registers under and every render-contract i18n
/// key/fallback the native surface resolves through the P1/S10 facade. The single key the web source passes
/// to <c>t()</c> is <see cref="AriaKey"/> (web <c>t('vehicleSelect.aria', 'Select vehicle')</c>); the
/// remaining keys caption the native loading / empty / error chrome the production-polished Windows surface
/// renders over the shared <see cref="TeslaSync.App.Core.Forms.VehicleSelectState"/> state holder (the web
/// component delegates those states to the page, but a native scope picker shows them inline). Every key
/// carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves against the
/// English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class VehicleSelectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "VehicleSelect";

    /// <summary>i18n key for the trigger's accessible name — the one key the web source passes to <c>t()</c> (web <c>vehicleSelect.aria</c>).</summary>
    public const string AriaKey = "translation.vehicleSelect.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> (web second arg, verbatim).</summary>
    public const string AriaFallback = "Select vehicle";

    /// <summary>i18n key for the unselected-state prompt shown in the closed trigger (native chrome).</summary>
    public const string PromptKey = "translation.vehicleSelect.prompt";

    /// <summary>English fallback for <see cref="PromptKey"/>.</summary>
    public const string PromptFallback = "Select a vehicle";

    /// <summary>i18n key for the loading caption shown while the fleet is in flight (native chrome).</summary>
    public const string LoadingKey = "translation.vehicleSelect.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/> (ellipsis included).</summary>
    public const string LoadingFallback = "Loading vehicles\u2026";

    /// <summary>i18n key for the empty-state heading shown when the fleet resolved with no vehicles (native chrome).</summary>
    public const string EmptyTitleKey = "translation.vehicleSelect.emptyTitle";

    /// <summary>English fallback for <see cref="EmptyTitleKey"/>.</summary>
    public const string EmptyTitleFallback = "No vehicles";

    /// <summary>i18n key for the empty-state message shown when the fleet resolved with no vehicles (native chrome).</summary>
    public const string EmptyMessageKey = "translation.vehicleSelect.emptyMessage";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No vehicles are linked to this account yet.";

    /// <summary>i18n key for the error-state heading shown when the fleet load failed (native chrome).</summary>
    public const string ErrorTitleKey = "translation.vehicleSelect.errorTitle";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/> (curly apostrophe to match the app voice).</summary>
    public const string ErrorTitleFallback = "Couldn\u2019t load vehicles";

    /// <summary>i18n key for the retry affordance shown in the error state (native chrome).</summary>
    public const string RetryKey = "translation.vehicleSelect.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Try again";
}

/// <summary>
/// The mutually-exclusive state the vehicle-scope picker renders — the native projection of the web source's
/// fleet binding (web/src/components/forms/VehicleSelect.tsx) widened to the loading / empty / error / loaded
/// contract of the shared <see cref="TeslaSync.App.Core.Forms.VehicleSelectState"/> holder. The web component
/// only branches on "fleet empty → render nothing" vs "fleet present → render the select", because the web
/// <c>useSelectedVehicle()</c> store is a plain scope value with no freshness or connectivity dimension;
/// there is therefore no stale / offline chrome to reproduce. A native scope picker, however, binds the fleet
/// load directly and so renders the in-flight (<see cref="Loading"/>), failed (<see cref="Error"/>) and
/// resolved-but-empty (<see cref="Empty"/>) states inline as well as the populated picker (<see cref="Ready"/>).
/// </summary>
public enum VehicleSelectStatus
{
    /// <summary>The fleet is loading (or no load has started yet) — the busy chrome.</summary>
    Loading,

    /// <summary>The fleet loaded with at least one vehicle — the populated picker (web non-empty branch).</summary>
    Ready,

    /// <summary>The fleet resolved with no vehicles — the friendly empty surface (web returns nothing here).</summary>
    Empty,

    /// <summary>The fleet load failed — the error surface with a retry affordance.</summary>
    Error,
}

/// <summary>
/// PII-safe diagnostics for the vehicle-scope picker surface (P1/S11 diagnostics contract). A vehicle picker's
/// option labels carry user-facing content (display names, VINs), so the collector records ONLY the
/// operational <see cref="RecordViewOpened"/> signal with the surface slug — never the fleet, the labels, or
/// the selected id. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class VehicleSelectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleSelectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleSelect</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={VehicleSelectRegistration.Slug}"));
    }
}
