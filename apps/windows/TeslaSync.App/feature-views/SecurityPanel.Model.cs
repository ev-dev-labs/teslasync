using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SecurityPanelViewModel"/> can be in — the native
/// union of the branches the web Security panel renders
/// (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx). The web component is a pure child
/// of the Live-Telemetry grid (it takes a pre-resolved <c>securityData</c> + <c>remoteStartEnabled</c> pair);
/// the native surface binds its own cache-then-network reads (the latest security event plus the vehicle's
/// remote-start config flag) and so owns the full loading / loaded / empty / error / stale / offline matrix the
/// P2 state contract requires. Every value maps onto a visible surface (never a blank panel):
/// <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the lock tile + rows (with the
/// stale / offline chip for the latter two), <see cref="Empty"/> renders the friendly empty state (no security
/// event and no remote-start flag), <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the
/// retry surface.
/// </summary>
public enum SecurityPanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying a security event and/or a remote-start flag.</summary>
    Loaded,

    /// <summary>The snapshot resolved but there is no security event and no remote-start flag — empty state.</summary>
    Empty,

    /// <summary>The security request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The security fields the surface reads from <c>GET /security/latest?vehicle_id={id}</c> — the native mirror of
/// the exact <c>SecurityEvent</c> slice the web <c>SecurityPanel</c> consumes (web/src/api/types.ts): the
/// nullable <c>locked</c> / <c>sentry_mode</c> / <c>user_present</c> booleans the lock / sentry / user rows
/// branch on, the <c>doors_open</c> / <c>windows_open</c> string scalars (em-dash-guarded with a localized
/// "Closed" fallback exactly like the web <c>?? 'Closed'</c>) and the optional <c>detail</c> note. A
/// <see langword="null"/> parse result models the web <c>securityData</c> being null/undefined; any JSON object
/// yields a reading (matching the web's truthy <c>securityData &amp;&amp;</c> gate), with absent fields parsing
/// to <see langword="null"/> so a partial body never throws and each row still renders. WinUI-free so the parse
/// is unit-tested without a UI host.
/// </summary>
/// <param name="Locked">Whether the vehicle is locked (web <c>securityData.locked</c>); null when absent.</param>
/// <param name="SentryMode">Whether sentry mode is active (web <c>securityData.sentry_mode</c>); null when absent.</param>
/// <param name="DoorsOpen">Door-state label (web <c>securityData.doors_open</c>); null when absent / non-string.</param>
/// <param name="WindowsOpen">Window-state label (web <c>securityData.windows_open</c>); null when absent / non-string.</param>
/// <param name="UserPresent">Whether a user is present (web <c>securityData.user_present</c>); null when absent.</param>
/// <param name="Detail">Optional free-text note (web <c>securityData.detail</c>); null when absent / non-string.</param>
public sealed record SecurityPanelReading(
    bool? Locked,
    bool? SentryMode,
    string? DoorsOpen,
    string? WindowsOpen,
    bool? UserPresent,
    string? Detail)
{
    /// <summary>
    /// Project a <c>GET /security/latest</c> response into the security slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>securityData</c> being
    /// null/undefined (the security block is hidden). An object with every field missing still parses (all-null)
    /// so the lock tile and rows render exactly like the web's truthy <c>securityData &amp;&amp;</c> gate.
    /// </summary>
    public static SecurityPanelReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SecurityPanelReading(
            Locked: SecurityPanelJson.ReadBool(root, "locked"),
            SentryMode: SecurityPanelJson.ReadBool(root, "sentry_mode"),
            DoorsOpen: SecurityPanelJson.ReadString(root, "doors_open"),
            WindowsOpen: SecurityPanelJson.ReadString(root, "windows_open"),
            UserPresent: SecurityPanelJson.ReadBool(root, "user_present"),
            Detail: SecurityPanelJson.ReadString(root, "detail"));
    }
}

