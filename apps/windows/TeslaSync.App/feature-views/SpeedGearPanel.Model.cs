using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SpeedGearPanelViewModel"/> can be in — the native
/// union of the branches the web Speed &amp; Gear panel renders
/// (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx). The web component is a pure child
/// of the Driving-Dynamics page (it takes a pre-computed <c>motorLatest</c> plus <c>filteredDrives</c>); the
/// native surface binds its own cache-then-network reads (the live motor reading + the drive list it reduces to
/// the average / top speed) and so owns the full loading / loaded / empty / error / stale / offline matrix the
/// P2 state contract requires. Every value maps onto a visible surface (never a blank panel):
/// <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the four tiles (with the stale /
/// offline chip for the latter two), <see cref="Empty"/> renders the friendly empty state (no live motor object
/// and no drive carrying a speed), <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the
/// retry surface.
/// </summary>
public enum SpeedGearPanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with a live motor object and/or at least one drive carrying a speed.</summary>
    Loaded,

    /// <summary>The snapshot resolved but there is no motor object and no drive speed — render the empty state.</summary>
    Empty,

    /// <summary>The motor request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the tiles plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the tiles plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The motor fields the surface reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MotorSnapshot</c> slice the web <c>SpeedGearPanel</c> consumes (<c>shift_state</c>, <c>power_kw</c>).
/// Both fields are nullable so a missing key projects to the em dash exactly like the web <c>?? '—'</c> /
/// <c>!= null</c> guards; <c>power_kw</c> is already on the wire in kilowatts (rendered verbatim, no unit
/// conversion — web parity). A <see langword="null"/> parse result models the web <c>motorLatest</c> being
/// null/undefined (no live motor object). WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
/// <param name="ShiftState">Gear / shift state string, or null (web <c>shift_state</c>).</param>
/// <param name="PowerKw">Drive power in kilowatts, or null (web <c>power_kw</c>).</param>
public sealed record SpeedGearMotorReading(string? ShiftState, double? PowerKw)
{
    /// <summary>
    /// Project a <c>GET /motor/latest</c> response into the motor slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>motorLatest</c> being
    /// null/undefined. An object with both fields missing still parses (all-null) so the panel renders with em
    /// dashes for shift / power, matching the web.
    /// </summary>
    public static SpeedGearMotorReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SpeedGearMotorReading(
            ShiftState: ReadString(root, "shift_state"),
            PowerKw: ReadDouble(root, "power_kw"));
    }

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        double? parsed = v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String => double.TryParse(
                v.GetString(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out var s)
                ? s
                : null,
            _ => null,
        };

        return parsed is { } value && !double.IsNaN(value) && !double.IsInfinity(value) ? value : null;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The drive-level speed aggregates the surface reduces from <c>GET /drives?vehicle_id={id}</c> — the native
/// mirror of the web memos <c>avgDriveSpeedMps</c> / <c>topDriveSpeedMps</c>. The web reduces over
/// <c>filteredDrives</c>: the average is <c>sum(avgSpeedMps ?? 0) / length</c> and the top is
/// <c>max(maxSpeedMps ?? 0)</c>, both in SI metres-per-second, both <c>null</c> only when there are zero drives.
/// <see cref="DriveCount"/> is the web <c>filteredDrives.length</c> (every drive object counts, even one whose
/// speeds are null — it contributes 0). Held in SI; the m/s → display conversion happens once at the render
/// boundary. WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
/// <param name="AvgSpeedMps">Mean of the drives' SI average speeds, or null when there are no drives.</param>
/// <param name="TopSpeedMps">Max of the drives' SI peak speeds, or null when there are no drives.</param>
/// <param name="DriveCount">The number of drives reduced (web <c>filteredDrives.length</c>).</param>
public sealed record SpeedGearDriveStats(double? AvgSpeedMps, double? TopSpeedMps, int DriveCount)
{
    /// <summary>The no-drives aggregate (both speeds null) — the web "no drives" fallback.</summary>
    public static SpeedGearDriveStats Empty { get; } = new(null, null, 0);

    /// <summary>True when at least one drive was reduced (web <c>filteredDrives.length &gt; 0</c>).</summary>
    public bool HasData => DriveCount > 0;

