using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="GForcePanelViewModel"/> can be in — the native union
/// of the branches the web Acceleration-G-Force panel renders
/// (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx). The web component is a thin reader of
/// the <c>useDriveDynamicsLatest</c> snapshot that toggles between the three-up stat grid and a friendly empty
/// state; the native surface binds its own cache-then-network read of <c>/drive-dynamics/latest</c>, so it owns
/// the full loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. Every
/// value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and
/// <see cref="Offline"/> render the three G-force tiles (with the stale / offline chip for the latter two),
/// <see cref="Empty"/> renders the friendly empty state (web parity: no lateral/longitudinal value yet),
/// <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the retry surface.
/// </summary>
public enum GForcePanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying at least one acceleration axis.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no acceleration value yet.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the tiles plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the tiles plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The parsed <c>/drive-dynamics/latest</c> projection reduced to just the two acceleration axes the web
/// G-force panel reads — the native mirror of the web <c>DriveDynamicsSnapshot</c> subset
/// (<c>lateral_acceleration</c>, <c>longitudinal_acceleration</c>). Field names mirror the Go API's snake_case
/// JSON tags. Parsing is null-tolerant and — exactly like the web's <c>typeof … === 'number'</c> guard — only
/// accepts JSON numbers (a numeric <em>string</em> is treated as absent), so a partial or text-typed payload
/// never produces a misleading reading. WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
public sealed record GForcePanelSnapshot(double? LateralAcceleration, double? LongitudinalAcceleration)
{
    /// <summary>The empty snapshot (no axis reported) — the loading / empty fallback.</summary>
    public static readonly GForcePanelSnapshot Empty = new(null, null);

    /// <summary>True when at least one acceleration axis is present (web <c>hasAny</c>).</summary>
    public bool HasAny => LateralAcceleration is not null || LongitudinalAcceleration is not null;

    /// <summary>Project a single <c>/drive-dynamics/latest</c> JSON object into a tolerant snapshot.</summary>
    public static GForcePanelSnapshot FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new GForcePanelSnapshot(
            GetNumber(obj, "lateral_acceleration"),
            GetNumber(obj, "longitudinal_acceleration"));
    }

    // Web parity: `typeof data?.field === 'number'`. Only a JSON number qualifies; strings / nulls are absent.
    private static double? GetNumber(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number)
        {
            return null;
        }

        return v.TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
    }
}

/// <summary>
/// One projected, render-ready G-force tile — the native mirror of a single web <c>StatCard</c>
/// (icon + label + the formatted value and its <c>g</c> unit). <see cref="Value"/> is the web
/// <c>fmtNumber(_, 2)</c> output or the em-dash fallback; <see cref="Unit"/> is the literal physical symbol
/// <c>g</c> (never localized, matching the web's <c>unit="g"</c>). Pure data so the projection is asserted
/// without a UI host.
/// </summary>
public sealed record GForceMetric(string Label, string Value, string Unit, string AutomationName)
{
    /// <summary>The value and its unit on one line (web baseline-aligned value + unit span, e.g. "0.45 g").</summary>
    public string ValueWithUnit => string.Create(CultureInfo.CurrentCulture, $"{Value} {Unit}");
}

/// <summary>
/// The fully projected, render-ready view of the Acceleration-G-Force surface — the localized title, the three
/// G-force tiles (lateral / longitudinal / combined), the empty-state message and the accessible summary.
/// <see cref="HasData"/> drives the content-vs-empty branch (web parity: the panel shows the grid only when at
/// least one acceleration axis has reported). Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record GForcePanelDisplay(
    bool HasData,
    string Title,
    IReadOnlyList<GForceMetric> Metrics,
    string EmptyMessage,
    string AriaLabel,
    string AutomationName)
{
    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static GForcePanelDisplay Empty(ILocalizer localizer) =>
        GForcePanelProjection.Project(GForcePanelSnapshot.Empty, localizer);
}

/// <summary>
/// Pure projection from a parsed <see cref="GForcePanelSnapshot"/> to a <see cref="GForcePanelDisplay"/> — the
/// native port of the render logic in GForcePanel.tsx. It mirrors the web's per-axis null handling
/// (<c>value != null ? fmtNumber(value, 2) : '—'</c>), the combined-magnitude derivation
/// (<c>sqrt(lateral² + longitudinal²)</c>, only when <em>both</em> axes are present) and the <c>hasAny</c>
/// content-vs-empty gate. Every label resolves through the i18n facade. WinUI-free — unit-tested without a UI
/// host.
/// </summary>
public static class GForcePanelProjection
{
    /// <summary>Fixed display precision (web <c>fmtNumber(value, 2)</c>).</summary>
    public const int Decimals = 2;

