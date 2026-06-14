using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SignalDiff;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// One fleet vehicle as the Signal Diff page's page-local picker sees it — the native analogue of the web
/// <c>useVehicles</c> rows the page binds (web/src/features/telemetry/pages/SignalDiffPage.tsx). The picker is
/// deliberately page-local (not the global vehicle selector) so a shared/saved view can pin to a specific car,
/// exactly as the web keeps it. <see cref="DisplayName"/> falls back to <see cref="Vin"/> when blank, mirroring the
/// web option label <c>v.display_name || v.vin</c>. Pure data — parsed by <see cref="ParseList"/>, asserted headlessly.
/// </summary>
/// <param name="Id">The vehicle id (web <c>v.id</c>) — the picker's option value and the diff/pin context key.</param>
/// <param name="DisplayName">The vehicle's display name (web <c>v.display_name</c>); may be blank.</param>
/// <param name="Vin">The vehicle VIN (web <c>v.vin</c>) — the option-label fallback when the name is blank.</param>
public sealed record SignalDiffVehicle(long Id, string DisplayName, string Vin)
{
    /// <summary>
    /// Parse a <c>GET /vehicles</c> response into a tolerant, order-preserving list. Accepts a bare array or a
    /// <c>{ data: [...] }</c> / <c>{ vehicles: [...] }</c> envelope; each entry reads <c>id</c>, <c>display_name</c>
    /// and <c>vin</c>. A non-array body (after unwrapping) yields an empty list so a schema-drifted response never throws.
    /// </summary>
    public static IReadOnlyList<SignalDiffVehicle> ParseList(JsonElement element)
    {
        JsonElement array = element;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("data", out var data))
            {
                array = data;
            }
            else if (element.TryGetProperty("vehicles", out var vehicles))
            {
                array = vehicles;
            }
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalDiffVehicle>();
        }

        var list = new List<SignalDiffVehicle>(array.GetArrayLength());
        foreach (var entry in array.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new SignalDiffVehicle(
                ReadLong(entry, "id"),
                ReadString(entry, "display_name") ?? string.Empty,
                ReadString(entry, "vin") ?? string.Empty));
        }

        return list;
    }

    /// <summary>The picker label (web <c>v.display_name || v.vin</c>): the display name, else the VIN, else the id.</summary>
    public string Label =>
        !string.IsNullOrWhiteSpace(DisplayName)
            ? DisplayName
            : !string.IsNullOrWhiteSpace(Vin)
                ? Vin
                : Id.ToString(CultureInfo.InvariantCulture);

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String ? prop.GetString() : null;

    private static long ReadLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var prop))
        {
            return 0;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => 0,
        };
    }
}

/// <summary>One render-ready vehicle-picker option — the native analogue of the web <c>vehicleOptions</c> entry.</summary>
/// <param name="Value">The option value (the vehicle id as a string, web <c>String(v.id)</c>).</param>
/// <param name="Label">The option label (web <c>v.display_name || v.vin</c>).</param>
public sealed record SignalDiffVehicleOption(string Value, string Label);

