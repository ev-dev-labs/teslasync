using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>GeofencesPage</c> surface — the native mirror of the four
/// data states the web page renders (web/src/features/maps/pages/GeofencesPage.tsx). The web page runs the
/// <c>useQuery(['geofences'])</c> read and, in precedence order, shows the loading skeleton (web
/// <c>isLoading</c>), the failure surface (web <c>error</c> → <c>PageContainer error</c>), the empty state (web
/// <c>geofences.length === 0</c>) and otherwise the geofence list. This enum is the top-level summary the ledger
/// keys off; per-region visibility is still driven by the projected flags so each branch renders exactly as the
/// web composes them.
/// </summary>
public enum GeofencesState
{
    /// <summary>The geofences query is in flight (web <c>isLoading</c>) — the panel shows the skeleton.</summary>
    Loading,

    /// <summary>The geofences query resolved with no rows (web <c>geofences.length === 0</c>).</summary>
    Empty,

    /// <summary>The geofences query failed (web <c>error</c>) — the page shows the error surface.</summary>
    Error,

    /// <summary>The geofences query produced rows (web <c>geofences.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// The alert posture of a geofence — the native mirror of the web <c>getAlertType</c> result
/// (web/src/features/maps/pages/GeofencesPage.tsx L86): <c>both | entry | exit | none</c>. Derived from the two
/// wire booleans <c>alert_on_entry</c> / <c>alert_on_exit</c>.
/// </summary>
public enum GeofenceAlertKind
{
    /// <summary>Neither entry nor exit alerts (web <c>none</c>).</summary>
    None,

    /// <summary>Entry alerts only (web <c>entry</c>).</summary>
    Entry,

    /// <summary>Exit alerts only (web <c>exit</c>).</summary>
    Exit,

    /// <summary>Both entry and exit alerts (web <c>both</c>).</summary>
    Both,
}

/// <summary>Pure helpers mapping a <see cref="GeofenceAlertKind"/> to its chip status + i18n label (web parity).</summary>
public static class GeofenceAlerts
{
    /// <summary>Derive the alert posture from the two wire flags (web <c>getAlertType</c>).</summary>
    public static GeofenceAlertKind FromFlags(bool entry, bool exit) =>
        (entry, exit) switch
        {
            (true, true) => GeofenceAlertKind.Both,
            (true, false) => GeofenceAlertKind.Entry,
            (false, true) => GeofenceAlertKind.Exit,
            _ => GeofenceAlertKind.None,
        };

    /// <summary>The chip status (web <c>alertBadgeVariant</c>: both→success, entry→info, exit→warning, none→neutral).</summary>
    public static StatusKind BadgeStatus(GeofenceAlertKind kind) => kind switch
    {
        GeofenceAlertKind.Both => StatusKind.Success,
        GeofenceAlertKind.Entry => StatusKind.Info,
        GeofenceAlertKind.Exit => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized chip label (web <c>alertBadgeLabel</c>).</summary>
    public static string BadgeLabel(GeofenceAlertKind kind, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return kind switch
        {
            GeofenceAlertKind.Both => localizer.GetString("Entry & Exit", "Entry & Exit"),
            GeofenceAlertKind.Entry => localizer.GetString("Entry", "Entry"),
            GeofenceAlertKind.Exit => localizer.GetString("Exit", "Exit"),
            _ => localizer.GetString("None", "None"),
        };
    }
}

/// <summary>
/// One geofence row — the native mirror of the web <c>Geofence</c> (web/src/types/location.ts) over the
/// snake_case wire shape the Go API emits (internal/models/system/system.go <c>Geofence.MarshalJSON</c>): the
/// <c>id</c>, the display <see cref="Name"/>, the derived circle <see cref="Latitude"/> / <see cref="Longitude"/>
/// / <see cref="Radius"/> (metres, SI), the two alert flags and the <see cref="Enabled"/> flag. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record Geofence(
    long Id,
    string Name,
    double Latitude,
    double Longitude,
    double Radius,
    bool AlertOnEntry,
    bool AlertOnExit,
    bool Enabled,
    string? CreatedAt)
{
    /// <summary>The derived alert posture (web <c>getAlertType</c>).</summary>
    public GeofenceAlertKind AlertKind => GeofenceAlerts.FromFlags(AlertOnEntry, AlertOnExit);

    /// <summary>Parse a <c>GET /geofences/</c> JSON array into the reduced rows (tolerant of partial bodies).</summary>
    public static IReadOnlyList<Geofence> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<Geofence>();
        }