    /// <summary>
    /// Reduce a <c>GET /drives</c> JSON array into the speed aggregates — the native port of the web memos.
    /// A non-array (or empty array) body yields <see cref="Empty"/>; otherwise every object element counts
    /// toward <see cref="DriveCount"/> (web <c>filteredDrives.length</c>), the average is the mean of
    /// <c>avg_speed_mps ?? 0</c> and the top is the max of <c>max_speed_mps ?? 0</c>.
    /// </summary>
    public static SpeedGearDriveStats FromDrives(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        double sum = 0;
        double top = 0;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            sum += ReadDouble(item, "avg_speed_mps") ?? 0;
            top = Math.Max(top, ReadDouble(item, "max_speed_mps") ?? 0);
        }

        if (count == 0)
        {
            return Empty;
        }

        return new SpeedGearDriveStats(sum / count, top, count);
    }

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        double? parsed = v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String => double.TryParse(
                v.GetString(),
                NumberStyles.Float | NumberStyles.AllowThousands,
                CultureInfo.InvariantCulture,
                out var s)
                ? s
                : null,
            _ => null,
        };

        return parsed is { } value && !double.IsNaN(value) && !double.IsInfinity(value) ? value : null;
    }
}

/// <summary>
/// The merged snapshot the surface renders — the live motor reading (or null) plus the drive speed aggregate.
/// It is the native equivalent of the web component's two props (<c>motorLatest</c> + <c>filteredDrives</c>)
/// resolved into one immutable value. <see cref="HasData"/> drives the content-vs-empty branch: the panel has
/// something to show when a motor object exists OR at least one drive carries a speed (web parity — the web
/// always renders the four tiles whenever it has either prop, with the em dash filling the gaps). Pure data.
/// </summary>
/// <param name="Motor">The live motor reading, or null when <c>/motor/latest</c> carried no object.</param>
/// <param name="Drives">The drive speed aggregate (never null; <see cref="SpeedGearDriveStats.Empty"/> when none).</param>
public sealed record SpeedGearSnapshot(SpeedGearMotorReading? Motor, SpeedGearDriveStats Drives)
{
    /// <summary>True when there is a motor object or at least one drive — drives the loaded-vs-empty branch.</summary>
    public bool HasData => Motor is not null || Drives.HasData;
}

/// <summary>
/// Resolves a shift-state string to its theme-aware design-token brush key and badge status — the native
/// mirror of the web <c>shiftColor</c> / <c>shiftBadgeVariant</c> maps. UI-free so the mapping is unit-tested
/// without a XAML runtime.
/// </summary>
public static class SpeedGearPanelTokens
{
    /// <summary>
    /// The token brush key tinting the big shift letter (web <c>shiftColor</c>): D → success (emerald),
    /// R → danger (red), N → warning (yellow), P → muted, anything else (or null) → secondary.
    /// </summary>
    public static string ShiftBrushKey(string? shift) => Normalize(shift) switch
    {
        "D" => "TsColorSuccessBrush",        // web text-emerald-400
        "R" => "TsColorDangerBrush",         // web text-red-400
        "N" => "TsColorWarningBrush",        // web text-yellow-400
        "P" => "TsColorTextMutedBrush",      // web text-[var(--text-muted)]
        _ => "TsColorTextSecondaryBrush",    // web text-[var(--text-secondary)]
    };