/// <summary>
/// The render-time data model the <c>SignalDiffPage</c> projects from — the native analogue of the web page's
/// resolved query state plus its URL-synced picker / window / filter / selection state
/// (web/src/features/telemetry/pages/SignalDiffPage.tsx). Pure data (no WinUI types) so the projection is unit-tested
/// without a UI host. The diff rows reuse the already-ported pure <see cref="SignalDiffRow"/> so this standalone page
/// and the unified workspace stay in lockstep.
/// </summary>
/// <param name="VehicleId">The selected vehicle id (web <c>vehicleId</c>); <c>0</c> means none selected yet.</param>
/// <param name="Vehicles">The fleet vehicles backing the picker (web <c>useVehicles</c>).</param>
/// <param name="DiffState">The two-snapshot diff query's state (web <c>useSignalDiffServer</c>).</param>
/// <param name="DiffRows">The unfiltered diff rows for the two snapshots (web <c>allRows</c>).</param>
/// <param name="Search">The signal-name filter (web <c>signalFilter</c>).</param>
/// <param name="Category">The active category-prefix id, or null (web <c>activeCategory</c>).</param>
/// <param name="PinnedSignals">The pinned signal names (web <c>pinnedSignals</c> from <c>usePinned</c>).</param>
/// <param name="SelectedSignals">The selected signal names (web <c>selectedSignals</c>).</param>
/// <param name="WindowA">The Window-A instant, or null (web <c>atAIso</c>).</param>
/// <param name="WindowB">The Window-B instant, or null (web <c>atBIso</c>).</param>
public sealed record SignalDiffPageModel(
    long VehicleId,
    IReadOnlyList<SignalDiffVehicle> Vehicles,
    SignalsWorkspaceDataState DiffState,
    IReadOnlyList<SignalDiffRow> DiffRows,
    string Search,
    string? Category,
    IReadOnlySet<string> PinnedSignals,
    IReadOnlyList<string> SelectedSignals,
    DateTimeOffset? WindowA,
    DateTimeOffset? WindowB)
{
    /// <summary>The initial model — no vehicle, the diff query idle/empty, nothing chosen.</summary>
    public static SignalDiffPageModel Initial { get; } = new(
        VehicleId: 0,
        Vehicles: Array.Empty<SignalDiffVehicle>(),
        DiffState: SignalsWorkspaceDataState.Empty,
        DiffRows: Array.Empty<SignalDiffRow>(),
        Search: string.Empty,
        Category: null,
        PinnedSignals: new HashSet<string>(),
        SelectedSignals: Array.Empty<string>(),
        WindowA: null,
        WindowB: null);
}

/// <summary>
/// The fully projected, render-ready view of the Signal Diff page for one input model — every visible label resolved
/// through the i18n facade, the four stat-card values, the bulk-action labels, the per-source diff data-state flags,
/// the pinned-first-sorted diff rows and the pinned chips. Pure data so every branch is asserted headlessly; the WinUI
/// view is a thin renderer that toggles section visibility from these flags.
/// </summary>
public sealed record SignalDiffPageDisplay
{
    /// <summary>The page title (web <c>signalDiff.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>signalDiff.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The "Share" copy-link affordance label (web <c>signalDiff.share</c>).</summary>
    public required string ShareLabel { get; init; }

    // ── Vehicle picker (SignalCompareControls top slot) ─────────────────────────────────────────
    /// <summary>The vehicle-picker label (web <c>signalDiff.vehicle</c>).</summary>
    public required string VehicleLabel { get; init; }

    /// <summary>The vehicle-picker options (web <c>vehicleOptions</c>).</summary>
    public required IReadOnlyList<SignalDiffVehicleOption> VehicleOptions { get; init; }

    /// <summary>The selected option value (the vehicle id as a string, or empty when none).</summary>
    public required string SelectedVehicleValue { get; init; }

    // ── Stat cards (panels 1-4) ─────────────────────────────────────────────────────────────────
    /// <summary>The "Changed signals" stat label (web <c>signalDiff.totalChanged</c>).</summary>
    public required string ChangedSignalsLabel { get; init; }

    /// <summary>The "Changed signals" value (web <c>allRows.length</c>, em-dash while loading).</summary>
    public required string ChangedSignalsValue { get; init; }

    /// <summary>The "Visible after filter" stat label (web <c>signalDiff.visible</c>).</summary>
    public required string VisibleLabel { get; init; }

    /// <summary>The "Visible after filter" value (web <c>filteredRows.length</c>, em-dash while loading).</summary>
    public required string VisibleValue { get; init; }

    /// <summary>The "Pinned" stat label (web <c>signalDiff.pinnedCount</c>).</summary>
    public required string PinnedLabel { get; init; }

    /// <summary>The "Pinned" value (web <c>pinnedSignals.size</c>).</summary>
    public required string PinnedValue { get; init; }

    /// <summary>The "Window span" stat label (web <c>signalDiff.windowSpan</c>).</summary>
    public required string WindowSpanLabel { get; init; }