/// <summary>
/// Tolerant JSON readers for the security slice. Each mirrors the web's permissive access — a missing / null /
/// wrong-kind field reads as <see langword="null"/> so a partial body never throws and each row independently
/// falls back. The backend serializes raw <c>signal.SignalValue</c>, so booleans may arrive as booleans, numbers
/// or boolean strings; these readers narrow before use and never coerce a non-string to a string (the canonical
/// <c>web/src/lib/typeGuards.ts</c> invariant).
/// </summary>
internal static class SecurityPanelJson
{
    /// <summary>Read a string value (string kind only), or null — never coerces a boolean / number to text.</summary>
    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a boolean (bool, numeric, or boolean string), or null when absent / wrong-kind.</summary>
    public static bool? ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }
}

/// <summary>
/// The merged snapshot the surface renders — the latest security event (or null) plus the vehicle's
/// remote-start config flag (or null). It is the native equivalent of the web component's two props
/// (<c>securityData</c> + <c>remoteStartEnabled</c>) resolved into one immutable value. <see cref="HasData"/>
/// drives the content-vs-empty branch (web <c>hasData = securityData != null || remoteStartEnabled != null</c>),
/// while <see cref="HasSecurity"/> gates the lock tile + security rows (web <c>securityData &amp;&amp;</c>); the
/// remote-start row always renders whenever the panel has data. Pure data.
/// </summary>
/// <param name="Security">The latest security event, or null when <c>/security/latest</c> carried no object.</param>
/// <param name="RemoteStartEnabled">The remote-start config flag, or null when unknown.</param>
public sealed record SecurityPanelSnapshot(SecurityPanelReading? Security, bool? RemoteStartEnabled)
{
    /// <summary>True when there is a security event or a known remote-start flag (web <c>hasData</c>).</summary>
    public bool HasData => Security is not null || RemoteStartEnabled is not null;

    /// <summary>True when a security event is present (web <c>securityData &amp;&amp;</c> gate).</summary>
    public bool HasSecurity => Security is not null;
}

/// <summary>How the view renders a <see cref="SecurityRow"/>'s value.</summary>
public enum SecurityValueKind
{
    /// <summary>A status chip (the sentry row's Active / Inactive badge).</summary>
    Badge,

    /// <summary>Accent-tinted text (the user-present / remote-start green-or-muted value).</summary>
    AccentText,

    /// <summary>Monospace primary text (the doors / windows scalar value).</summary>
    MonoText,
}

/// <summary>
/// The render-ready lock tile — the big status word (Locked / Unlocked), the lock / unlock glyph, the token
/// brush key tinting both, the muted caption beneath it ("Vehicle lock status") and the Narrator name. The
/// native mirror of the web lock block (the coloured icon chip + the large status text). Pure data so the
/// projection is asserted without a UI host.
/// </summary>
/// <param name="Text">The localized status word (Locked / Unlocked).</param>
/// <param name="Glyph">The Segoe Fluent lock / unlock glyph.</param>
/// <param name="AccentBrushKey">The token brush key tinting the glyph chip and status text.</param>
/// <param name="Caption">The localized muted caption ("Vehicle lock status").</param>
/// <param name="AutomationName">The Narrator name combining the caption and status word.</param>
public sealed record SecurityLockTile(
    string Text,
    string Glyph,
    string AccentBrushKey,
    string Caption,
    string AutomationName);

