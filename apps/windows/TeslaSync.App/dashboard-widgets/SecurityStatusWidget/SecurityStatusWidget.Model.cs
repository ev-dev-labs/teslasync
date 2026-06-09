using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SecurityStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SecurityStatusWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/SecurityStatusWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{securityData ? … : empty}</c> gate (the shared <c>WidgetStatusGrid</c> renders its empty state when the
/// cell list is empty) — the <c>useSecurityLatest</c> read resolved no security object (a null body or no
/// vehicle) — the "No security data" surface. A security object that simply carries no lock / sentry / door /
/// window fields is NOT empty: it still renders the four cells (lock and sentry default to the "unlocked" /
/// "off" branches, the door and window counts to zero), exactly like the web where <c>securityData</c> is
/// truthy and the four <c>StatusCell</c>s are always produced.
/// </summary>
public enum SecurityStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a security object to render the four cells for.</summary>
    Loaded,

    /// <summary>No security object resolved (null body / no vehicle) — render the "No security data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the cells plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the cells plus an offline chip.</summary>
    Offline,
}

/// <summary>The JSON kind a <see cref="SecurityScalar"/> was narrowed to.</summary>
public enum SecurityScalarKind
{
    /// <summary>No usable value — JSON null, number, object, array, empty string, or an absent property.</summary>
    None,

    /// <summary>A native JSON boolean (web <c>typeof val === 'boolean'</c>).</summary>
    Boolean,

    /// <summary>A non-empty JSON string (web <c>asNonEmptyString(val)</c>).</summary>
    Text,
}

/// <summary>
/// A tolerant projection of one security JSON field (<c>door_state</c> or a window field), mirroring the web's
/// <c>unknown</c> narrowing: the backend serializes <c>signal.SignalValue</c> (<c>interface{}</c>), so a field
/// can arrive as a native boolean (e.g. <c>false</c>) or a string enum. This captures exactly the three cases
/// the web branches on — a native boolean (<c>typeof val === 'boolean'</c>), a non-empty string
/// (<c>asNonEmptyString(val)</c>, which keeps the value only when it is a string of length &gt; 0), and
/// "nothing usable" (every other JSON kind, an empty string, or an absent property) — so the door / window
/// counting is unit-tested without a JSON host.
/// </summary>
/// <param name="Kind">Which of the three narrowed cases this value is.</param>
/// <param name="BooleanValue">The boolean payload when <see cref="Kind"/> is <see cref="SecurityScalarKind.Boolean"/>.</param>
/// <param name="TextValue">The string payload when <see cref="Kind"/> is <see cref="SecurityScalarKind.Text"/>.</param>
public readonly record struct SecurityScalar(SecurityScalarKind Kind, bool BooleanValue, string? TextValue)
{
    /// <summary>The "nothing usable" value (web <c>asNonEmptyString</c> returning null).</summary>
    public static SecurityScalar None => new(SecurityScalarKind.None, false, null);

    /// <summary>A native boolean value (web <c>typeof val === 'boolean'</c>).</summary>
    public static SecurityScalar FromBoolean(bool value) => new(SecurityScalarKind.Boolean, value, null);

    /// <summary>A string value, narrowed to <see cref="None"/> when null or empty (web <c>asNonEmptyString</c>).</summary>
    public static SecurityScalar FromText(string? value) =>
        string.IsNullOrEmpty(value) ? None : new(SecurityScalarKind.Text, false, value);

    /// <summary>True only when this is the native boolean <see langword="true"/> (web <c>val === true</c>).</summary>
    public bool IsBooleanTrue => Kind == SecurityScalarKind.Boolean && BooleanValue;

    /// <summary>
    /// Read property <paramref name="name"/> off <paramref name="obj"/> as a tolerant scalar — a JSON
    /// boolean becomes <see cref="FromBoolean"/>, a non-empty JSON string becomes <see cref="FromText"/>,
    /// and every other kind (null / number / object / array / empty string / absent) becomes <see cref="None"/>,
    /// matching the web's <c>typeof === 'boolean'</c> then <c>asNonEmptyString</c> narrowing order.
    /// </summary>
    public static SecurityScalar Read(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => FromBoolean(true),
            JsonValueKind.False => FromBoolean(false),
            JsonValueKind.String => FromText(v.GetString()),
            _ => None,
        };
    }
}