    /// <summary>
    /// The badge status for the shift chip (web <c>shiftBadgeVariant</c>): D → success, R → danger,
    /// N → warning, everything else (P / null / unknown) → neutral.
    /// </summary>
    public static StatusKind ShiftStatus(string? shift) => Normalize(shift) switch
    {
        "D" => StatusKind.Success,
        "R" => StatusKind.Danger,
        "N" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    private static string Normalize(string? shift) =>
        string.IsNullOrWhiteSpace(shift) ? string.Empty : shift.Trim().ToUpperInvariant();
}

/// <summary>
/// The render-ready shift tile — the big gear letter (or em dash), its token brush key, and the badge beneath
/// it (web <c>&lt;Badge variant size="sm"&gt;Shift State&lt;/Badge&gt;</c>). Pure data so the projection is
/// asserted without a UI host.
/// </summary>
/// <param name="Letter">The shift letter (D / R / N / P / …) or the em dash when unknown.</param>
/// <param name="BrushKey">The token brush key tinting the letter (web <c>shiftColor</c>).</param>
/// <param name="BadgeStatus">The badge status (web <c>shiftBadgeVariant</c>).</param>
/// <param name="BadgeLabel">The localized badge label ("Shift State").</param>
/// <param name="AutomationName">The Narrator name combining the badge label and the shift letter.</param>
public sealed record SpeedGearShiftTile(
    string Letter,
    string BrushKey,
    StatusKind BadgeStatus,
    string BadgeLabel,
    string AutomationName);

/// <summary>
/// One render-ready stat tile — the localized label, the pre-formatted value (already unit-converted and
/// em-dash-guarded), the unit suffix and the Narrator name. The native mirror of a web stat column (Motor Power
/// / Avg Drive Speed / Top Drive Speed). Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="ValueText">The pre-formatted value (e.g. "12.50", "31", or the em dash).</param>
/// <param name="Unit">The unit suffix (e.g. "kW", "mph", "km/h").</param>
/// <param name="AutomationName">The Narrator name combining the label, value and unit.</param>
public sealed record SpeedGearMetric(string Label, string ValueText, string Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Speed &amp; Gear surface — the localized title, the shift
/// tile, the three stat tiles (Motor Power / Avg Drive Speed / Top Drive Speed), the empty-state message and
/// the accessible summary. <see cref="HasData"/> drives the content-vs-empty branch. Pure data so every branch
/// is asserted without a UI host.
/// </summary>
public sealed record SpeedGearPanelDisplay(
    bool HasData,
    string Title,
    SpeedGearShiftTile Shift,
    IReadOnlyList<SpeedGearMetric> Metrics,
    string EmptyMessage,
    string AriaLabel,
    string AutomationName)
{
    /// <summary>An all-em-dash display (the friendly empty state) for the loading / empty fallback.</summary>
    public static SpeedGearPanelDisplay Empty(ILocalizer localizer, UnitPref units) =>
        SpeedGearPanelProjection.Project(new SpeedGearSnapshot(null, SpeedGearDriveStats.Empty), units, localizer);
}

/// <summary>
/// Pure projection from a merged <see cref="SpeedGearSnapshot"/> to a <see cref="SpeedGearPanelDisplay"/> — the
/// native port of the render logic in SpeedGearPanel.tsx. It formats the shift letter + its colour / badge
/// (web <c>shiftColor</c> / <c>shiftBadgeVariant</c>), the motor power (<c>fmtNumber(power_kw)</c> + the literal
/// "kW" unit — no conversion, web parity), and the average / top drive speeds (converted m/s → the user's
/// display unit once at the boundary via <see cref="UnitConverters.SpeedFromSi"/>, then <c>fmtNumber(_, 0)</c>).
/// Every label resolves through the i18n facade. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class SpeedGearPanelProjection
{
    /// <summary>The em dash shown for any missing value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Motor power fixed display precision (web <c>fmtNumber</c> global default precision is 2).</summary>
    public const int PowerDecimals = 2;

    /// <summary>Speed fixed display precision (web <c>fmtNumber(_, 0)</c>).</summary>
    public const int SpeedDecimals = 0;

    /// <summary>The power unit suffix the web renders verbatim (<c>kW</c>, no conversion).</summary>
    public const string PowerUnit = "kW";

    /// <summary>Project <paramref name="snapshot"/> in the user's <paramref name="units"/> using the localizer.</summary>
    /// <param name="snapshot">The merged motor + drive-speed snapshot.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); the speed display unit is read from it.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static SpeedGearPanelDisplay Project(
        SpeedGearSnapshot snapshot,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("dynamics.speedGear", "Speed & Gear");
        string shiftLabel = localizer.GetString("dynamics.shiftState", "Shift State");
        string powerLabel = localizer.GetString("dynamics.power", "Motor Power");
        string avgLabel = localizer.GetString("dynamics.avgDriveSpeed", "Avg Drive Speed");
        string topLabel = localizer.GetString("dynamics.topDriveSpeed", "Top Drive Speed");
        string empty = localizer.GetString(
            "dynamics.speedGear.empty", "No speed or gear telemetry yet.");
        string aria = localizer.GetString(
            "dynamics.speedGear.aria", "Speed and gear — live shift state, motor power and drive speeds");

        var shift = BuildShiftTile(snapshot.Motor?.ShiftState, shiftLabel, localizer);

        string speedUnit = UnitLabels.Label(units.Speed);
        string powerValue = snapshot.Motor?.PowerKw is { } power
            ? NumberFormatting.Format(power, units.Locale, PowerDecimals)
            : EmDash;
        string avgValue = snapshot.Drives.AvgSpeedMps is { } avg
            ? NumberFormatting.Format(UnitConverters.SpeedFromSi(avg, units.Speed), units.Locale, SpeedDecimals)
            : EmDash;
        string topValue = snapshot.Drives.TopSpeedMps is { } topSpeed
            ? NumberFormatting.Format(UnitConverters.SpeedFromSi(topSpeed, units.Speed), units.Locale, SpeedDecimals)
            : EmDash;

        var metrics = new[]
        {
            new SpeedGearMetric(powerLabel, powerValue, PowerUnit, Combine(powerLabel, powerValue, PowerUnit)),
            new SpeedGearMetric(avgLabel, avgValue, speedUnit, Combine(avgLabel, avgValue, speedUnit)),
            new SpeedGearMetric(topLabel, topValue, speedUnit, Combine(topLabel, topValue, speedUnit)),
        };

        return new SpeedGearPanelDisplay(
            HasData: snapshot.HasData,
            Title: title,
            Shift: shift,
            Metrics: metrics,
            EmptyMessage: empty,
            AriaLabel: aria,
            AutomationName: aria);
    }

    private static SpeedGearShiftTile BuildShiftTile(string? shiftState, string shiftLabel, ILocalizer localizer)
    {
        string letter = string.IsNullOrWhiteSpace(shiftState) ? EmDash : shiftState.Trim();
        return new SpeedGearShiftTile(
            Letter: letter,
            BrushKey: SpeedGearPanelTokens.ShiftBrushKey(shiftState),
            BadgeStatus: SpeedGearPanelTokens.ShiftStatus(shiftState),
            BadgeLabel: shiftLabel,
            AutomationName: Combine(shiftLabel, letter));
    }

    private static string Combine(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string Combine(string label, string value, string unit) =>
        value == EmDash
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> motor emissions onto parsed
/// <c>RepositoryResult&lt;SpeedGearSnapshot&gt;</c>, folding in the already-resolved drive speed aggregate and
/// preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render the
/// full state matrix. A motor body that carries no object becomes a snapshot with a null motor (the drive
/// speeds still render); the view-model classifies the surface empty only when neither prop has data. Pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SpeedGearPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s motor payload (when present), folding in <paramref name="drives"/>.</summary>
    public static RepositoryResult<SpeedGearSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        SpeedGearDriveStats drives)
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(drives);

        SpeedGearSnapshot Snapshot() => new(SpeedGearMotorReading.FromResponse(raw.Value), drives);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SpeedGearSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<SpeedGearSnapshot>.Cached(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<SpeedGearSnapshot>.Refreshing(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<SpeedGearSnapshot>.Loaded(Snapshot(), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            // The motor read never declares itself empty (the drives may still carry a speed), so an Empty
            // status only arrives when there is genuinely no vehicle; surface it as an empty snapshot the
            // view-model classifies as Empty.
            LoadStatus.Empty => RepositoryResult<SpeedGearSnapshot>.Loaded(
                new SpeedGearSnapshot(null, drives), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            LoadStatus.Offline => RepositoryResult<SpeedGearSnapshot>.OfflineCached(Snapshot(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<SpeedGearSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Speed &amp; Gear feature surface — the native mirror of the web component at
/// web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx.
/// </summary>
public static class SpeedGearPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "speed-gear-panel";

    /// <summary>Surface category.</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SpeedGearPanel";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.speedGear", "Speed & Gear");
    }
}

/// <summary>
/// PII-safe diagnostics for the Speed &amp; Gear surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a shift state, power, speed value, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SpeedGearPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SpeedGearPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SpeedGearPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedGearPanelRegistration.Slug}");
    }
}
