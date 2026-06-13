using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SoftwareUpdatesPageViewModel"/> can be in — the
/// native union of the loading / success / empty / error branches the web <c>SoftwareUpdatesPage</c> renders
/// (web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx). Every branch maps onto a visible surface;
/// none is hidden. <see cref="Empty"/> mirrors the web's <c>!updates?.length</c> gate (the shared "No update
/// history" empty state the timeline falls back to) — distinct from a transport failure (<see cref="Error"/>),
/// which additionally raises the failure banner.
/// </summary>
public enum SoftwareUpdatesState
{
    /// <summary>Initial fetch with no cached rows — the timeline shows its skeleton chrome (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A resolved list carrying at least one update — the timeline shows the rows (web success).</summary>
    Loaded,

    /// <summary>No vehicle selected, or no updates — the timeline shows the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed — the failure banner shows and the timeline falls back to its empty state.</summary>
    Error,
}

/// <summary>
/// One firmware-update row from <c>GET /software-updates</c> (web <c>SoftwareUpdate</c>, shape in
/// web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx). Field names mirror the Go API's snake_case
/// JSON tags (<c>vehicle_id</c> / <c>installed_at</c> / <c>scheduled_at</c> / <c>created_at</c>). Parsing is
/// null-tolerant so a partial row never throws; timestamps are kept as their raw wire strings (as the web
/// does) and resolved on demand.
/// </summary>
/// <param name="Id">Stable update id (web <c>id</c>).</param>
/// <param name="VehicleId">Owning vehicle id (web <c>vehicle_id</c>).</param>
/// <param name="Version">Firmware version string (web <c>version</c>), or null.</param>
/// <param name="Status">Lifecycle status: installed / installing / downloading / available / scheduled.</param>
/// <param name="InstalledAtRaw">Install timestamp string (web <c>installed_at</c>), or null.</param>
/// <param name="ScheduledAtRaw">Scheduled timestamp string (web <c>scheduled_at</c>), or null.</param>
/// <param name="CreatedAtRaw">Row creation timestamp string (web <c>created_at</c>), or null.</param>
public sealed record SoftwareUpdateEntry(
    long Id,
    long VehicleId,
    string? Version,
    string? Status,
    string? InstalledAtRaw,
    string? ScheduledAtRaw,
    string? CreatedAtRaw)
{
    /// <summary>The install timestamp parsed to an instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? InstalledAt => TryParse(InstalledAtRaw);

    /// <summary>The scheduled timestamp parsed to an instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? ScheduledAt => TryParse(ScheduledAtRaw);

    /// <summary>The created timestamp parsed to an instant, or null when absent / unparseable.</summary>
    public DateTimeOffset? CreatedAt => TryParse(CreatedAtRaw);

    /// <summary>True when this row's status is the installed status (web <c>status === 'installed'</c>).</summary>
    public bool IsInstalled =>
        string.Equals(Status, SoftwareUpdateStatusPresentation.Installed, StringComparison.OrdinalIgnoreCase);

    /// <summary>Parse a <c>GET /software-updates</c> JSON array into a tolerant list of rows, preserving order.</summary>
    /// <param name="element">The parsed response body.</param>
    /// <returns>The parsed rows (empty for a non-array body).</returns>
    public static IReadOnlyList<SoftwareUpdateEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SoftwareUpdateEntry>();
        }

        var list = new List<SoftwareUpdateEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single software-update JSON object into a tolerant row.</summary>
    /// <param name="obj">The JSON object for one update.</param>
    /// <returns>The parsed row.</returns>
    public static SoftwareUpdateEntry FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id") ?? 0,
        VehicleId: GetLong(obj, "vehicle_id") ?? 0,
        Version: GetString(obj, "version"),
        Status: GetString(obj, "status"),
        InstalledAtRaw: GetString(obj, "installed_at"),
        ScheduledAtRaw: GetString(obj, "scheduled_at"),
        CreatedAtRaw: GetString(obj, "created_at"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static DateTimeOffset? TryParse(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? null
            : DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal, out var parsed)
                ? parsed
                : null;
}

