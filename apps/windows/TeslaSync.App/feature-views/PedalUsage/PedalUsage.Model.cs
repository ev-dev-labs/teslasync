using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <c>PedalUsage</c> surface can be in — the native superset of the
/// branches the web component renders
/// (web/src/features/driving/components/driving-dynamics/PedalUsage.tsx). The web component is a pure child that
/// reads one live snapshot via <c>useDriveDynamicsLatest(vehicleId)</c> and shows either its three-up pedal gauge
/// row (when any pedal signal is present) or a single empty state. The native surface binds its own
/// cache-then-network read of that snapshot, so it owns the full loading / ready / empty / error / stale /
/// offline matrix the P2 state contract requires. Every value maps onto a visible surface — none is hidden
/// behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum PedalUsageState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying at least one pedal signal — render the three-up gauge row.</summary>
    Ready,

    /// <summary>The snapshot resolved but carried no pedal telemetry (web <c>!hasAny</c>) — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a pedal gauge renders its value arc with — the native mirror of the literal hue the web
/// source passes each <c>RadialGauge</c> (<c>#06b6d4</c> cyan for throttle, <c>#ef4444</c> red for brake). Kept
/// WinUI-free so the projection can assign and the tests can assert the per-gauge colour without a UI host; the
/// view maps each accent to a themed chart brush (whose token colour is the same hex) at render time.
/// </summary>
public enum PedalGaugeAccent
{
    /// <summary>Cyan (web <c>#06b6d4</c>) — the throttle gauge; maps to the themed <c>TsChartRegenBrush</c>.</summary>
    Cyan,

    /// <summary>Red (web <c>#ef4444</c>) — the brake gauge; maps to the themed <c>TsChartTemperatureBrush</c>.</summary>
    Red,
}

/// <summary>
/// The canonical pedal-telemetry inputs the web <c>PedalUsage</c> consumes — the native mirror of the three
/// <c>DriveDynamicsSnapshot</c> fields the web source actually reads (web/src/api/types.ts):
/// <c>pedal_position</c>, <c>brake_pedal_position</c> and <c>brake_pedal_active</c>. Throttle and brake are pedal
/// positions in percent (0..100); brake-active is a boolean. Each is <see langword="null"/> when the signal is
/// absent, exactly as the web narrows <c>typeof … === 'number' / 'boolean' ? … : null</c>. Pure data — no WinUI
/// types — so the parse and the projection are unit-tested without a UI host.
/// </summary>
/// <param name="ThrottlePercent">Throttle pedal position 0..100 (%), or null (web <c>pedal_position</c>).</param>
/// <param name="BrakePercent">Brake pedal position 0..100 (%), or null (web <c>brake_pedal_position</c>).</param>
/// <param name="BrakeActive">Whether the brake pedal is depressed, or null (web <c>brake_pedal_active</c>).</param>
public sealed record PedalReading(
    double? ThrottlePercent,
    double? BrakePercent,
    bool? BrakeActive)
{
    /// <summary>The no-telemetry reading — the parse fallback for an absent / non-object body (web <c>data == null</c>).</summary>
    public static PedalReading Empty { get; } = new(null, null, null);

    /// <summary>
    /// True when any pedal signal is present — the native port of the web
    /// <c>hasAny = throttle != null || brakePos != null || brakeActive != null</c>. The surface shows the gauge
    /// row when this is true and the empty state otherwise.
    /// </summary>
    public bool HasData => ThrottlePercent is not null || BrakePercent is not null || BrakeActive is not null;

    /// <summary>
    /// Project a <c>GET /drive-dynamics/latest</c> JSON object into the pedal inputs — the native port of the
    /// field narrowing the web source performs on the snapshot. A non-object body yields <see cref="Empty"/>;
    /// each field is read null-tolerantly (a missing / wrong-kind field becomes null) so a partial snapshot never
    /// throws. Throttle / brake accept a numeric or numeric-string value (NaN / Infinity rejected); brake-active
    /// accepts only a JSON boolean (web <c>typeof … === 'boolean'</c>).
    /// </summary>
    /// <param name="element">The parsed drive-dynamics snapshot body.</param>
    /// <returns>The pedal inputs, or <see cref="Empty"/> when there is no telemetry.</returns>
    public static PedalReading FromSnapshotJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new PedalReading(
            PedalReadingJson.GetDouble(element, "pedal_position"),
            PedalReadingJson.GetDouble(element, "brake_pedal_position"),
            PedalReadingJson.GetBool(element, "brake_pedal_active"));
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the pedal snapshot — the numeric getter tolerates a
/// numeric or numeric-string field and rejects NaN / Infinity, and the boolean getter accepts only a true JSON
/// boolean, so a partial or schema-drifted snapshot never aborts the parse (web parity: the source narrows each
/// field by <c>typeof</c> and falls back to null). WinUI-free.
/// </summary>
internal static class PedalReadingJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) && !double.IsNaN(s) && !double.IsInfinity(s) => s,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or null when absent or not a JSON boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready pedal gauge — the native analogue of one web <c>&lt;RadialGauge&gt;</c> plus its
/// caption. Holds the gauge's own label (web <c>RadialGauge label</c>), the caption shown beneath it (web
/// <c>&lt;span&gt;</c>), the clamped value and its full-sweep maximum (so the arc sweep matches the web), the
/// literal unit suffix (web <c>'%'</c> when present, an em dash otherwise), the decimal precision (web
/// <c>Number.isInteger(clamped) ? 0 : precision</c>), the categorical accent (so the arc colour matches the web
/// hue) and a Narrator name. Pure data.
/// </summary>
/// <param name="GaugeLabel">Label shown inside the gauge (web <c>RadialGauge label</c>, e.g. "Throttle").</param>
/// <param name="CaptionText">Caption shown beneath the gauge (web caption, e.g. "Throttle Position").</param>
/// <param name="Value">The clamped value the gauge displays (web <c>value</c>, clamped to [0, max]).</param>
/// <param name="Max">The value mapped to a full sweep (web <c>max={100}</c>).</param>
/// <param name="Unit">The literal unit suffix (web <c>'%'</c> or the em dash when the value is absent).</param>
/// <param name="Decimals">Fraction digits for the rendered value.</param>
/// <param name="Accent">The categorical value-arc accent (web <c>RadialGauge color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the gauge tile.</param>
public sealed record PedalGaugeDisplayItem(
    string GaugeLabel,
    string CaptionText,
    double Value,
    double Max,
    string Unit,
    int Decimals,
    PedalGaugeAccent Accent,
    string AutomationName);