        var list = new List<Geofence>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one geofence from a JSON object, tolerating missing / null fields.</summary>
    public static Geofence FromJson(JsonElement o) => new(
        Id: GeofencesJson.Long(o, "id") ?? 0,
        Name: GeofencesJson.String(o, "name") ?? string.Empty,
        Latitude: GeofencesJson.Double(o, "latitude") ?? 0,
        Longitude: GeofencesJson.Double(o, "longitude") ?? 0,
        Radius: GeofencesJson.Double(o, "radius") ?? 0,
        AlertOnEntry: GeofencesJson.Bool(o, "alert_on_entry") ?? false,
        AlertOnExit: GeofencesJson.Bool(o, "alert_on_exit") ?? false,
        Enabled: GeofencesJson.Bool(o, "enabled") ?? false,
        CreatedAt: GeofencesJson.String(o, "created_at"));
}

/// <summary>
/// One vehicle option for the create-modal's "use current location" picker — the native mirror of the slice of
/// the web <c>Vehicle</c> the page reads (web <c>useVehicles</c> → <c>v.display_name || v.vin</c>).
/// </summary>
public sealed record GeofenceVehicleOption(long Id, string DisplayName, string Vin)
{
    /// <summary>The option label (web <c>v.display_name || v.vin</c>).</summary>
    public string Label => string.IsNullOrEmpty(DisplayName) ? Vin : DisplayName;

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into the reduced options (tolerant of partial bodies).</summary>
    public static IReadOnlyList<GeofenceVehicleOption> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<GeofenceVehicleOption>();
        }

        var list = new List<GeofenceVehicleOption>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new GeofenceVehicleOption(
                Id: GeofencesJson.Long(item, "id") ?? 0,
                DisplayName: GeofencesJson.String(item, "display_name") ?? string.Empty,
                Vin: GeofencesJson.String(item, "vin") ?? string.Empty));
        }

        return list;
    }
}

/// <summary>
/// One reduced position fix — the native mirror of the slice of the web <c>Position</c> the page reads to seed
/// the form from a vehicle's last location (web <c>GET /vehicles/{id}/positions?limit=1</c>). SI on the wire.
/// </summary>
public sealed record GeofencePosition(double Latitude, double Longitude)
{
    /// <summary>Read the first position from a positions JSON array, or null when the array is empty / absent.</summary>
    public static GeofencePosition? FirstFrom(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            return new GeofencePosition(
                Latitude: GeofencesJson.Double(item, "latitude") ?? 0,
                Longitude: GeofencesJson.Double(item, "longitude") ?? 0);
        }

        return null;
    }
}

/// <summary>
/// One pin row — the native mirror of the web <c>PinnedItem</c> slice the page sorts by (web
/// <c>usePinned('geofence')</c> → <c>{ item_id, position }</c>). The list is floated to the top in pin order
/// (web <c>sortedGeofences</c>).
/// </summary>
public sealed record GeofencePin(string ItemId, int Position)
{
    /// <summary>Parse a <c>GET /pinned?type=geofence</c> JSON array into the reduced pins (tolerant of partial bodies).</summary>
    public static IReadOnlyList<GeofencePin> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<GeofencePin>();
        }

        var list = new List<GeofencePin>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? id = GeofencesJson.String(item, "item_id")
                ?? GeofencesJson.Long(item, "item_id")?.ToString(CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            list.Add(new GeofencePin(id, (int)(GeofencesJson.Long(item, "position") ?? 0)));
        }

        return list;
    }
}