/// <summary>One vehicle identity from <c>GET /vehicles</c> kept only to resolve a timeline row's owner name.</summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>), or empty.</param>
public sealed record SoftwareUpdateVehicle(long Id, string DisplayName)
{
    /// <summary>Resolve the vehicle roster from a <c>GET /vehicles</c> array (web <c>useSelectedVehicle().vehicles</c>).</summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <returns>The roster entries (empty for a non-array body); the first is the selected vehicle.</returns>
    public static IReadOnlyList<SoftwareUpdateVehicle> ParseRoster(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SoftwareUpdateVehicle>();
        }

        var list = new List<SoftwareUpdateVehicle>(root.GetArrayLength());
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = element.TryGetProperty("id", out var idEl) && idEl.TryGetInt64(out var n) ? n : 0;
            string name = element.TryGetProperty("display_name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String
                ? nameEl.GetString() ?? string.Empty
                : string.Empty;
            list.Add(new SoftwareUpdateVehicle(id, name));
        }

        return list;
    }
}

/// <summary>
/// Presentation tokens for a software-update status — the native analogue of one entry in the web
/// <c>STATUS_CONFIG</c> (web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx). Holds the Segoe
/// Fluent glyph approximating the web Lucide icon, the theme-token accent brush key reproducing the web
/// colour, the semantic badge <see cref="StatusKind"/> and the i18n key/default for the badge label. Pure data.
/// </summary>
/// <param name="Glyph">Segoe Fluent / MDL2 glyph (web Lucide icon).</param>
/// <param name="AccentBrushKey">Token brush key for the row icon (web colour class).</param>
/// <param name="Badge">Semantic badge status (web <c>badgeVariant</c>).</param>
/// <param name="LabelKey">The i18n key for the badge label (web <c>t(s.label)</c>).</param>
/// <param name="LabelDefault">The English default for the badge label.</param>
public readonly record struct SoftwareUpdateStatusTokens(
    string Glyph,
    string AccentBrushKey,
    StatusKind Badge,
    string LabelKey,
    string LabelDefault);

/// <summary>
/// Status → presentation lookup — the native port of the web page's <c>STATUS_CONFIG</c> map and its
/// <c>getStatus</c> default (an unknown status resolves to the <c>available</c> tokens). Web colour classes map
/// onto the nearest semantic design token: installed→success (green), installing/downloading→info (cyan),
/// available→warning (amber), scheduled→neutral (muted). Lookup is case-insensitive.
/// </summary>
public static class SoftwareUpdateStatusPresentation
{
    /// <summary>Status value: a fully installed firmware build (web <c>installed</c>).</summary>
    public const string Installed = "installed";

    /// <summary>Status value: the build is being applied (web <c>installing</c>).</summary>
    public const string Installing = "installing";

    /// <summary>Status value: the build is downloading to the vehicle (web <c>downloading</c>).</summary>
    public const string Downloading = "downloading";

    /// <summary>Status value: a build is offered but not yet downloading (web <c>available</c>).</summary>
    public const string Available = "available";

    /// <summary>Status value: an install is scheduled for later (web <c>scheduled</c>).</summary>
    public const string Scheduled = "scheduled";

    // Segoe MDL2 / Fluent glyphs: Completed (check), Download, Upload (upgrade available), Recent (clock).
    private const string CheckGlyph = "\uE930";
    private const string DownloadGlyph = "\uE896";
    private const string UpgradeGlyph = "\uE898";
    private const string ClockGlyph = "\uE823";

    private static readonly SoftwareUpdateStatusTokens AvailableTokens =
        new(UpgradeGlyph, "TsColorWarningBrush", StatusKind.Warning, "Available", "Available");