/// <summary>
/// The security slice the view reads from <c>GET /security/latest?vehicle_id={id}</c> — the native mirror of
/// the exact <c>SecurityEvent</c> fields the web widget consumes: <c>locked</c> and <c>sentry_mode</c> (the
/// nullable booleans the lock / sentry cells branch on), <c>door_state</c> and the four window fields
/// <c>fd_window</c> / <c>fp_window</c> / <c>rd_window</c> / <c>rp_window</c> (the tolerant scalars the door /
/// window open-counts derive from). A <see langword="null"/> parse result models the web <c>securityData</c>
/// being null/undefined (no security object → the empty surface); any JSON object yields a reading (matching
/// the web's truthy <c>securityData ?</c> gate), with absent fields parsing to <see langword="false"/> /
/// <see cref="SecurityScalar.None"/> so a partial body never throws and each cell still renders.
/// </summary>
/// <param name="Locked">Whether the vehicle is locked (web <c>securityData.locked</c>, truthy → locked).</param>
/// <param name="SentryMode">Whether sentry mode is active (web <c>securityData.sentry_mode</c>, truthy → active).</param>
/// <param name="DoorState">The aggregate door field (web <c>securityData.door_state</c>).</param>
/// <param name="FdWindow">Front-driver window field (web <c>securityData.fd_window</c>).</param>
/// <param name="FpWindow">Front-passenger window field (web <c>securityData.fp_window</c>).</param>
/// <param name="RdWindow">Rear-driver window field (web <c>securityData.rd_window</c>).</param>
/// <param name="RpWindow">Rear-passenger window field (web <c>securityData.rp_window</c>).</param>
public sealed record SecurityStatusReading(
    bool Locked,
    bool SentryMode,
    SecurityScalar DoorState,
    SecurityScalar FdWindow,
    SecurityScalar FpWindow,
    SecurityScalar RdWindow,
    SecurityScalar RpWindow)
{
    /// <summary>
    /// Project a <c>GET /security/latest</c> response into the security slice. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>securityData</c> being null
    /// (the empty surface). Any object yields a reading (matching the web's truthy <c>securityData ?</c> gate);
    /// <c>locked</c> / <c>sentry_mode</c> read as <see langword="true"/> only for a JSON boolean true (the web
    /// truthiness of a <c>boolean | null</c> field), and the door / window fields read as tolerant scalars.
    /// </summary>
    public static SecurityStatusReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SecurityStatusReading(
            Locked: ReadFlag(root, "locked"),
            SentryMode: ReadFlag(root, "sentry_mode"),
            DoorState: SecurityScalar.Read(root, "door_state"),
            FdWindow: SecurityScalar.Read(root, "fd_window"),
            FpWindow: SecurityScalar.Read(root, "fp_window"),
            RdWindow: SecurityScalar.Read(root, "rd_window"),
            RpWindow: SecurityScalar.Read(root, "rp_window"));
    }

    // Web parity: securityData.locked / sentry_mode are `boolean | null`; the JSX uses their truthiness, so a
    // JSON true → flag set, and false / null / absent → flag clear.
    private static bool ReadFlag(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>SecurityStatusWidget</c> renders the same two-column status grid at every footprint (it never branches
/// on <c>size</c>), so this carries only the registry min/max constraints — no compact / tall variants.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SecurityStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static SecurityStatusSize Default => new(1, 2);
}

/// <summary>
/// One projected, display-ready status cell consumed by the WinUI view — the native analogue of a web
/// <c>StatusCell</c> rendered by the shared <c>WidgetStatusGrid</c>. Holds the localized label, the derived
/// semantic status (which the view maps to a themed tint + corner dot), the already-localized value text, the
/// Segoe Fluent icon glyph (the web per-cell lucide icon) and a Narrator automation name. Pure data — no WinUI
/// types.
/// </summary>
/// <param name="Id">Stable cell id (web <c>lock</c> / <c>sentry</c> / <c>doors</c> / <c>windows</c>).</param>
/// <param name="Label">Localized cell label.</param>
/// <param name="Status">Semantic status driving the tint + dot (web <c>StatusCell.status</c>).</param>
/// <param name="Value">Localized value text (web <c>StatusCell.value</c>).</param>
/// <param name="IconGlyph">Segoe Fluent glyph for the cell icon (web <c>StatusCell.icon</c>).</param>
/// <param name="AutomationName">Narrator name combining the label and value.</param>
public sealed record SecurityStatusCell(
    string Id,
    string Label,
    StatusKind Status,
    string Value,
    string IconGlyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the security surface — the native analogue of everything the web
/// component computes via <c>useMemo</c> before returning JSX (the four <c>StatusCell</c>s). Holds the ordered
/// lock / sentry / doors / windows cells plus a Narrator summary so the view is a thin renderer. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Cells">The four cells in render order: lock, sentry, doors, windows.</param>
/// <param name="AutomationName">Narrator name summarising the four cells.</param>
public sealed record SecurityStatusDisplay(
    IReadOnlyList<SecurityStatusCell> Cells,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="SecurityStatusReading"/> to the display model — the native port of the
/// inline <c>useMemo</c> cell construction and the door / window open-counting in
/// web/src/features/dashboard/widgets/SecurityStatusWidget.tsx. The door count reproduces the web
/// <c>door_state === true ? ['open'] : doorStates.filter(includes 'open')</c>; the window count reproduces the
/// per-field <c>typeof boolean ? val : (asNonEmptyString &amp;&amp; lower !== 'closed')</c>. Every label resolves
/// through the i18n facade.
/// </summary>
public static class SecurityStatusProjection
{
    /// <summary>Segoe Fluent "Security" glyph — the web <c>Shield</c> / <c>ShieldCheck</c> icon (title, sentry, empty).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Lock" glyph — the web <c>Lock</c> icon (locked lock cell).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Unlock" glyph — the web <c>Unlock</c> icon (unlocked lock cell).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>Segoe Fluent "Permissions" glyph — the web <c>DoorOpen</c> icon (doors cell).</summary>
    public const string DoorGlyph = "\uE8D7";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph — the web <c>AppWindow</c> icon (windows cell).</summary>
    public const string WindowGlyph = "\uE8A7";

    /// <summary>The exact closed literal the web compares a window field against (web <c>!== 'closed'</c>).</summary>
    public const string ClosedLiteral = "closed";

    /// <summary>The substring the web tests each door part for (web <c>s.toLowerCase().includes('open')</c>).</summary>
    public const string OpenSubstring = "open";

    /// <summary>
    /// Count the open doors exactly as the web does: a native boolean <see langword="true"/>
    /// <c>door_state</c> counts as one open door (web <c>doorBoolOpen ? ['open']</c>); otherwise the string is
    /// split on commas, each part trimmed and dropped when empty (web <c>map(trim).filter(Boolean)</c>), and the
    /// surviving parts whose lower-cased form contains <c>"open"</c> are counted
    /// (web <c>filter(s =&gt; s.toLowerCase().includes('open'))</c>). Every non-text, non-true shape counts zero.
    /// </summary>
    public static int OpenDoorCount(SecurityScalar doorState)
    {
        if (doorState.IsBooleanTrue)
        {
            return 1;
        }

        if (doorState.Kind != SecurityScalarKind.Text)
        {
            return 0;
        }

        int count = 0;
        foreach (var segment in doorState.TextValue!.Split(','))
        {
            string trimmed = segment.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (trimmed.ToLowerInvariant().Contains(OpenSubstring, StringComparison.Ordinal))
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>
    /// Decide whether one window field is open exactly as the web does: a native boolean returns its own value
    /// (web <c>typeof val === 'boolean' ? val</c>); a non-empty string is open when its lower-cased form is not
    /// <c>"closed"</c> (web <c>asNonEmptyString(val) &amp;&amp; s.toLowerCase() !== 'closed'</c>); every other
    /// shape (null / number / empty string / absent) is closed.
    /// </summary>
    public static bool IsWindowOpen(SecurityScalar window) => window.Kind switch
    {
        SecurityScalarKind.Boolean => window.BooleanValue,
        SecurityScalarKind.Text => !string.Equals(window.TextValue!.ToLowerInvariant(), ClosedLiteral, StringComparison.Ordinal),
        _ => false,
    };

    /// <summary>Count the open windows across the four fields (web <c>openWindows.length</c>).</summary>
    public static int OpenWindowCount(SecurityStatusReading reading)
    {
        ArgumentNullException.ThrowIfNull(reading);
        int count = 0;
        if (IsWindowOpen(reading.FdWindow))
        {
            count++;
        }

        if (IsWindowOpen(reading.FpWindow))
        {
            count++;
        }

        if (IsWindowOpen(reading.RdWindow))
        {
            count++;
        }

        if (IsWindowOpen(reading.RpWindow))
        {
            count++;
        }

        return count;
    }

    /// <summary>Project <paramref name="reading"/> into the four cells using the localizer for every label.</summary>
    public static SecurityStatusDisplay Project(SecurityStatusReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        int openDoors = OpenDoorCount(reading.DoorState);
        int openWindows = OpenWindowCount(reading);

        string openLabel = localizer.GetString("widget.open", "Open");
        string allClosed = localizer.GetString("widget.allClosed", "All Closed");

        var lockCell = Cell(
            id: "lock",
            label: localizer.GetString("widget.lock", "Lock"),
            status: reading.Locked ? StatusKind.Success : StatusKind.Danger,
            value: reading.Locked
                ? localizer.GetString("widget.locked", "Locked")
                : localizer.GetString("widget.unlocked", "Unlocked"),
            glyph: reading.Locked ? LockGlyph : UnlockGlyph);

        var sentryCell = Cell(
            id: "sentry",
            label: localizer.GetString("widget.sentry", "Sentry"),
            status: reading.SentryMode ? StatusKind.Success : StatusKind.Neutral,
            value: reading.SentryMode
                ? localizer.GetString("widget.active", "Active")
                : localizer.GetString("widget.off", "Off"),
            glyph: ShieldGlyph);

        var doorsCell = Cell(
            id: "doors",
            label: localizer.GetString("widget.doors", "Doors"),
            status: openDoors == 0 ? StatusKind.Success : StatusKind.Warning,
            value: openDoors == 0 ? allClosed : OpenSummary(openDoors, openLabel),
            glyph: DoorGlyph);

        var windowsCell = Cell(
            id: "windows",
            label: localizer.GetString("widget.windows", "Windows"),
            status: openWindows == 0 ? StatusKind.Success : StatusKind.Warning,
            value: openWindows == 0 ? allClosed : OpenSummary(openWindows, openLabel),
            glyph: WindowGlyph);

        var cells = new[] { lockCell, sentryCell, doorsCell, windowsCell };
        string automation = string.Join(", ", cells.Select(static c => c.AutomationName));

        return new SecurityStatusDisplay(cells, automation);
    }

    // Web parity: `${openDoors.length} ${t('widget.open', 'Open')}` (e.g. "2 Open").
    private static string OpenSummary(int count, string openLabel) =>
        string.Create(CultureInfo.InvariantCulture, $"{count} {openLabel}");

    private static SecurityStatusCell Cell(string id, string label, StatusKind status, string value, string glyph) =>
        new(id, label, status, value, glyph, $"{label} {value}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;SecurityStatusReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no security object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{securityData ? … : empty}</c>
/// gate. Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SecurityStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s security payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<SecurityStatusReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SecurityStatusReading? Parse() =>
            raw.HasValue ? SecurityStatusReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SecurityStatusReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<SecurityStatusReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SecurityStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<SecurityStatusReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SecurityStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<SecurityStatusReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<SecurityStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<SecurityStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<SecurityStatusReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<SecurityStatusReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<SecurityStatusReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