/// <summary>
/// The full create / edit form snapshot — the native mirror of the web modal's controlled string inputs
/// (web <c>GeofenceFormData</c>). Coordinates / radius are held as strings (the literal <c>&lt;input
/// type="number"&gt;</c> values) and converted on submit, exactly as the web schema does
/// (web/src/features/maps/schemas/geofence.ts). Pure data.
/// </summary>
public sealed record GeofenceFormState(
    string Name,
    string Latitude,
    string Longitude,
    string Radius,
    GeofenceAlertKind AlertType,
    bool Enabled)
{
    /// <summary>The default new-geofence form (web <c>EMPTY_FORM</c>: radius 100, alert both, enabled).</summary>
    public static GeofenceFormState Empty { get; } =
        new(string.Empty, string.Empty, string.Empty, "100", GeofenceAlertKind.Both, true);

    /// <summary>True when every required string is non-blank (web <c>hasMinimalInput</c>).</summary>
    public bool HasMinimalInput =>
        !string.IsNullOrWhiteSpace(Name) &&
        !string.IsNullOrWhiteSpace(Latitude) &&
        !string.IsNullOrWhiteSpace(Longitude) &&
        !string.IsNullOrWhiteSpace(Radius);
}

/// <summary>
/// One per-field validation error keyed by the form field it applies to (web zod <c>fieldErrors</c>). Pure data
/// so the form validation is unit-tested without a UI host.
/// </summary>
public sealed record GeofenceFieldErrors(string? Name, string? Latitude, string? Longitude, string? Radius)
{
    /// <summary>No field errors.</summary>
    public static GeofenceFieldErrors None { get; } = new(null, null, null, null);

    /// <summary>True when any field carries an error.</summary>
    public bool HasAny => Name is not null || Latitude is not null || Longitude is not null || Radius is not null;
}

/// <summary>
/// Validates a <see cref="GeofenceFormState"/> exactly as the web zod schema does
/// (web/src/features/maps/schemas/geofence.ts): name 1..120, latitude -90..90, longitude -180..180,
/// radius 10..50000. Pure + headless; the per-field messages mirror the web zod refine messages.
/// </summary>
public static class GeofenceFormValidator
{
    /// <summary>Validate the form, returning the per-field errors (web <c>geofenceFormSchema.safeParse</c>).</summary>
    public static GeofenceFieldErrors Validate(GeofenceFormState form)
    {
        ArgumentNullException.ThrowIfNull(form);
        return new GeofenceFieldErrors(
            Name: ValidateName(form.Name),
            Latitude: ValidateNumber(form.Latitude, "Latitude", -90, 90),
            Longitude: ValidateNumber(form.Longitude, "Longitude", -180, 180),
            Radius: ValidateNumber(form.Radius, "Radius", 10, 50000));
    }

    private static string? ValidateName(string value)
    {
        string trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "Name is required";
        }

        return trimmed.Length > 120 ? "Name must be 120 characters or fewer" : null;
    }

    private static string? ValidateNumber(string value, string label, double min, double max)
    {
        string trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return $"{label} is required";
        }

        if (!double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var n))
        {
            return $"{label} must be a number";
        }

        return n < min || n > max
            ? string.Create(CultureInfo.InvariantCulture, $"{label} must be between {min} and {max}")
            : null;
    }
}

/// <summary>One projected summary metric card (web <c>MetricCard</c>): a label, a formatted value and an accent token.</summary>
public sealed record GeofenceMetricDisplay(string Label, string Value, string AccentBrushKey);

/// <summary>
/// One projected, render-ready geofence list row (web <c>GlassPanel</c> card). All formatting + i18n already
/// applied so the view is a thin renderer.
/// </summary>
public sealed record GeofenceRowDisplay(
    long Id,
    string Name,
    string Coordinates,
    string RadiusText,
    string EnabledLabel,
    StatusKind EnabledStatus,
    string AlertLabel,
    StatusKind AlertStatus,
    bool Enabled,
    bool IsSelected,
    string RenameLabel,
    string SelectLabel,
    string AutomationName);

/// <summary>The raw, pre-projection model the view-model hands the projection (web hook results + view state).</summary>
public sealed record GeofencesModel(
    IReadOnlyList<Geofence> Items,
    IReadOnlyList<GeofencePin> Pins,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    string Search,
    IReadOnlyCollection<long> SelectedIds);