    private static readonly Dictionary<string, SoftwareUpdateStatusTokens> Map =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [Installed] = new(CheckGlyph, "TsColorSuccessBrush", StatusKind.Success, "Installed", "Installed"),
            [Installing] = new(DownloadGlyph, "TsColorInfoBrush", StatusKind.Info, "Installing", "Installing"),
            [Downloading] = new(DownloadGlyph, "TsColorInfoBrush", StatusKind.Info, "Downloading", "Downloading"),
            [Available] = AvailableTokens,
            [Scheduled] = new(ClockGlyph, "TsColorTextMutedBrush", StatusKind.Neutral, "Scheduled", "Scheduled"),
        };

    /// <summary>Resolve the presentation tokens for <paramref name="status"/> (null / unknown → the available default).</summary>
    /// <param name="status">The raw status string.</param>
    /// <returns>The matching tokens, or the <c>available</c> tokens (web <c>getStatus</c> fallback).</returns>
    public static SoftwareUpdateStatusTokens For(string? status) =>
        status is not null && Map.TryGetValue(status, out var tokens) ? tokens : AvailableTokens;
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of one web <c>&lt;MetricCard&gt;</c>. Holds a
/// stable <see cref="Key"/> (for parity assertions), the localized <see cref="Label"/>, the already-formatted
/// <see cref="Value"/>, the token brush key for the accent rail and a Narrator automation name. Pure data.
/// </summary>
/// <param name="Key">Stable identity (<c>currentVersion</c> / <c>updatesInstalled</c> / <c>totalUpdates</c>).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted display value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="AutomationName">The composed "label: value" Narrator name.</param>
public sealed record SoftwareUpdateMetric(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected, render-ready timeline row — the native analogue of one mapped <c>updates.map(...)</c> entry
/// in web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx. Holds the resolved status presentation
/// (glyph + token brush key + semantic badge + localized label), the version text, the owning vehicle name,
/// the optional install date, the optional "Scheduled: {date}" line, the created date, the public release-notes
/// link with its tooltip, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable update id (the list key).</param>
/// <param name="Version">The firmware version text (em-dash when absent).</param>
/// <param name="Glyph">The status icon glyph.</param>
/// <param name="AccentBrushKey">The status icon token brush key.</param>
/// <param name="StatusLabel">The localized status badge label.</param>
/// <param name="BadgeStatus">The semantic badge status.</param>
/// <param name="VehicleName">The owning vehicle name (web <c>display_name</c> or "Vehicle {id}").</param>
/// <param name="HasInstalledDate">True when an install date is shown.</param>
/// <param name="InstalledDate">The formatted install date (empty when absent).</param>
/// <param name="HasScheduled">True when the "Scheduled: {date}" line is shown.</param>
/// <param name="ScheduledText">The "Scheduled: {date}" line (empty when absent).</param>
/// <param name="CreatedDate">The formatted created date.</param>
/// <param name="ReleaseNotesUri">The public release-notes link.</param>
/// <param name="ReleaseNotesTooltip">The release-notes link tooltip.</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record SoftwareUpdateTimelineRow(
    long Id,
    string Version,
    string Glyph,
    string AccentBrushKey,
    string StatusLabel,
    StatusKind BadgeStatus,
    string VehicleName,
    bool HasInstalledDate,
    string InstalledDate,
    bool HasScheduled,
    string ScheduledText,
    string CreatedDate,
    Uri ReleaseNotesUri,
    string ReleaseNotesTooltip,
    string AutomationName);

/// <summary>
/// The resolved reading cached by the source: the per-vehicle <see cref="Updates"/> list (web
/// <c>useSoftwareUpdates</c>) plus the vehicle <see cref="Vehicles"/> roster (web
/// <c>useSelectedVehicle().vehicles</c>) used to resolve each row's owner name. Serialized to the cache as JSON
/// so the cache-then-network read round-trips losslessly.
/// </summary>
/// <param name="Updates">The update rows, newest first as the API returns them.</param>
/// <param name="Vehicles">The vehicle roster for owner-name resolution.</param>
public sealed record SoftwareUpdatesSnapshot(
    IReadOnlyList<SoftwareUpdateEntry> Updates,
    IReadOnlyList<SoftwareUpdateVehicle> Vehicles)
{
    /// <summary>The "nothing resolved" snapshot — the parse / loading fallback.</summary>
    public static SoftwareUpdatesSnapshot Empty { get; } =
        new(Array.Empty<SoftwareUpdateEntry>(), Array.Empty<SoftwareUpdateVehicle>());

    /// <summary>True when at least one update exists (web <c>updates?.length</c> truthy; gates the empty state).</summary>
    [JsonIgnore]
    public bool HasData => Updates.Count > 0;
}