    /// <summary>The "Window span" value (web <c>|atB - atA| / 1000</c> seconds, em-dash when either window is unset).</summary>
    public required string WindowSpanValue { get; init; }

    // ── Bulk-actions toolbar ────────────────────────────────────────────────────────────────────
    /// <summary>The bulk "Pin selected" label (web <c>signalDiff.bulk.pin</c>).</summary>
    public required string BulkPinLabel { get; init; }

    /// <summary>The bulk "Unpin selected" label (web <c>signalDiff.bulk.unpin</c>).</summary>
    public required string BulkUnpinLabel { get; init; }

    /// <summary>The bulk "Copy CSV" label (web <c>signalDiff.bulk.csv</c>).</summary>
    public required string BulkCsvLabel { get; init; }

    /// <summary>The bulk "Add as alert rule" label (web <c>signalDiff.bulk.addAlert</c>).</summary>
    public required string BulkAddAlertLabel { get; init; }

    // ── Diff panel (panel 5: GlassPanel5) ───────────────────────────────────────────────────────
    /// <summary>The load-failure banner message (web <c>signalDiff.error</c>).</summary>
    public required string ErrorMessage { get; init; }

    /// <summary>The "no signals changed" empty copy (web <c>signalDiff.noChanges</c>).</summary>
    public required string NoChangesMessage { get; init; }

    /// <summary>The pinned-chips label (web <c>signalDiff.pinnedLabel</c>).</summary>
    public required string PinnedChipsLabel { get; init; }

    /// <summary>The pinned signal names, sorted (web <c>Array.from(pinnedSignals).sort()</c>).</summary>
    public required IReadOnlyList<string> PinnedChips { get; init; }

    /// <summary>The filtered + pinned-first-sorted diff rows the table renders (web <c>filteredRows</c>).</summary>
    public required SignalDiffDisplay DiffDisplay { get; init; }

    // ── Data-state flags (web render branches) ──────────────────────────────────────────────────
    /// <summary>Whether the load-failure banner is shown (web <c>error</c>).</summary>
    public required bool ShowError { get; init; }

    /// <summary>Whether the loading skeleton replaces the table body (web <c>isLoading &amp;&amp; !diffResp</c>).</summary>
    public required bool ShowDiffLoading { get; init; }

    /// <summary>Whether the friendly "no changes" empty state is shown (web <c>allRows.length === 0 &amp;&amp; !filterActive</c>).</summary>
    public required bool ShowDiffEmpty { get; init; }

    /// <summary>Whether the diff table (rows) is shown (web fall-through to <c>SignalDiffTable</c>).</summary>
    public required bool ShowDiffRows { get; init; }

    /// <summary>Whether a name/category filter is narrowing the rows (web <c>filterActive</c>).</summary>
    public required bool FilterActive { get; init; }

    /// <summary>Whether the pinned-chips footer renders (web <c>pinnedSignals.size &gt; 0</c>).</summary>
    public required bool ShowPinnedChips { get; init; }

    /// <summary>The number of selected signals (web <c>selectedSignals.length</c>) — drives the bulk toolbar.</summary>
    public required int SelectedCount { get; init; }

    /// <summary>The composed Narrator name for the whole surface (the page title).</summary>
    public required string AutomationName { get; init; }
}