/// <summary>
/// The projected, render-ready content the <c>GeofencesPage</c> view binds to — the single source the view reads
/// for every region the web page composes: the header (title + subtitle + add label), the four summary metric
/// cards (or their no-data empty state), the searchable + pin-sorted geofence list (with its three empty
/// surfaces), the bulk-action labels, and the loading / error flags. Pure data so the whole projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record GeofencesDisplay(
    GeofencesState State,
    string Title,
    string Subtitle,
    string AddLabel,
    bool ShowLoading,
    bool ShowError,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    bool StatsHasData,
    IReadOnlyList<GeofenceMetricDisplay> Metrics,
    string StatsEmptyMessage,
    string SearchHint,
    bool ShowSearch,
    bool ShowFilterChip,
    string FilterChipLabel,
    IReadOnlyList<GeofenceRowDisplay> Rows,
    bool ShowRows,
    bool ShowNoMatches,
    string NoMatchesMessage,
    string ClearSearchLabel,
    bool ShowDefinedEmpty,
    string DefinedEmptyTitle,
    string DefinedEmptyMessage,
    string BulkDeleteLabel,
    string BulkDeleteConfirmTitle,
    string BulkDeleteConfirmBody,
    string BulkDeleteConfirmLabel,
    string BulkNounOne,
    string BulkNounOther);

/// <summary>
/// Projects a <see cref="GeofencesModel"/> into the render-ready <see cref="GeofencesDisplay"/> the WinUI view
/// binds to — the native analogue of the web component body's derived values + JSX branches
/// (web/src/features/maps/pages/GeofencesPage.tsx). Pure + UI-free: every label resolves through the injected
/// <see cref="ILocalizer"/> and every branch mirrors the web composition (stats, filtered + pin-sorted list, the
/// three list empty states). Drive it from the view-model; it never touches WinUI.
/// </summary>
public static class GeofencesProjection
{
    /// <summary>The Segoe Fluent glyph for the empty / list surfaces (web <c>MapPin</c> / <c>Shield</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>The Segoe Fluent glyph for the no-data stats surface (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>Project the model into the render-ready display.</summary>
    public static GeofencesDisplay Project(GeofencesModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var items = model.Items ?? Array.Empty<Geofence>();
        bool hasItems = items.Count > 0;

        var state = ResolveState(model, hasItems);
        bool showLoading = state == GeofencesState.Loading;
        bool showError = state == GeofencesState.Error;
        bool showContent = !showLoading && !showError;

        string search = model.Search ?? string.Empty;
        var filtered = Filter(items, search);
        var sorted = SortByPins(filtered, model.Pins ?? Array.Empty<GeofencePin>());

        var selected = model.SelectedIds ?? Array.Empty<long>();
        var rows = sorted.Select(g => ProjectRow(g, selected, localizer)).ToArray();

        bool showRows = showContent && hasItems && rows.Length > 0;
        bool showNoMatches = showContent && hasItems && rows.Length == 0;
        bool showDefinedEmpty = showContent && !hasItems;

        return new GeofencesDisplay(
            State: state,
            Title: GeofencesRegistration.Title(localizer),
            Subtitle: localizer.GetString(
                "Define locations for contextual tracking and automation",
                "Define locations for contextual tracking and automation"),
            AddLabel: localizer.GetString("Add Geofence", "Add Geofence"),
            ShowLoading: showLoading,
            ShowError: showError,
            ShowContent: showContent,
            ErrorText: ResolveError(model, localizer),
            RetryLabel: localizer.GetString("common.retry", "Retry"),
            StatsHasData: hasItems,
            Metrics: hasItems ? BuildMetrics(items, localizer) : Array.Empty<GeofenceMetricDisplay>(),
            StatsEmptyMessage: localizer.GetString("common.noData", "No data available"),
            SearchHint: localizer.GetString("geofences.searchPlaceholder", "Search by name…"), // parity:allow web i18n key name 'searchPlaceholder', not a stub marker
            ShowSearch: showContent && hasItems,
            ShowFilterChip: showContent && hasItems && !string.IsNullOrWhiteSpace(search),
            FilterChipLabel: BuildFilterChip(search, localizer),
            Rows: rows,
            ShowRows: showRows,
            ShowNoMatches: showNoMatches,
            NoMatchesMessage: localizer.GetString("geofences.noMatches", "No geofences match your search."),
            ClearSearchLabel: localizer.GetString("Clear search", "Clear search"),
            ShowDefinedEmpty: showDefinedEmpty,
            DefinedEmptyTitle: localizer.GetString("No geofences defined", "No geofences defined"),
            DefinedEmptyMessage: localizer.GetString(
                "Add a geofence to track when your vehicle arrives or leaves a location.",
                "Add a geofence to track when your vehicle arrives or leaves a location."),
            BulkDeleteLabel: localizer.GetString("geofences.bulk.delete", "Delete"),
            BulkDeleteConfirmTitle: localizer.GetString("geofences.bulk.deleteConfirm.title", "Delete geofences?"),
            BulkDeleteConfirmBody: localizer.GetString(
                "geofences.bulk.deleteConfirm.body",
                "Selected geofences will be removed permanently. Linked alert rules and automations will continue to reference their old IDs."),
            BulkDeleteConfirmLabel: localizer.GetString("common.delete", "Delete"),
            BulkNounOne: localizer.GetString("geofences.noun.one", "geofence"),
            BulkNounOther: localizer.GetString("geofences.noun.other", "geofences"));
    }