/// <summary>
/// The fully projected, render-ready view of the page — the native analogue of everything the web component
/// computes before returning JSX. Holds the localized header, the failure-banner text, the three metric tiles,
/// the timeline title, the loading / empty surface flags and the timeline rows. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive lifecycle state.</param>
/// <param name="Title">The localized visible page title (web <c>t('Software Updates')</c>).</param>
/// <param name="Subtitle">The localized subtitle (web <c>t('Track firmware versions and update history')</c>).</param>
/// <param name="AutomationName">The page-level Narrator name (web <c>softwareUpdates.title</c>).</param>
/// <param name="ErrorText">The failure-banner text (shared <c>error.loadFailed</c>).</param>
/// <param name="RetryText">The failure-banner retry-affordance label (shared <c>common.retry</c>).</param>
/// <param name="Metrics">The three metric tiles (current version / updates installed / total updates).</param>
/// <param name="TimelineTitle">The timeline panel title (web <c>t('Update Timeline')</c>).</param>
/// <param name="EmptyTitle">The timeline empty-state title (web <c>t('No update history')</c>).</param>
/// <param name="EmptyMessage">The timeline empty-state message (web <c>t('No software update history available')</c>).</param>
/// <param name="Rows">The projected timeline rows (empty unless <see cref="State"/> is <see cref="SoftwareUpdatesState.Loaded"/>).</param>
public sealed record SoftwareUpdatesDisplay(
    SoftwareUpdatesState State,
    string Title,
    string Subtitle,
    string AutomationName,
    string ErrorText,
    string RetryText,
    IReadOnlyList<SoftwareUpdateMetric> Metrics,
    string TimelineTitle,
    string EmptyTitle,
    string EmptyMessage,
    IReadOnlyList<SoftwareUpdateTimelineRow> Rows)
{
    /// <summary>True when the failure banner should be shown (web <c>anyError</c>).</summary>
    [JsonIgnore]
    public bool ShowError => State == SoftwareUpdatesState.Error;

    /// <summary>True when the timeline skeleton should be shown (web <c>isLoading</c>).</summary>
    [JsonIgnore]
    public bool ShowLoading => State == SoftwareUpdatesState.Loading;

    /// <summary>True when the timeline rows should be shown (web <c>updates.length</c> &gt; 0).</summary>
    [JsonIgnore]
    public bool ShowRows => State == SoftwareUpdatesState.Loaded && Rows.Count > 0;

    /// <summary>True when the timeline empty state should be shown (web <c>!updates?.length</c>, incl. on error).</summary>
    [JsonIgnore]
    public bool ShowEmpty => !ShowLoading && !ShowRows;
}

/// <summary>
/// Pure projection from a raw <see cref="SoftwareUpdatesSnapshot"/> to the <see cref="SoftwareUpdatesDisplay"/>
/// — the native port of everything the web component renders. The current version, installed count and total
/// derive from the list exactly as the web's inline expressions do; every label resolves through the i18n
/// facade with the same web key names. <c>now</c> is injected so the date formatting is unit-tested
/// deterministically.
/// </summary>
public static class SoftwareUpdatesProjection
{
    /// <summary>Accent rail brush for the current-version tile (web <c>color="cyan"</c>).</summary>
    public const string CyanAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Accent rail brush for the updates-installed tile (web <c>color="green"</c>).</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent rail brush for the total-updates tile (web <c>color="purple"</c>).</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    /// <summary>The em dash rendered for an absent version string (web renders the raw value).</summary>
    public const string EmDash = "\u2014";

