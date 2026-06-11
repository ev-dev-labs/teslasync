using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SecuritySectionViewModel"/> can be in — the native
/// superset of the branches the web vehicle-detail Security section renders
/// (web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx). The web component is a pure child
/// of the Vehicle-Detail page (it takes the latest <c>SecurityEvent</c> and the live <c>VehicleState</c> as
/// props); the native surface binds its own cache-then-network read of <c>/security/latest</c> (plus a
/// best-effort vehicle-state read for the lock / sentry flags), so it owns the full loading / loaded / empty /
/// error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible surface
/// (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the
/// four-metric grid (the latter two with a freshness chip), <see cref="Empty"/> renders the web "No security
/// data available" empty state (the web <c>securityData ?</c> false branch), <see cref="Loading"/> shows the
/// skeleton chrome and <see cref="Error"/> the retry affordance.
/// </summary>
public enum SecuritySectionState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying a security event — render the four-metric grid.</summary>
    Loaded,

    /// <summary>No security event resolved — render the web "No security data available" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the grid plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The semantic accent a metric card carries — the native, theme-token analogue of the web card's
/// <c>NeonColor</c> (<c>green</c> for a reassuring "secured" reading, <c>cyan</c> for the neutral / accent
/// reading). Kept as a value (not a brush) so the projection is unit-tested without a XAML runtime;
/// <see cref="SecurityCardToneResources"/> maps each tone to a design-token brush key the WinUI view resolves.
/// </summary>
public enum SecurityCardTone
{
    /// <summary>A reassuring secured reading (web <c>green</c>): locked, sentry active, doors / windows closed.</summary>
    Secured,

    /// <summary>The neutral / accent reading (web <c>cyan</c>): unlocked, sentry off, a door / window open.</summary>
    Neutral,
}

/// <summary>Maps a <see cref="SecurityCardTone"/> to its design-token brush resource key
/// (<c>apps/design/generated/windows/Tokens.xaml</c>). UI-free so the mapping is asserted without a XAML host.</summary>
public static class SecurityCardToneResources
{
    /// <summary>The theme-aware accent brush key tinting a card's icon chip for the given tone.</summary>
    /// <param name="tone">The semantic tone to resolve.</param>
    /// <returns>The design-token brush resource key.</returns>
    public static string BrushKey(SecurityCardTone tone) => tone switch
    {
        // web neonColorMap.green -> emerald / neon-green; cyan -> the app accent (neon-cyan).
        SecurityCardTone.Secured => "TsColorSuccessBrush",
        _ => "TsColorAccentBrush",
    };
}

/// <summary>
/// The security slice the web vehicle-detail Security section reads from the latest <c>SecurityEvent</c>
/// (<c>/security/latest</c>): the door-state label and the open-window count. The native mirror of the web's
/// <c>doorState</c> derivation and <c>windowOpenCount(securityData)</c>. The endpoint returns a snake_case
/// object holding only the signals currently present in live state, so every field is parsed null-tolerantly.
/// WinUI-free so the parse is asserted without a UI host.
/// </summary>
/// <param name="DoorLabel">The door-state label shown on the Doors card (web <c>String(door_state)</c> when the
/// field is present and non-empty), or null when there is no door reading (the Doors card falls back to the
/// localized "Closed").</param>
/// <param name="WindowsOpen">The number of windows reporting open (web <c>windowOpenCount</c>): the count of the
/// four <c>fd/fp/rd/rp_window</c> fields whose value coerces to a finite number greater than zero.</param>
public sealed record SecuritySectionReading(string? DoorLabel, int WindowsOpen)
{
    private static readonly string[] WindowFields = { "fd_window", "fp_window", "rd_window", "rp_window" };

    /// <summary>True when a door-state label is present (web <c>doorState</c> truthy → the Doors card tints cyan).</summary>
    public bool HasDoorReading => DoorLabel is not null;