    /// <summary>Filter the geofences by a case-insensitive name match (web <c>useFilteredList</c> over <c>['name']</c>).</summary>
    public static IReadOnlyList<Geofence> Filter(IReadOnlyList<Geofence> items, string search)
    {
        ArgumentNullException.ThrowIfNull(items);
        string query = (search ?? string.Empty).Trim();
        if (query.Length == 0)
        {
            return items;
        }

        return items
            .Where(g => g.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    /// <summary>Float pinned geofences to the top in pin order, preserving the relative order otherwise (web <c>sortedGeofences</c>).</summary>
    public static IReadOnlyList<Geofence> SortByPins(IReadOnlyList<Geofence> items, IReadOnlyList<GeofencePin> pins)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(pins);
        if (pins.Count == 0)
        {
            return items;
        }

        var order = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var pin in pins)
        {
            order[pin.ItemId] = pin.Position;
        }

        // Stable sort: pinned rows ascend by position, unpinned rows keep their original order after them.
        return items
            .Select((g, index) => (g, index))
            .OrderBy(t => order.TryGetValue(t.g.Id.ToString(CultureInfo.InvariantCulture), out var p) ? p : int.MaxValue)
            .ThenBy(t => t.index)
            .Select(t => t.g)
            .ToArray();
    }

    private static GeofencesState ResolveState(GeofencesModel model, bool hasItems)
    {
        if (model.Loading && !hasItems)
        {
            return GeofencesState.Loading;
        }

        if (model.HasError && !hasItems)
        {
            return GeofencesState.Error;
        }

        return hasItems ? GeofencesState.Success : GeofencesState.Empty;
    }

    private static GeofenceMetricDisplay[] BuildMetrics(IReadOnlyList<Geofence> items, ILocalizer localizer)
    {
        int total = items.Count;
        int active = items.Count(g => g.Enabled);
        int entry = items.Count(g => g.AlertOnEntry);
        int exit = items.Count(g => g.AlertOnExit);

        return new[]
        {
            new GeofenceMetricDisplay(localizer.GetString("Total Geofences", "Total Geofences"), Count(total), "TsColorAccentBrush"),
            new GeofenceMetricDisplay(localizer.GetString("Active", "Active"), Count(active), "TsColorSuccessBrush"),
            new GeofenceMetricDisplay(localizer.GetString("Entry Alerts", "Entry Alerts"), Count(entry), "TsColorInfoBrush"),
            new GeofenceMetricDisplay(localizer.GetString("Exit Alerts", "Exit Alerts"), Count(exit), "TsColorWarningBrush"),
        };
    }