    /// <summary>The acceleration unit the tiles carry (web <c>unit="g"</c>, applied verbatim, never localized).</summary>
    public const string Unit = "g";

    /// <summary>The em-dash shown for an absent axis (web <c>'—'</c> fallback).</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// The combined acceleration magnitude — the native port of
    /// <c>sqrt(lateral² + longitudinal²)</c>. Returns <c>null</c> unless <em>both</em> axes are present (web
    /// parity: the combined tile shows the em-dash when either axis is missing) or the result is non-finite.
    /// </summary>
    public static double? Magnitude(double? lateral, double? longitudinal)
    {
        if (lateral is not { } lat || longitudinal is not { } lon)
        {
            return null;
        }

        double magnitude = Math.Sqrt((lat * lat) + (lon * lon));
        return double.IsFinite(magnitude) ? magnitude : null;
    }

    /// <summary>Project <paramref name="snapshot"/> using <paramref name="localizer"/> for every label.</summary>
    /// <param name="snapshot">The latest drive-dynamics snapshot (null is treated as no reading).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static GForcePanelDisplay Project(GForcePanelSnapshot? snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("dynamics.gForce", "Acceleration G-Force");
        string empty = localizer.GetString("dynamics.gForceNoData", "No G-force telemetry received yet");
        string aria = localizer.GetString(
            "dynamics.gForceAria",
            "Acceleration G-force — lateral, longitudinal and combined acceleration in g");

        double? lateral = snapshot?.LateralAcceleration;
        double? longitudinal = snapshot?.LongitudinalAcceleration;
        bool hasAny = lateral is not null || longitudinal is not null;

        if (!hasAny)
        {
            return new GForcePanelDisplay(
                HasData: false,
                Title: title,
                Metrics: Array.Empty<GForceMetric>(),
                EmptyMessage: empty,
                AriaLabel: aria,
                AutomationName: aria);
        }

        var metrics = new[]
        {
            BuildMetric(localizer.GetString("dynamics.lateral", "Lateral"), lateral),
            BuildMetric(localizer.GetString("dynamics.longitudinal", "Longitudinal"), longitudinal),
            BuildMetric(localizer.GetString("dynamics.combined", "Combined"), Magnitude(lateral, longitudinal)),
        };

        return new GForcePanelDisplay(
            HasData: true,
            Title: title,
            Metrics: metrics,
            EmptyMessage: empty,
            AriaLabel: aria,
            AutomationName: aria);
    }

    /// <summary>Format an axis value to the web display contract — <c>fmtNumber(v, 2)</c> or the em-dash.</summary>
    public static string Format(double? value) =>
        value is { } v ? NumberFormatting.Format(v, null, Decimals) : EmDash;

    private static GForceMetric BuildMetric(string label, double? value)
    {
        string text = Format(value);
        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, text, Unit);
        return new GForceMetric(label, text, Unit, automationName);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;GForcePanelSnapshot&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class GForcePanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<GForcePanelSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        GForcePanelSnapshot Parse() =>
            raw.HasValue ? GForcePanelSnapshot.FromJson(raw.Value) : GForcePanelSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<GForcePanelSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<GForcePanelSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<GForcePanelSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<GForcePanelSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<GForcePanelSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<GForcePanelSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<GForcePanelSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Acceleration-G-Force feature surface — the native mirror of the web component at
/// web/src/features/driving/components/driving-dynamics/GForcePanel.tsx. The surface reads the same
/// <c>/drive-dynamics/latest</c> projection the web panel consumes through <c>useDriveDynamicsLatest</c>.
/// </summary>
public static class GForcePanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "g-force-panel";

    /// <summary>Surface category.</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GForcePanel";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.gForce", "Acceleration G-Force");
    }
}

/// <summary>
/// PII-safe diagnostics for the Acceleration-G-Force surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id or an acceleration value —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class GForcePanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GForcePanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GForcePanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GForcePanelRegistration.Slug}");
    }
}