    private const string ReleaseNotesBase = "https://www.notateslaapp.com/software-updates/version/";
    private const string ReleaseNotesSuffix = "/release-notes";

    /// <summary>Project <paramref name="snapshot"/> in <paramref name="state"/> using the localizer for every label.</summary>
    /// <param name="snapshot">The resolved reading.</param>
    /// <param name="state">The lifecycle state to render.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant the relative dates are computed against.</param>
    /// <returns>The render-ready display model.</returns>
    public static SoftwareUpdatesDisplay Project(
        SoftwareUpdatesSnapshot snapshot,
        SoftwareUpdatesState state,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("Software Updates", "Software Updates");
        string subtitle = localizer.GetString("Track firmware versions and update history", "Track firmware versions and update history");
        string documentTitle = localizer.GetString("softwareUpdates.title", "Software Updates");
        string unknown = localizer.GetString("Unknown", "Unknown");

        var updates = snapshot.Updates;
        string latestVersion = updates.Count > 0 && !string.IsNullOrEmpty(updates[0].Version)
            ? updates[0].Version!
            : unknown;
        int installedCount = 0;
        foreach (var update in updates)
        {
            if (update.IsInstalled)
            {
                installedCount++;
            }
        }

        string currentVersionLabel = localizer.GetString("Current Version", "Current Version");
        string updatesInstalledLabel = localizer.GetString("Updates Installed", "Updates Installed");
        string totalUpdatesLabel = localizer.GetString("Total Updates", "Total Updates");

        string installedValue = installedCount.ToString(CultureInfo.InvariantCulture);
        string totalValue = updates.Count.ToString(CultureInfo.InvariantCulture);

        var metrics = new List<SoftwareUpdateMetric>(3)
        {
            new("currentVersion", currentVersionLabel, latestVersion, CyanAccentBrushKey, MetricAutomationName(currentVersionLabel, latestVersion)),
            new("updatesInstalled", updatesInstalledLabel, installedValue, GreenAccentBrushKey, MetricAutomationName(updatesInstalledLabel, installedValue)),
            new("totalUpdates", totalUpdatesLabel, totalValue, PurpleAccentBrushKey, MetricAutomationName(totalUpdatesLabel, totalValue)),
        };

        IReadOnlyList<SoftwareUpdateTimelineRow> rows = state == SoftwareUpdatesState.Loaded
            ? BuildRows(snapshot, localizer, now)
            : Array.Empty<SoftwareUpdateTimelineRow>();

        return new SoftwareUpdatesDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: documentTitle,
            ErrorText: localizer.GetString("error.loadFailed", "Failed to load data"),
            RetryText: localizer.GetString("common.retry", "Retry"),
            Metrics: metrics,
            TimelineTitle: localizer.GetString("Update Timeline", "Update Timeline"),
            EmptyTitle: localizer.GetString("No update history", "No update history"),
            EmptyMessage: localizer.GetString("No software update history available", "No software update history available"),
            Rows: rows);
    }

    private static List<SoftwareUpdateTimelineRow> BuildRows(
        SoftwareUpdatesSnapshot snapshot,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        string vehicleLabel = localizer.GetString("Vehicle", "Vehicle");
        string scheduledLabel = localizer.GetString("Scheduled", "Scheduled");
        string releaseNotesTooltip = localizer.GetString("View release notes", "View release notes");

        var names = new Dictionary<long, string>(snapshot.Vehicles.Count);
        foreach (var vehicle in snapshot.Vehicles)
        {
            names[vehicle.Id] = vehicle.DisplayName;
        }

        var rows = new List<SoftwareUpdateTimelineRow>(snapshot.Updates.Count);
        foreach (var update in snapshot.Updates)
        {
            var tokens = SoftwareUpdateStatusPresentation.For(update.Status);
            string statusLabel = localizer.GetString(tokens.LabelKey, tokens.LabelDefault);
            string version = string.IsNullOrEmpty(update.Version) ? EmDash : update.Version!;

            string vehicleName = names.TryGetValue(update.VehicleId, out var name) && !string.IsNullOrWhiteSpace(name)
                ? name
                : string.Create(CultureInfo.CurrentCulture, $"{vehicleLabel} {update.VehicleId}");

            bool hasInstalled = update.InstalledAt is not null;
            string installedDate = hasInstalled
                ? DateTimeFormatting.Format(update.InstalledAt, DateTimeVariant.Date, now)
                : string.Empty;

            bool hasScheduled = update.ScheduledAt is not null && update.InstalledAt is null;
            string scheduledText = hasScheduled
                ? string.Create(CultureInfo.CurrentCulture, $"{scheduledLabel}: {DateTimeFormatting.Format(update.ScheduledAt, DateTimeVariant.Date, now)}")
                : string.Empty;

            string createdDate = DateTimeFormatting.Format(update.CreatedAt, DateTimeVariant.Date, now);

            rows.Add(new SoftwareUpdateTimelineRow(
                Id: update.Id,
                Version: version,
                Glyph: tokens.Glyph,
                AccentBrushKey: tokens.AccentBrushKey,
                StatusLabel: statusLabel,
                BadgeStatus: tokens.Badge,
                VehicleName: vehicleName,
                HasInstalledDate: hasInstalled,
                InstalledDate: installedDate,
                HasScheduled: hasScheduled,
                ScheduledText: scheduledText,
                CreatedDate: createdDate,
                ReleaseNotesUri: BuildReleaseNotesUri(update.Version),
                ReleaseNotesTooltip: releaseNotesTooltip,
                AutomationName: string.Create(CultureInfo.CurrentCulture, $"{version}, {statusLabel}, {vehicleName}")));
        }

        return rows;
    }

    /// <summary>Build the public release-notes link (web <c>notateslaapp.com/.../{version}/release-notes</c>).</summary>
    /// <param name="version">The firmware version (URL-encoded into the path; null becomes empty).</param>
    /// <returns>The absolute release-notes URI.</returns>
    public static Uri BuildReleaseNotesUri(string? version)
    {
        string encoded = Uri.EscapeDataString(version ?? string.Empty);
        return new Uri($"{ReleaseNotesBase}{encoded}{ReleaseNotesSuffix}", UriKind.Absolute);
    }

    private static string MetricAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
}