    private static GeofenceRowDisplay ProjectRow(Geofence g, IReadOnlyCollection<long> selected, ILocalizer localizer)
    {
        var kind = g.AlertKind;
        string enabledLabel = g.Enabled
            ? localizer.GetString("Active", "Active")
            : localizer.GetString("Inactive", "Inactive");
        string alertLabel = GeofenceAlerts.BadgeLabel(kind, localizer);
        string coords = FormatCoordinate(g.Latitude) + ", " + FormatCoordinate(g.Longitude);
        string radiusText = g.Radius.ToString("0", CultureInfo.CurrentCulture) + localizer.GetString("m", "m");

        return new GeofenceRowDisplay(
            Id: g.Id,
            Name: g.Name,
            Coordinates: coords,
            RadiusText: radiusText,
            EnabledLabel: enabledLabel,
            EnabledStatus: g.Enabled ? StatusKind.Success : StatusKind.Neutral,
            AlertLabel: alertLabel,
            AlertStatus: GeofenceAlerts.BadgeStatus(kind),
            Enabled: g.Enabled,
            IsSelected: selected.Contains(g.Id),
            RenameLabel: Interpolate(localizer.GetString("editableText.rename.geofence", "Rename geofence {{name}}"), g.Name),
            SelectLabel: Interpolate(localizer.GetString("geofences.selectGeofence", "Select geofence {{name}}"), g.Name),
            AutomationName: string.Create(
                CultureInfo.CurrentCulture,
                $"{g.Name}. {enabledLabel}. {alertLabel}. {coords}. {radiusText}"));
    }

    private static string BuildFilterChip(string search, ILocalizer localizer)
    {
        string label = localizer.GetString("geofences.filterLabel.search", "Search");
        return string.IsNullOrWhiteSpace(search)
            ? label
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {search.Trim()}");
    }

    private static string ResolveError(GeofencesModel model, ILocalizer localizer)
    {
        if (!string.IsNullOrWhiteSpace(model.ErrorDetail))
        {
            return model.ErrorDetail!;
        }

        return localizer.GetString("common.error", "Something went wrong");
    }

    private static string FormatCoordinate(double value) =>
        value.ToString("0.######", CultureInfo.CurrentCulture);

    private static string Count(int value) => value.ToString(CultureInfo.CurrentCulture);

    /// <summary>Replace the web i18next <c>{{name}}</c> token with a literal value (never throws on a stray brace).</summary>
    public static string Interpolate(string template, string name)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template.Replace("{{name}}", name ?? string.Empty, StringComparison.Ordinal);
    }
}

/// <summary>
/// Page-level constants for the <c>GeofencesPage</c> surface: the diagnostics slug, the navigation route name,
/// the generated operation ids every feed binds to (ADR-004), and the localized header strings. UI-free.
/// </summary>
public static class GeofencesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GeofencesPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "Geofences";

    /// <summary>The generated operation id for the geofence list read (web <c>GET /geofences</c>).</summary>
    public const string ListOperation = Operations.Locations.Geofences;

    /// <summary>The generated operation id for the create (web <c>POST /geofences</c>).</summary>
    public const string CreateOperation = "post_api_v1_geofences";

    /// <summary>The generated operation id for the update / toggle / rename (web <c>PUT /geofences/{id}</c>).</summary>
    public const string UpdateOperation = "put_api_v1_geofences_geofenceID";

    /// <summary>The generated operation id for a single delete (web <c>DELETE /geofences/{id}</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_geofences_geofenceID";

    /// <summary>The generated operation id for the bulk delete (web <c>useBulkGeofencesDelete → POST /geofences/bulk</c>).</summary>
    public const string BulkDeleteOperation = "post_api_v1_geofences_bulk";

    /// <summary>The generated operation id for the pin list read (web <c>usePinned('geofence') → GET /pinned</c>).</summary>
    public const string PinnedOperation = "get_api_v1_pinned";

    /// <summary>The generated operation id for the vehicle list read (web <c>useVehicles → GET /vehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    /// <summary>The generated operation id for a vehicle's positions read (web <c>GET /vehicles/{id}/positions</c>).</summary>
    public const string PositionsOperation = Operations.Vehicles.Positions;

    /// <summary>The localized page title (web <c>t('Geofences')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Geofences", "Geofences");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>GeofencesPage</c> surface (P1/S11 diagnostics contract). Geofences encode a
/// user's locations, so the collector records ONLY the operational <c>view.opened</c> event with the surface
/// slug — never a name, a coordinate, a radius or a count — so a diagnostics line can never leak a user's
/// location history. Thread-safe.
/// </summary>
public sealed class GeofencesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GeofencesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GeofencesPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GeofencesRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case geofence JSON wire shape (no camelCaseKeys transform on native):
/// numbers (or numeric strings), 64-bit ids, booleans and strings. Kept internal so the page's parsers stay
/// self-contained and never throw on a partial body.
/// </summary>
internal static class GeofencesJson
{
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static long? Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