    /// <summary>
    /// Parse a <c>/security/latest</c> object into the door / window slice the web section reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>securityData</c> being
    /// null / undefined (the grid is hidden and the empty state shows). An object always parses (an absent door
    /// reading and a zero window count are valid, exactly as the web reads them from a sparse event).
    /// </summary>
    /// <param name="root">The parsed <c>/security/latest</c> response body.</param>
    /// <returns>The parsed reading, or null when the body is not an object.</returns>
    public static SecuritySectionReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SecuritySectionReading(
            DoorLabel: ReadDoorLabel(root),
            WindowsOpen: CountOpenWindows(root));
    }

    // web: securityData?.door_state != null && securityData.door_state !== '' ? String(securityData.door_state) : null.
    // The backend serializes raw signal.SignalValue, so door_state can arrive as a string enum or a native bool;
    // String() is reproduced verbatim (a non-empty string wins; true/false coerce to "true"/"false"; an absent /
    // null / empty-string reading yields no label and the Doors card falls back to the localized "Closed").
    internal static string? ReadDoorLabel(JsonElement root)
    {
        if (!root.TryGetProperty("door_state", out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => string.IsNullOrEmpty(value.GetString()) ? null : value.GetString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }

    // web windowOpenCount: for each of fd/fp/rd/rp_window, skip null, coerce with Number(v) and count when the
    // result is finite and > 0 (a percent-open reading). A boolean true coerces to 1; a non-numeric string
    // (e.g. "Open") coerces to NaN and is not counted; "0" / "" / false coerce to 0 and are not counted.
    internal static int CountOpenWindows(JsonElement root)
    {
        int open = 0;
        foreach (string field in WindowFields)
        {
            if (root.TryGetProperty(field, out var value) && IsWindowOpen(value))
            {
                open++;
            }
        }

        return open;
    }

    private static bool IsWindowOpen(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number => value.TryGetDouble(out double n) && double.IsFinite(n) && n > 0,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => double.TryParse(
            value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double s) && double.IsFinite(s) && s > 0,
        _ => false,
    };
}

/// <summary>
/// The merged snapshot the surface renders — the latest security event slice (or null) plus the lock / sentry
/// flags read from the live vehicle state. The native equivalent of the web component's two inputs
/// (<c>securityData</c> from <c>useSecurityLatest</c> and <c>state</c> from <c>useVehicleState</c>) resolved into
/// one immutable value. <see cref="HasData"/> drives the content-vs-empty branch (web <c>securityData ?</c>);
/// the lock / sentry flags default to <see langword="false"/> when the vehicle state is unavailable, matching
/// the web's falsy rendering. Pure data.
/// </summary>
/// <param name="Security">The latest security event slice, or null when <c>/security/latest</c> carried no object.</param>
/// <param name="Locked">Whether the vehicle is locked (web <c>state.is_locked</c>); false when state is unknown.</param>
/// <param name="SentryActive">Whether Sentry Mode is active (web <c>state.sentry_mode</c>); false when unknown.</param>
public sealed record SecuritySectionSnapshot(SecuritySectionReading? Security, bool Locked, bool SentryActive)
{
    /// <summary>True when a security event backs the snapshot (web <c>securityData ?</c> grid gate).</summary>
    public bool HasData => Security is not null;
}

/// <summary>
/// One render-ready metric card — the native mirror of a web <c>&lt;MetricCard /&gt;</c> call site (the muted
/// label, the bold value, the tinted status glyph and its tone). Pure data so every value is asserted headlessly.
/// </summary>
/// <param name="Key">Stable card id (e.g. <c>lock</c>) used by the view and tests.</param>
/// <param name="Glyph">The Segoe Fluent status glyph rendered in the card's tinted icon chip.</param>
/// <param name="Label">The localized muted label (web <c>label</c>).</param>
/// <param name="Value">The localized bold value (web <c>value</c>).</param>
/// <param name="Tone">The semantic accent tinting the icon chip (web <c>color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record SecurityMetricCard(
    string Key,
    string Glyph,
    string Label,
    string Value,
    SecurityCardTone Tone,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the vehicle-detail Security section — the localized title, the four
/// metric cards (Locked / Sentry / Doors / Windows) when a security event is present, and the empty-state
/// message otherwise. <see cref="HasData"/> drives the content-vs-empty branch. Pure data so every branch is
/// asserted without a UI host.
/// </summary>
/// <param name="HasData">True when the four-metric grid renders (web <c>securityData ?</c>).</param>
/// <param name="Title">The localized surface title ("Security").</param>
/// <param name="Cards">The four metric cards (empty when there is no security event).</param>
/// <param name="EmptyMessage">The localized empty-state message.</param>
/// <param name="AutomationName">The localized accessible surface name.</param>
public sealed record SecuritySectionDisplay(
    bool HasData,
    string Title,
    IReadOnlyList<SecurityMetricCard> Cards,
    string EmptyMessage,
    string AutomationName)
{
    /// <summary>The empty display (no security event) for the loading / empty fallback.</summary>
    /// <param name="localizer">The i18n facade resolving the title and empty message.</param>
    /// <returns>The all-empty display model.</returns>
    public static SecuritySectionDisplay Empty(ILocalizer localizer) =>
        SecuritySectionProjection.Project(new SecuritySectionSnapshot(null, false, false), localizer);
}

/// <summary>
/// Pure projection from a merged <see cref="SecuritySectionSnapshot"/> to a <see cref="SecuritySectionDisplay"/>
/// — the native port of the render logic in SecuritySection.tsx. The four cards reproduce the web call sites
/// one-for-one: Locked (Yes / No, green when locked), Sentry (Active / Off, green when active), Doors (the door
/// label or the localized "Closed", cyan when a door reads open) and Windows (the "{0} open" count or "Closed",
/// cyan when a window reads open). Every translatable string resolves through the i18n facade using the catalog
/// keys the web source passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class SecuritySectionProjection
{
    // i18n keys (resolve against the P1/S10 catalog; the fallbacks mirror the web English literals). The native
    // catalog stores keys under the translation.* namespace; the windowsOpen template normalizes i18next's
    // {{count}} to the .NET {0} format slot.
    private const string TitleKey = "translation.vehicles.detail.security";
    private const string TitleFallback = "Security";
    private const string LockedLabelKey = "translation.common.locked";
    private const string LockedLabelFallback = "Locked";
    private const string YesKey = "translation.common.yes";
    private const string YesFallback = "Yes";
    private const string NoKey = "translation.common.no";
    private const string NoFallback = "No";
    private const string SentryLabelKey = "translation.common.sentry";
    private const string SentryLabelFallback = "Sentry";
    private const string ActiveKey = "translation.common.active";
    private const string ActiveFallback = "Active";
    private const string OffKey = "translation.common.off";
    private const string OffFallback = "Off";
    private const string DoorsLabelKey = "translation.vehicles.detail.doors";
    private const string DoorsLabelFallback = "Doors";
    private const string WindowsLabelKey = "translation.vehicles.detail.windows";
    private const string WindowsLabelFallback = "Windows";
    private const string WindowsOpenKey = "translation.vehicles.detail.windowsOpen";
    private const string WindowsOpenFallback = "{0} open";
    private const string ClosedKey = "translation.common.closed";
    private const string ClosedFallback = "Closed";
    private const string NoDataKey = "translation.vehicles.detail.noSecurityData";
    private const string NoDataFallback = "No security data available";

    /// <summary>Project <paramref name="snapshot"/> into its localized title, four metric cards and empty message.</summary>
    /// <param name="snapshot">The merged security + lock/sentry snapshot.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static SecuritySectionDisplay Project(SecuritySectionSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        string emptyMessage = localizer.GetString(NoDataKey, NoDataFallback);

        if (snapshot.Security is not { } security)
        {
            return new SecuritySectionDisplay(
                HasData: false,
                Title: title,
                Cards: Array.Empty<SecurityMetricCard>(),
                EmptyMessage: emptyMessage,
                AutomationName: title);
        }

        string closed = localizer.GetString(ClosedKey, ClosedFallback);

        string windowsValue = security.WindowsOpen > 0
            ? string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(WindowsOpenKey, WindowsOpenFallback),
                security.WindowsOpen.ToString(CultureInfo.CurrentCulture))
            : closed;

        var cards = new[]
        {
            BuildCard(
                "lock",
                snapshot.Locked ? SecuritySectionRegistration.LockGlyph : SecuritySectionRegistration.UnlockGlyph,
                localizer.GetString(LockedLabelKey, LockedLabelFallback),
                snapshot.Locked
                    ? localizer.GetString(YesKey, YesFallback)
                    : localizer.GetString(NoKey, NoFallback),
                snapshot.Locked ? SecurityCardTone.Secured : SecurityCardTone.Neutral),

            BuildCard(
                "sentry",
                SecuritySectionRegistration.SentryGlyph,
                localizer.GetString(SentryLabelKey, SentryLabelFallback),
                snapshot.SentryActive
                    ? localizer.GetString(ActiveKey, ActiveFallback)
                    : localizer.GetString(OffKey, OffFallback),
                snapshot.SentryActive ? SecurityCardTone.Secured : SecurityCardTone.Neutral),

            BuildCard(
                "doors",
                SecuritySectionRegistration.DoorGlyph,
                localizer.GetString(DoorsLabelKey, DoorsLabelFallback),
                security.DoorLabel ?? closed,
                security.HasDoorReading ? SecurityCardTone.Neutral : SecurityCardTone.Secured),

            BuildCard(
                "windows",
                SecuritySectionRegistration.WindowGlyph,
                localizer.GetString(WindowsLabelKey, WindowsLabelFallback),
                windowsValue,
                security.WindowsOpen > 0 ? SecurityCardTone.Neutral : SecurityCardTone.Secured),
        };

        return new SecuritySectionDisplay(
            HasData: true,
            Title: title,
            Cards: cards,
            EmptyMessage: emptyMessage,
            AutomationName: title);
    }

    private static SecurityMetricCard BuildCard(
        string key,
        string glyph,
        string label,
        string value,
        SecurityCardTone tone) =>
        new(
            Key: key,
            Glyph: glyph,
            Label: label,
            Value: value,
            Tone: tone,
            AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Cache-then-network result mapper for the Security section — folds the lock / sentry flags read from the live
/// vehicle state into every <c>/security/latest</c> emission and preserves the engine's load status. A null /
/// non-object security body surfaces as <see cref="LoadStatus.Empty"/> (the web <c>securityData</c> being null →
/// the empty state); an object surfaces as a snapshot the view-model renders as the four-metric grid. WinUI-free
/// so the mapping is asserted headlessly.
/// </summary>
public static class SecuritySectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s security payload (when present), folding in the lock / sentry flags.</summary>
    /// <param name="raw">The raw <c>/security/latest</c> cache-then-network emission.</param>
    /// <param name="locked">The live <c>is_locked</c> flag resolved from the vehicle state.</param>
    /// <param name="sentryActive">The live <c>sentry_mode</c> flag resolved from the vehicle state.</param>
    /// <returns>The mapped snapshot emission.</returns>
    public static RepositoryResult<SecuritySectionSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        bool locked,
        bool sentryActive)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SecuritySectionSnapshot Snapshot() =>
            new(SecuritySectionReading.FromResponse(raw.Value), locked, sentryActive);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SecuritySectionSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<SecuritySectionSnapshot>.Cached(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<SecuritySectionSnapshot>.Refreshing(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<SecuritySectionSnapshot>.Loaded(Snapshot(), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            // A null / non-object security body is the web's null securityData — there is nothing to render, so
            // the surface shows the friendly empty state regardless of the resolved lock / sentry flags.
            LoadStatus.Empty => RepositoryResult<SecuritySectionSnapshot>.Empty(raw.FetchedAt),

            LoadStatus.Offline => RepositoryResult<SecuritySectionSnapshot>.OfflineCached(Snapshot(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<SecuritySectionSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the vehicle-detail Security section surface — the native mirror of the web component at
/// web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx. The surface reads the same
/// <c>/security/latest</c> live state the web section consumes, plus the live vehicle state for the lock / sentry
/// flags.
/// </summary>
public static class SecuritySectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "security-section";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SecuritySection";

    /// <summary>Segoe Fluent glyph for the section header (Shield, web <c>Shield</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent glyph for the locked state (Lock, web <c>Lock</c>).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent glyph for the unlocked state (Unlock, web <c>Unlock</c>).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>Segoe Fluent glyph for the Sentry card (RedEye, web <c>Eye</c>).</summary>
    public const string SentryGlyph = "\uE7B3";

    /// <summary>Segoe Fluent glyph for the Doors card (Door, web <c>DoorClosed</c>).</summary>
    public const string DoorGlyph = "\uE8D7";

    /// <summary>Segoe Fluent glyph for the Windows card (Car, web <c>Car</c>).</summary>
    public const string WindowGlyph = "\uE804";

    /// <summary>Localized surface name (web "Security").</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    /// <returns>The localized "Security" heading.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.vehicles.detail.security", "Security");
    }
}

/// <summary>
/// PII-safe diagnostics for the Security section surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a lock state, sentry flag, door / window
/// value, VIN or vehicle id — so a diagnostics line can never leak the vehicle's security posture. Thread-safe.
/// </summary>
public sealed class SecuritySectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink, or null to only count opens.</param>
    public SecuritySectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SecuritySection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SecuritySectionRegistration.Slug}");
    }
}