/// <summary>
/// One render-ready label/value row — the localized label, an optional leading glyph, the already-localized
/// value text, how the value is rendered (<see cref="SecurityValueKind"/>) and the semantics that drive its
/// colour (the <see cref="BadgeStatus"/> for a chip, the <see cref="TextBrushKey"/> for tinted / mono text),
/// plus the optional badge glyph and the Narrator name. The native mirror of one web
/// <c>flex items-center justify-between</c> row (Sentry Mode / Doors / Windows / User Present / Remote Start).
/// Pure data so the projection is asserted without a UI host.
/// </summary>
/// <param name="Key">Stable row key (e.g. <c>sentry</c>, <c>doors</c>, <c>remoteStart</c>).</param>
/// <param name="Label">The localized row label.</param>
/// <param name="Glyph">The leading Segoe Fluent glyph, or null when the row has no leading icon (Windows).</param>
/// <param name="ValueText">The pre-formatted value (e.g. "Active", "Closed", "Enabled", or the em dash).</param>
/// <param name="ValueKind">How the value is rendered (badge / accent text / mono text).</param>
/// <param name="BadgeStatus">The chip status (only meaningful when <see cref="ValueKind"/> is Badge).</param>
/// <param name="BadgeGlyph">The glyph shown inside the badge, or empty (only used for Badge rows).</param>
/// <param name="TextBrushKey">The token brush key tinting the value text (accent / mono rows).</param>
/// <param name="AutomationName">The Narrator name combining the label and value.</param>
public sealed record SecurityRow(
    string Key,
    string Label,
    string? Glyph,
    string ValueText,
    SecurityValueKind ValueKind,
    StatusKind BadgeStatus,
    string BadgeGlyph,
    string TextBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Security surface — the localized title, the lock tile and the
/// security rows (Sentry / Doors / Windows / User Present) when a security event is present, the optional detail
/// note, the always-present Remote Start row, the empty-state message and the accessible summary.
/// <see cref="HasData"/> drives the content-vs-empty branch and <see cref="HasSecurity"/> gates the lock tile +
/// rows. Pure data so every branch is asserted without a UI host.
/// </summary>
/// <param name="HasData">True when there is anything to render (web <c>hasData</c>).</param>
/// <param name="HasSecurity">True when the lock tile + security rows render (web <c>securityData &amp;&amp;</c>).</param>
/// <param name="Title">The localized surface title ("Security").</param>
/// <param name="LockTile">The lock tile, or null when there is no security event.</param>
/// <param name="SecurityRows">The Sentry / Doors / Windows / User Present rows (empty when no security event).</param>
/// <param name="Detail">The optional detail note, or null when absent / blank.</param>
/// <param name="RemoteStart">The always-present Remote Start row.</param>
/// <param name="EmptyMessage">The localized empty-state message.</param>
/// <param name="AriaLabel">The localized accessible surface summary.</param>
public sealed record SecurityPanelDisplay(
    bool HasData,
    bool HasSecurity,
    string Title,
    SecurityLockTile? LockTile,
    IReadOnlyList<SecurityRow> SecurityRows,
    string? Detail,
    SecurityRow RemoteStart,
    string EmptyMessage,
    string AriaLabel)
{
    /// <summary>An empty display (no security event, no remote-start flag) for the loading / empty fallback.</summary>
    public static SecurityPanelDisplay Empty(ILocalizer localizer) =>
        SecurityPanelProjection.Project(new SecurityPanelSnapshot(null, null), localizer);
}

/// <summary>
/// Pure projection from a merged <see cref="SecurityPanelSnapshot"/> to a <see cref="SecurityPanelDisplay"/> —
/// the native port of the render logic in SecurityPanel.tsx. It formats the lock tile (status word + lock /
/// unlock glyph + green/amber tint), the sentry chip (Active danger / Inactive neutral), the doors / windows
/// scalars (verbatim value, or the localized "Closed" only when the field is absent — web <c>?? 'Closed'</c>),
/// the user-present value (Yes green / No muted) and the remote-start value (Enabled green / Disabled muted /
/// em dash when unknown). Every label resolves through the i18n facade. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class SecurityPanelProjection
{
    /// <summary>The em dash shown for an unknown remote-start flag (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Segoe Fluent "Shield" glyph — the web <c>Shield</c> / <c>ShieldAlert</c> icon (title + sentry chip).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Lock" glyph — the web <c>Lock</c> icon (locked tile).</summary>
    public const string LockedGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Unlock" glyph — the web <c>Unlock</c> icon (unlocked tile).</summary>
    public const string UnlockedGlyph = "\uE785";

    /// <summary>Segoe Fluent "RedEye" glyph — the web <c>Eye</c> icon (sentry row label).</summary>
    public const string SentryGlyph = "\uE7B3";

    /// <summary>Segoe Fluent "Door" glyph — the web <c>DoorClosed</c> icon (doors row label).</summary>
    public const string DoorGlyph = "\uE8D7";

    /// <summary>Segoe Fluent "Contact" glyph — the web <c>User</c> icon (user-present row label).</summary>
    public const string UserGlyph = "\uE77B";

    /// <summary>Segoe Fluent "Permissions" (key) glyph — the web <c>KeyRound</c> icon (remote-start row label).</summary>
    public const string RemoteStartGlyph = "\uE192";

    /// <summary>Token brush key for the locked / active / present / enabled accent (web emerald).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the unlocked accent (web amber).</summary>
    public const string WarningBrushKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the muted / off accent (web <c>--text-muted</c>).</summary>
    public const string MutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the primary scalar value text (web <c>--text-primary</c>).</summary>
    public const string PrimaryBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Project <paramref name="snapshot"/> using the <paramref name="localizer"/>.</summary>
    /// <param name="snapshot">The merged security + remote-start snapshot.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static SecurityPanelDisplay Project(SecurityPanelSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("common.security", "Security");
        string empty = localizer.GetString("telemetry.noSecurityData", "No security data available");
        string aria = localizer.GetString(
            "security.panel.aria",
            "Security — lock status, sentry mode, doors, windows and remote start");

        SecurityLockTile? lockTile = null;
        var rows = new List<SecurityRow>(4);
        string? detail = null;

        if (snapshot.Security is { } security)
        {
            lockTile = BuildLockTile(security.Locked, localizer);
            rows.Add(BuildSentryRow(security.SentryMode, localizer));
            rows.Add(BuildScalarRow(
                "doors",
                localizer.GetString("telemetry.doors", "Doors"),
                DoorGlyph,
                security.DoorsOpen,
                localizer));
            rows.Add(BuildScalarRow(
                "windows",
                localizer.GetString("telemetry.windows", "Windows"),
                glyph: null,
                security.WindowsOpen,
                localizer));
            rows.Add(BuildUserPresentRow(security.UserPresent, localizer));

            if (!string.IsNullOrWhiteSpace(security.Detail))
            {
                detail = security.Detail.Trim();
            }
        }

        var remoteStart = BuildRemoteStartRow(snapshot.RemoteStartEnabled, localizer);

        return new SecurityPanelDisplay(
            HasData: snapshot.HasData,
            HasSecurity: snapshot.HasSecurity,
            Title: title,
            LockTile: lockTile,
            SecurityRows: rows,
            Detail: detail,
            RemoteStart: remoteStart,
            EmptyMessage: empty,
            AriaLabel: aria);
    }

    private static SecurityLockTile BuildLockTile(bool? locked, ILocalizer localizer)
    {
        bool isLocked = locked == true;
        string text = isLocked
            ? localizer.GetString("common.locked", "Locked")
            : localizer.GetString("common.unlocked", "Unlocked");
        string caption = localizer.GetString("telemetry.lockStatus", "Vehicle lock status");

        return new SecurityLockTile(
            Text: text,
            Glyph: isLocked ? LockedGlyph : UnlockedGlyph,
            AccentBrushKey: isLocked ? SuccessBrushKey : WarningBrushKey,
            Caption: caption,
            AutomationName: Combine(caption, text));
    }

    private static SecurityRow BuildSentryRow(bool? sentryMode, ILocalizer localizer)
    {
        bool active = sentryMode == true;
        string label = localizer.GetString("telemetry.sentryMode", "Sentry Mode");
        string value = active
            ? localizer.GetString("common.active", "Active")
            : localizer.GetString("common.inactive", "Inactive");

        return new SecurityRow(
            Key: "sentry",
            Label: label,
            Glyph: SentryGlyph,
            ValueText: value,
            ValueKind: SecurityValueKind.Badge,
            BadgeStatus: active ? StatusKind.Danger : StatusKind.Neutral,
            BadgeGlyph: ShieldGlyph,
            TextBrushKey: active ? SuccessBrushKey : MutedBrushKey,
            AutomationName: Combine(label, value));
    }

    private static SecurityRow BuildScalarRow(string key, string label, string? glyph, string? value, ILocalizer localizer)
    {
        // Web parity: `value ?? t('common.closed', 'Closed')` — the localized fallback applies only when the
        // field is absent/null; a present (even empty) string value is rendered verbatim.
        string text = value ?? localizer.GetString("common.closed", "Closed");

        return new SecurityRow(
            Key: key,
            Label: label,
            Glyph: glyph,
            ValueText: text,
            ValueKind: SecurityValueKind.MonoText,
            BadgeStatus: StatusKind.Neutral,
            BadgeGlyph: string.Empty,
            TextBrushKey: PrimaryBrushKey,
            AutomationName: Combine(label, text));
    }

    private static SecurityRow BuildUserPresentRow(bool? userPresent, ILocalizer localizer)
    {
        bool present = userPresent == true;
        string label = localizer.GetString("telemetry.userPresent", "User Present");
        string value = present
            ? localizer.GetString("common.yes", "Yes")
            : localizer.GetString("common.no", "No");

        return new SecurityRow(
            Key: "userPresent",
            Label: label,
            Glyph: UserGlyph,
            ValueText: value,
            ValueKind: SecurityValueKind.AccentText,
            BadgeStatus: StatusKind.Neutral,
            BadgeGlyph: string.Empty,
            TextBrushKey: present ? SuccessBrushKey : MutedBrushKey,
            AutomationName: Combine(label, value));
    }

    private static SecurityRow BuildRemoteStartRow(bool? remoteStartEnabled, ILocalizer localizer)
    {
        string label = localizer.GetString("telemetry.remoteStart", "Remote Start");
        string value;
        string brushKey;
        if (remoteStartEnabled is not { } enabled)
        {
            value = EmDash;
            brushKey = MutedBrushKey;
        }
        else if (enabled)
        {
            value = localizer.GetString("common.enabled", "Enabled");
            brushKey = SuccessBrushKey;
        }
        else
        {
            value = localizer.GetString("common.disabled", "Disabled");
            brushKey = MutedBrushKey;
        }

        return new SecurityRow(
            Key: "remoteStart",
            Label: label,
            Glyph: RemoteStartGlyph,
            ValueText: value,
            ValueKind: SecurityValueKind.AccentText,
            BadgeStatus: StatusKind.Neutral,
            BadgeGlyph: string.Empty,
            TextBrushKey: brushKey,
            AutomationName: Combine(label, value));
    }

    private static string Combine(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> security emissions onto parsed
/// <c>RepositoryResult&lt;SecurityPanelSnapshot&gt;</c>, folding in the already-resolved remote-start flag and
/// preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render the
/// full state matrix. A security body that carries no object becomes a snapshot with a null security event (the
/// remote-start row still renders); the view-model classifies the surface empty only when neither side has data.
/// Pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SecurityPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s security payload (when present), folding in <paramref name="remoteStartEnabled"/>.</summary>
    public static RepositoryResult<SecurityPanelSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        bool? remoteStartEnabled)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SecurityPanelSnapshot Snapshot() => new(SecurityPanelReading.FromResponse(raw.Value), remoteStartEnabled);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SecurityPanelSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<SecurityPanelSnapshot>.Cached(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<SecurityPanelSnapshot>.Refreshing(Snapshot(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<SecurityPanelSnapshot>.Loaded(Snapshot(), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            // The security read never declares itself empty at the engine boundary (the remote-start flag may
            // still carry data), so an Empty status only arrives when there is genuinely no vehicle; surface it
            // as a snapshot the view-model classifies as Empty.
            LoadStatus.Empty => RepositoryResult<SecurityPanelSnapshot>.Loaded(
                new SecurityPanelSnapshot(null, remoteStartEnabled), raw.FetchedAt ?? DateTimeOffset.UtcNow),

            LoadStatus.Offline => RepositoryResult<SecurityPanelSnapshot>.OfflineCached(Snapshot(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<SecurityPanelSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Security feature surface — the native mirror of the web component at
/// web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx.
/// </summary>
public static class SecurityPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "security-panel";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SecurityPanel";

    /// <summary>Localized surface name (web "Security").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("common.security", "Security");
    }
}

/// <summary>
/// PII-safe diagnostics for the Security surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a lock state, sentry flag, door / window value, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SecurityPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SecurityPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SecurityPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SecurityPanelRegistration.Slug}");
    }
}