/// <summary>
/// Pure projection from a <see cref="SignalDiffPageModel"/> to its render-ready <see cref="SignalDiffPageDisplay"/> —
/// the native port of the web page's render tree (web/src/features/telemetry/pages/SignalDiffPage.tsx). Every one of
/// the 15 i18n keys the manifest (<c>page:telemetry/SignalDiff</c>) requires is resolved here on every call so the
/// parity coverage is asserted by a single headless projection. The diff rows are filtered by the active category
/// then handed to the shared <see cref="SignalDiffProjection"/> (name filter + pinned-first sort), keeping this page
/// and the unified workspace in lockstep. No WinUI types.
/// </summary>
public static class SignalDiffPageProjection
{
    /// <summary>Project the model into its render-ready display, resolving every label through <paramref name="localizer"/>.</summary>
    public static SignalDiffPageDisplay Project(SignalDiffPageModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // web filteredRows: narrow by the active category first (each category's matches() predicate), then hand the
        // search to the shared diff projection which applies the name filter and the pinned-first sort.
        IReadOnlyList<SignalDiffRow> categoryRows = FilterByCategory(model.DiffRows, model.Category);
        SignalDiffDisplay diffDisplay = SignalDiffProjection.Project(
            categoryRows,
            model.Search,
            model.PinnedSignals,
            localizer);

        int changedCount = model.DiffRows.Count;
        int visibleCount = diffDisplay.Rows.Count;
        bool diffLoading = model.DiffState == SignalsWorkspaceDataState.Loading;
        bool diffError = model.DiffState == SignalsWorkspaceDataState.Error;
        bool filterActive = model.Search.Trim().Length > 0 || model.Category is not null;
        bool hasWindows = model.WindowA is not null && model.WindowB is not null;

        // web body branch order: loading skeleton → "no changes" empty (only when nothing matched and no filter is
        // active and both windows are set) → the diff table. The error banner renders above the body in addition.
        bool showLoading = diffLoading;
        bool showEmpty = !showLoading && !diffError && changedCount == 0 && !filterActive && hasWindows;
        bool showRows = !showLoading && !diffError && !showEmpty;

        string title = localizer.GetString("signalDiff.title", "Signal Diff");

        return new SignalDiffPageDisplay
        {
            Title = title,
            Subtitle = localizer.GetString("signalDiff.subtitle", "Compare signal values between two snapshots in time"),
            ShareLabel = localizer.GetString("signalDiff.share", "Share"),

            VehicleLabel = localizer.GetString("signalDiff.vehicle", "Vehicle"),
            VehicleOptions = model.Vehicles
                .Select(v => new SignalDiffVehicleOption(v.Id.ToString(CultureInfo.InvariantCulture), v.Label))
                .ToArray(),
            SelectedVehicleValue = model.VehicleId > 0
                ? model.VehicleId.ToString(CultureInfo.InvariantCulture)
                : string.Empty,

            ChangedSignalsLabel = localizer.GetString("signalDiff.totalChanged", "Changed signals"),
            ChangedSignalsValue = diffLoading
                ? SignalsWorkspaceProjection.EmDash
                : SignalsWorkspaceProjection.FmtInt(changedCount),
            VisibleLabel = localizer.GetString("signalDiff.visible", "Visible after filter"),
            VisibleValue = diffLoading
                ? SignalsWorkspaceProjection.EmDash
                : SignalsWorkspaceProjection.FmtInt(visibleCount),
            PinnedLabel = localizer.GetString("signalDiff.pinnedCount", "Pinned"),
            PinnedValue = SignalsWorkspaceProjection.FmtInt(model.PinnedSignals.Count),
            WindowSpanLabel = localizer.GetString("signalDiff.windowSpan", "Window span"),
            WindowSpanValue = SignalsWorkspaceProjection.WindowSpan(model.WindowA, model.WindowB),

            BulkPinLabel = localizer.GetString("signalDiff.bulk.pin", "Pin selected"),
            BulkUnpinLabel = localizer.GetString("signalDiff.bulk.unpin", "Unpin selected"),
            BulkCsvLabel = localizer.GetString("signalDiff.bulk.csv", "Copy CSV"),
            BulkAddAlertLabel = localizer.GetString("signalDiff.bulk.addAlert", "Add as alert rule"),

            ErrorMessage = localizer.GetString("signalDiff.error", "Failed to load diff"),
            NoChangesMessage = localizer.GetString("signalDiff.noChanges", "No signals changed between the two snapshots"),
            PinnedChipsLabel = localizer.GetString("signalDiff.pinnedLabel", "Pinned:"),
            PinnedChips = model.PinnedSignals.OrderBy(s => s, StringComparer.CurrentCulture).ToArray(),
            DiffDisplay = diffDisplay,

            ShowError = diffError,
            ShowDiffLoading = showLoading,
            ShowDiffEmpty = showEmpty,
            ShowDiffRows = showRows,
            FilterActive = filterActive,
            ShowPinnedChips = model.PinnedSignals.Count > 0,
            SelectedCount = model.SelectedSignals.Count,

            AutomationName = title,
        };
    }