/// <summary>
/// The projected, render-ready brake-pedal status tile — the native analogue of the web Footprints-icon + status
/// <c>&lt;Badge&gt;</c> + caption column. <see cref="BadgeText"/> is the localized active / inactive copy,
/// <see cref="BadgeStatus"/> the semantic colour (web <c>variant: brakeActive ? 'danger' : 'success'</c>) and
/// <see cref="CaptionText"/> the caption beneath. Pure data.
/// </summary>
/// <param name="BadgeText">Localized brake status (web "Brake Active" / "Brake Inactive").</param>
/// <param name="BadgeStatus">Semantic badge colour: danger when active, success otherwise.</param>
/// <param name="CaptionText">Caption beneath the badge (web "Brake Pedal Status").</param>
/// <param name="AutomationName">The composed Narrator name for the status tile.</param>
public sealed record PedalBrakeStatusContent(
    string BadgeText,
    StatusKind BadgeStatus,
    string CaptionText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready content of the <c>PedalUsage</c> surface — the native analogue of everything
/// the web component composes before returning its panel. Holds the localized panel <see cref="Title"/>, the data
/// flag (web <c>hasAny</c>), the throttle and brake gauges, the brake-status tile, the empty-state message and the
/// surface's accessible name. The per-state chrome (loading / error / stale / offline) is layered by the
/// view-model + view; this record carries the data-bearing content. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Title">The localized panel title (web "Pedal Usage").</param>
/// <param name="HasData">True when any pedal signal is present (web <c>hasAny</c>).</param>
/// <param name="Throttle">The projected throttle gauge.</param>
/// <param name="Brake">The projected brake gauge.</param>
/// <param name="BrakeStatus">The projected brake-status tile.</param>
/// <param name="EmptyMessage">The empty-state message (web "No pedal telemetry received yet").</param>
/// <param name="AutomationName">The composed Narrator name for the populated surface.</param>
public sealed record PedalUsageContent(
    string Title,
    bool HasData,
    PedalGaugeDisplayItem Throttle,
    PedalGaugeDisplayItem Brake,
    PedalBrakeStatusContent BrakeStatus,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="PedalReading"/> to its render-ready <see cref="PedalUsageContent"/> — the
/// native port of the render logic in web/src/features/driving/components/driving-dynamics/PedalUsage.tsx. The
/// gauges reproduce the web call sites one-for-one: each value is clamped to [0, 100] exactly as the web
/// RadialGauge, the unit is <c>'%'</c> when the signal is present and an em dash otherwise (web
/// <c>unit={x != null ? '%' : '—'}</c>), the precision is the web integer-or-global-precision rule, and the brake
/// status maps <c>brakeActive ? danger/'Brake Active' : success/'Brake Inactive'</c>. Every translatable label
/// resolves through the i18n facade using the same keys the web source passes to <c>t()</c>. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class PedalUsageProjection
{
    /// <summary>The full-sweep maximum for both pedal gauges (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    /// <summary>The unit suffix shown when a pedal value is present (web <c>'%'</c>).</summary>
    public const string PercentUnit = "%";

    /// <summary>The unit suffix shown when a pedal value is absent (web em dash <c>'—'</c>).</summary>
    public const string UnknownUnit = "\u2014";

    /// <summary>The global display precision the web RadialGauge uses for a non-integer value (web <c>getGlobalPrecision()</c>).</summary>
    public const int DisplayPrecision = 2;

    /// <summary>Project <paramref name="reading"/> into the render-ready content using the i18n facade.</summary>
    /// <param name="reading">The pedal-telemetry inputs.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The display-ready content (gauges, brake status, copy and accessible name).</returns>
    public static PedalUsageContent Project(PedalReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("dynamics.pedalUsage", "Pedal Usage");
        string emptyMessage = localizer.GetString("dynamics.pedalNoData", "No pedal telemetry received yet");

        PedalGaugeDisplayItem throttle = BuildGauge(
            localizer.GetString("dynamics.throttle", "Throttle"),
            localizer.GetString("dynamics.throttlePosition", "Throttle Position"),
            reading.ThrottlePercent,
            PedalGaugeAccent.Cyan);

        PedalGaugeDisplayItem brake = BuildGauge(
            localizer.GetString("dynamics.brake", "Brake"),
            localizer.GetString("dynamics.brakePedalPosition", "Brake Pedal Position"),
            reading.BrakePercent,
            PedalGaugeAccent.Red);

        PedalBrakeStatusContent brakeStatus = BuildBrakeStatus(reading.BrakeActive, localizer);

        string automationName = string.Join(
            ". ", title, throttle.AutomationName, brake.AutomationName, brakeStatus.AutomationName);

        return new PedalUsageContent(
            Title: title,
            HasData: reading.HasData,
            Throttle: throttle,
            Brake: brake,
            BrakeStatus: brakeStatus,
            EmptyMessage: emptyMessage,
            AutomationName: automationName);
    }

    /// <summary>
    /// Maps the brake-active flag to its semantic badge colour — the native port of the web
    /// <c>variant: brakeActive ? 'danger' : 'success'</c>. A null (unknown) flag is treated as not-active, exactly
    /// as the web falsy check renders the success "Brake Inactive" badge.
    /// </summary>
    /// <param name="brakeActive">The brake-active flag, or null when unknown.</param>
    /// <returns><see cref="StatusKind.Danger"/> when active, otherwise <see cref="StatusKind.Success"/>.</returns>
    public static StatusKind BrakeStatusFor(bool? brakeActive) =>
        brakeActive == true ? StatusKind.Danger : StatusKind.Success;

    private static PedalGaugeDisplayItem BuildGauge(
        string gaugeLabel,
        string captionText,
        double? percent,
        PedalGaugeAccent accent)
    {
        // web RadialGauge: value={x ?? 0}, clamped internally to [0, max]; unit '%' when present else em dash.
        double value = Math.Clamp(percent ?? 0, 0, GaugeMax);
        string unit = percent is not null ? PercentUnit : UnknownUnit;
        int decimals = DecimalsFor(value);
        string valueText = ScalarFormatters.FormatNumber(value, decimals);

        string automationName = string.Format(
            CultureInfo.CurrentCulture, "{0}, {1}{2}, {3}", gaugeLabel, valueText, unit, captionText);

        return new PedalGaugeDisplayItem(
            gaugeLabel, captionText, value, GaugeMax, unit, decimals, accent, automationName);
    }

    private static PedalBrakeStatusContent BuildBrakeStatus(bool? brakeActive, ILocalizer localizer)
    {
        bool active = brakeActive == true;
        string badgeText = active
            ? localizer.GetString("dynamics.brakeActive", "Brake Active")
            : localizer.GetString("dynamics.brakeInactive", "Brake Inactive");
        string caption = localizer.GetString("dynamics.brakePedal", "Brake Pedal Status");
        StatusKind status = BrakeStatusFor(brakeActive);

        string automationName = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", badgeText, caption);

        return new PedalBrakeStatusContent(badgeText, status, caption, automationName);
    }

    // web RadialGauge: d = Number.isInteger(clamped) ? 0 : getGlobalPrecision(). The web passes no explicit
    // decimals, so an integer value shows none and a fractional one shows the global precision.
    private static int DecimalsFor(double clamped) =>
        clamped == Math.Floor(clamped) ? 0 : DisplayPrecision;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto projected
/// <c>RepositoryResult&lt;PedalReading&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class PedalUsageResultMapper
{
    /// <summary>Project <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The same emission with its snapshot body parsed into a <see cref="PedalReading"/>.</returns>
    public static RepositoryResult<PedalReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        PedalReading Parse() => raw.HasValue ? PedalReading.FromSnapshotJson(raw.Value) : PedalReading.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<PedalReading>.Loading(),
            LoadStatus.Cached => RepositoryResult<PedalReading>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<PedalReading>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<PedalReading>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<PedalReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<PedalReading>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<PedalReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