/// <summary>
/// Canonical registry metadata for the Software Updates surface — the native mirror of the web route entry
/// (route <c>/software-updates</c>, nav name <c>SoftwareUpdates</c>). The shell page factory binds this surface
/// under the same route name; the route already exists in the navigation <c>RouteTable</c>.
/// </summary>
public static class SoftwareUpdatesRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("SoftwareUpdates", …)).</summary>
    public const string RouteName = "SoftwareUpdates";

    /// <summary>The primary web route path the page mirrors.</summary>
    public const string Route = "software-updates";

    /// <summary>The hidden deep-link alias route (web <c>/vehicle-systems/software</c>).</summary>
    public const string AliasRoute = "vehicle-systems/software";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SoftwareUpdatesPage";

    /// <summary>The page size the list read requests (web <c>pageSize = 50</c>).</summary>
    public const int PageSize = 50;

    /// <summary>The shared cache key prefix for the assembled software-updates snapshot (per vehicle).</summary>
    public const string CacheKeyPrefix = "vehicle-systems:software-updates";

    /// <summary>The localized document/window title (web <c>softwareUpdates.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("softwareUpdates.title", "Software Updates");
    }
}

/// <summary>
/// PII-safe diagnostics for the Software Updates surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a firmware version, VIN or vehicle name —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SoftwareUpdatesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public SoftwareUpdatesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SoftwareUpdatesPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SoftwareUpdatesRegistration.Slug}");
    }
}