    /// <summary>
    /// Narrow the diff rows to the active category — the native port of the web <c>filteredRows</c> category branch
    /// (<c>CATEGORY_PREFIXES.find(c => c.id === activeCategory)?.matches(name)</c>). A null/unknown category passes
    /// every row through.
    /// </summary>
    public static IReadOnlyList<SignalDiffRow> FilterByCategory(IReadOnlyList<SignalDiffRow> rows, string? category)
    {
        ArgumentNullException.ThrowIfNull(rows);
        if (string.IsNullOrEmpty(category))
        {
            return rows;
        }

        SignalCategory? cat = SignalCompareControlsCategories.All.FirstOrDefault(c => string.Equals(c.Id, category, StringComparison.Ordinal));
        if (cat is null)
        {
            return rows;
        }

        return rows.Where(r => cat.Matches(r.Name)).ToArray();
    }
}

/// <summary>
/// Canonical registry metadata for the <c>SignalDiffPage</c> surface — the stable navigation route name (so the shell
/// page factory binds <c>/signal-diff</c> to this view), the diagnostics slug, the per-vehicle pin context + item
/// prefix, and the five generated OpenAPI operation ids backing the web hooks it composes (<c>useVehicles</c> /
/// <c>useSignals</c> / <c>useSignalDiffServer</c> / <c>usePinned</c> / <c>useTogglePin</c>). Centralised so the view,
/// view-model and feed stay free of literal identifiers.
/// </summary>
public static class SignalDiffPageRegistration
{
    /// <summary>The navigation route name (matches RouteTable.cs <c>Page("SignalDiff","signal-diff",…)</c>).</summary>
    public const string RouteName = "SignalDiff";

    /// <summary>The diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalDiffPage";

    /// <summary>The fleet-vehicles read (web <c>useVehicles</c> → GET /vehicles).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The available-signals catalog read (web <c>useSignals</c> → GET /signals/{vehicleID}/available).</summary>
    public const string AvailableOperation = "get_api_v1_signals_vehicleID_available";

    /// <summary>The two-snapshot diff read (web <c>useSignalDiffServer</c> → GET /signals/{vehicleID}/diff).</summary>
    public const string DiffOperation = "get_api_v1_signals_vehicleID_diff";

    /// <summary>The pinned-items list read (web <c>usePinned</c> → GET /pinned).</summary>
    public const string PinnedListOperation = "get_api_v1_pinned";

    /// <summary>The pin-create write (web <c>useTogglePin</c> pin → POST /pinned).</summary>
    public const string PinCreateOperation = "post_api_v1_pinned";

    /// <summary>The pin-delete write (web <c>useTogglePin</c> unpin → DELETE /pinned/{id}).</summary>
    public const string PinDeleteOperation = "delete_api_v1_pinned_id";

    /// <summary>The pinned-item type the page pins under (web <c>useTogglePin('widget')</c>).</summary>
    public const string PinType = "widget";

    /// <summary>The pinned-item id prefix the page stores signals under (web <c>signal:{name}</c>).</summary>
    public const string SignalItemPrefix = "signal:";

    /// <summary>The pin context for one vehicle (web <c>signal-diff:vehicle:{vehicleId}</c>).</summary>
    public static string PinContext(long vehicleId) =>
        string.Create(CultureInfo.InvariantCulture, $"signal-diff:vehicle:{vehicleId}");
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalDiffPage</c> surface (P1/S11). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a signal name, value or vehicle id — so a diagnostics line
/// can never leak which vehicle or telemetry value was involved. Thread-safe.
/// </summary>
public sealed class SignalDiffPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalDiffPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened (operational counter).</summary>
    public long ViewsOpened => System.Threading.Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened (the only diagnostic this surface emits).</summary>
    public void RecordViewOpened()
    {
        System.Threading.Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(SignalDiffPageRegistration.Slug + ":view.opened");
    }
}
