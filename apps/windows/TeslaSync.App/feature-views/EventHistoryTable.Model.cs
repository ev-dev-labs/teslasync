using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SecurityAccess;

/// <summary>
/// The shape a single security signal arrives in — the native union of the web
/// <c>string | boolean | null</c> field type on <c>SecurityEvent</c>
/// (<c>web/src/types/admin.ts</c>). The backend serialises raw <c>signal.SignalValue</c> values, so a
/// nominally string-like field (door state, sentry mode, a window) can arrive as a boolean; the helpers
/// branch on this discriminator exactly as the web source's <c>typeof</c> checks do.
/// </summary>
public enum SecuritySignalKind
{
    /// <summary>The field was absent / null (web <c>null</c>).</summary>
    None,

    /// <summary>The field arrived as a native boolean (web <c>typeof === 'boolean'</c>).</summary>
    Boolean,

    /// <summary>The field arrived as a string (web <c>typeof === 'string'</c>, including the empty string).</summary>
    Text,
}

/// <summary>
/// One security signal value — the native mirror of a web <c>string | boolean | null</c> field on
/// <c>SecurityEvent</c>. Pure data so the projection and helpers are unit-tested without a UI host.
/// </summary>
/// <param name="Kind">Whether the value is absent, a boolean or a string.</param>
/// <param name="BooleanValue">The boolean payload when <see cref="Kind"/> is <see cref="SecuritySignalKind.Boolean"/>.</param>
/// <param name="TextValue">The string payload when <see cref="Kind"/> is <see cref="SecuritySignalKind.Text"/>.</param>
public readonly record struct SecuritySignal(SecuritySignalKind Kind, bool BooleanValue, string? TextValue)
{
    /// <summary>The absent / null signal (web <c>null</c>).</summary>
    public static SecuritySignal None => new(SecuritySignalKind.None, false, null);

    /// <summary>A boolean signal (web native <c>boolean</c>).</summary>
    public static SecuritySignal FromBoolean(bool value) => new(SecuritySignalKind.Boolean, value, null);

    /// <summary>A string signal; a native <see langword="null"/> collapses to <see cref="None"/> (web <c>null</c>).</summary>
    public static SecuritySignal FromText(string? value) =>
        value is null ? None : new(SecuritySignalKind.Text, false, value);

    /// <summary>
    /// JavaScript truthiness of the underlying value — the exact rule the web <c>row.sentryMode ? … : …</c> and
    /// <c>row.locked ? … : …</c> ternaries apply: a boolean is itself, a non-empty string is truthy, and
    /// <see langword="null"/> / the empty string are falsy.
    /// </summary>
    public bool IsTruthy => Kind switch
    {
        SecuritySignalKind.Boolean => BooleanValue,
        SecuritySignalKind.Text => !string.IsNullOrEmpty(TextValue),
        _ => false,
    };

    /// <summary>
    /// The web <c>asNonEmptyString</c> projection: the string when this is a non-empty string, otherwise
    /// <see langword="null"/> (a boolean or null field yields <see langword="null"/>).
    /// </summary>
    public string? NonEmptyString =>
        Kind == SecuritySignalKind.Text && !string.IsNullOrEmpty(TextValue) ? TextValue : null;
}

/// <summary>
/// The parsed state of a single window — the native analogue of the web helper's
/// <c>WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown'</c>
/// (<c>web/src/features/admin/components/security-access/helpers.ts</c>).
/// </summary>
public enum SecurityWindowState
{
    /// <summary>Fully closed (web <c>'Closed'</c>).</summary>
    Closed,

    /// <summary>Cracked for ventilation (web <c>'Venting'</c>).</summary>
    Venting,

    /// <summary>Open (web <c>'Open'</c>).</summary>
    Open,

    /// <summary>Indeterminate — a non-string / empty value (web <c>'Unknown'</c>).</summary>
    Unknown,
}

/// <summary>
/// One security-event row — the native mirror of the subset of the web <c>SecurityEvent</c>
/// (<c>web/src/types/admin.ts</c>) the history table renders: the identity, the creation timestamp and the
/// lock / sentry / door / four-window signals. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The row identity (web <c>id</c>); the table keys rows on this.</param>
/// <param name="CreatedAt">The event timestamp (web <c>createdAt</c>); null renders the em-dash fallback.</param>
/// <param name="Locked">The lock state (web <c>locked</c>): true is locked, false / null is unlocked.</param>
/// <param name="SentryMode">The sentry-mode signal (web <c>sentryMode</c>).</param>
/// <param name="DoorState">The door-state signal (web <c>doorState</c>).</param>
/// <param name="FdWindow">Front-driver window (web <c>fdWindow</c>).</param>
/// <param name="FpWindow">Front-passenger window (web <c>fpWindow</c>).</param>
/// <param name="RdWindow">Rear-driver window (web <c>rdWindow</c>).</param>
/// <param name="RpWindow">Rear-passenger window (web <c>rpWindow</c>).</param>
public sealed record SecurityEventRow(
    string Id,
    DateTimeOffset? CreatedAt,
    bool? Locked,
    SecuritySignal SentryMode,
    SecuritySignal DoorState,
    SecuritySignal FdWindow,
    SecuritySignal FpWindow,
    SecuritySignal RdWindow,
    SecuritySignal RpWindow);

/// <summary>
/// The render-time data model the <c>EventHistoryTable</c> surface binds to — the native analogue of the web
/// component's <c>history</c> and <c>isLoading</c> props
/// (<c>web/src/features/admin/components/security-access/EventHistoryTable.tsx</c>). The web source is a pure
/// presentational component (it takes its rows + loading as props and performs no fetching), so the rendered
/// branch is a direct function of this model. Pure data — no WinUI types.
/// </summary>
/// <param name="History">The security-event rows to render (web <c>history</c>).</param>
/// <param name="IsLoading">Whether the parent is still loading (web <c>isLoading</c>); replaces the table with the skeleton.</param>
public sealed record EventHistoryTableModel(IReadOnlyList<SecurityEventRow> History, bool IsLoading)
{
    /// <summary>The initial empty, not-loading model.</summary>
    public static EventHistoryTableModel Empty { get; } = new(Array.Empty<SecurityEventRow>(), false);
}

/// <summary>
/// The mutually-exclusive branch the <c>EventHistoryTable</c> surface renders — the native union of the web
/// <c>{isLoading ? &lt;Skeleton/&gt; : &lt;DataTable …/&gt;}</c> control flow. Loading replaces the whole table
/// (so it takes precedence over the rows), then the empty message, then the rows. Every branch maps onto a
/// visible surface; none is hidden.
/// </summary>
public enum EventHistoryTableState
{
    /// <summary>The parent is loading (web <c>isLoading</c> truthy) — the eight-line skeleton replaces the table.</summary>
    Loading,

    /// <summary>Not loading and no rows (web <c>DataTable</c> <c>emptyMessage</c>) — the friendly empty surface.</summary>
    Empty,

    /// <summary>Not loading and one or more rows (web <c>data.length &gt; 0</c>) — the sorted, paged event table.</summary>
    Data,
}

/// <summary>
/// A declarative table-column descriptor (key + localized header + sortability) — the native, WinUI-free
/// analogue of the web <c>Column&lt;SecurityEvent&gt;</c> the table renders. Only the time column is
/// <see cref="Sortable"/> (web <c>sortable: true</c>).
/// </summary>
/// <param name="Key">The column key (verbatim from the web column <c>key</c>).</param>
/// <param name="Header">The localized header label.</param>
/// <param name="Sortable">Whether the column header toggles a sort (web <c>sortable</c>).</param>
public sealed record EventHistoryColumn(string Key, string Header, bool Sortable);

/// <summary>
/// A single projected, display-ready event row — the resolved badge statuses + labels, the door / window
/// status text and their closed/open colour intent, and the Narrator name for the row. Pure data so the
/// projection is asserted headlessly.
/// </summary>
/// <param name="Id">The row identity (web <c>keyExtractor={(row) =&gt; row.id}</c>).</param>
/// <param name="CreatedAt">The timestamp the view renders through its locale-aware time control.</param>
/// <param name="LockStatus">The lock badge status (web <c>variant</c>): success when locked, danger otherwise.</param>
/// <param name="LockText">The lock badge label (web Locked / Unlocked).</param>
/// <param name="SentryStatus">The sentry badge status: success when truthy, neutral otherwise.</param>
/// <param name="SentryText">The sentry badge label (web On / Off).</param>
/// <param name="DoorsClosed">Whether the doors are closed — drives the green (closed) / amber (open) colour.</param>
/// <param name="DoorsText">The door cell text (web <c>asNonEmptyString(doorState) ?? (closed ? Closed : —)</c>).</param>
/// <param name="WindowsClosed">Whether every window is closed — drives the green / amber colour.</param>
/// <param name="WindowsText">The window-summary text (web <c>windowSummary</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the whole row.</param>
public sealed record EventHistoryRowView(
    string Id,
    DateTimeOffset? CreatedAt,
    StatusKind LockStatus,
    string LockText,
    StatusKind SentryStatus,
    string SentryText,
    bool DoorsClosed,
    string DoorsText,
    bool WindowsClosed,
    string WindowsText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the table for one input model + sort + page — the native
/// analogue of what the web <c>EventHistoryTable</c> renders. Holds the resolved title, column headers, the
/// active time-sort direction, the current page's <see cref="Rows"/>, the empty message, and the pagination
/// metadata. Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record EventHistoryTableDisplay(
    EventHistoryTableState State,
    string Title,
    IReadOnlyList<EventHistoryColumn> Columns,
    IReadOnlyList<EventHistoryRowView> Rows,
    SortDirection TimeSortDirection,
    string EmptyMessage,
    bool ShowPagination,
    int Page,
    int PageCount,
    int PageSize,
    int TotalCount,
    int RangeStart,
    int RangeEnd,
    IReadOnlyList<int> PageSizeOptions,
    string FirstLabel,
    string PreviousLabel,
    string NextLabel,
    string LastLabel,
    string PageSizeLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="EventHistoryTableModel"/> (+ sort + page) to its
/// <see cref="EventHistoryTableDisplay"/> — the native port of
/// <c>web/src/features/admin/components/security-access/EventHistoryTable.tsx</c> and the
/// <c>./helpers.ts</c> it composes. It reproduces the web branch order (loading replaces the table, then
/// empty, then rows), the five columns with the sortable time column, the lock / sentry badge variants, the
/// <c>doorClosed</c> / <c>parseWindowState</c> / <c>windowSummary</c> helpers, and the
/// <c>{ defaultPageSize: 50 }</c> pagination over the web <c>DataTable</c> default page sizes. Every label
/// resolves through the i18n facade using the same keys the web source feeds <c>t()</c>, under the
/// <c>translation.</c> catalog namespace. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class EventHistoryTableProjection
{
    /// <summary>Time column key (web <c>key: 'createdAt'</c>); the only sortable column.</summary>
    public const string TimeColumnKey = "createdAt";

    /// <summary>Lock column key (web <c>key: 'locked'</c>).</summary>
    public const string LockColumnKey = "locked";

    /// <summary>Sentry column key (web <c>key: 'sentryMode'</c>).</summary>
    public const string SentryColumnKey = "sentryMode";

    /// <summary>Door column key (web <c>key: 'doorState'</c>).</summary>
    public const string DoorsColumnKey = "doorState";

    /// <summary>Windows column key (web <c>key: 'windows'</c>).</summary>
    public const string WindowsColumnKey = "windows";

    /// <summary>i18n key for the panel title (web <c>admin.security.eventHistory</c>).</summary>
    public const string TitleKey = "translation.admin.security.eventHistory";

    /// <summary>i18n key for the time column header (web <c>admin.security.col.time</c>).</summary>
    public const string TimeHeaderKey = "translation.admin.security.col.time";

    /// <summary>i18n key for the lock column header (web <c>admin.security.col.lock</c>).</summary>
    public const string LockHeaderKey = "translation.admin.security.col.lock";

    /// <summary>i18n key for the sentry column header (web <c>admin.security.col.sentry</c>).</summary>
    public const string SentryHeaderKey = "translation.admin.security.col.sentry";

    /// <summary>i18n key for the doors column header (web <c>admin.security.col.doors</c>).</summary>
    public const string DoorsHeaderKey = "translation.admin.security.col.doors";

    /// <summary>i18n key for the windows column header (web <c>admin.security.col.windows</c>).</summary>
    public const string WindowsHeaderKey = "translation.admin.security.col.windows";

    /// <summary>i18n key for the locked badge label (web <c>admin.security.locked</c>).</summary>
    public const string LockedKey = "translation.admin.security.locked";

    /// <summary>i18n key for the unlocked badge label (web <c>admin.security.unlocked</c>).</summary>
    public const string UnlockedKey = "translation.admin.security.unlocked";

    /// <summary>i18n key for the sentry-on badge label (web <c>admin.security.on</c>).</summary>
    public const string OnKey = "translation.admin.security.on";

    /// <summary>i18n key for the sentry-off badge label (web <c>admin.security.off</c>).</summary>
    public const string OffKey = "translation.admin.security.off";

    /// <summary>i18n key for the closed-door fallback label (web <c>admin.security.closed</c>).</summary>
    public const string ClosedKey = "translation.admin.security.closed";

    /// <summary>i18n key for the empty message (web <c>admin.security.noEvents</c>).</summary>
    public const string NoEventsKey = "translation.admin.security.noEvents";

    /// <summary>Default page size (web <c>pagination.defaultPageSize</c>).</summary>
    public const int DefaultPageSize = 50;

    private const string FirstLabelKey = "translation.pagination.first";
    private const string PreviousLabelKey = "translation.pagination.previous";
    private const string NextLabelKey = "translation.pagination.next";
    private const string LastLabelKey = "translation.pagination.last";
    private const string PageSizeLabelKey = "translation.pagination.pageSize";

    private const string EmDash = "\u2014";
    private const string AllClosedSummary = "All Closed";
    private const string OpenVentingSuffix = " Open/Venting";

    private static readonly int[] PageSizeOptionsValue = { 20, 50, 100 };

    /// <summary>Page-size choices (web <c>DataTable</c> default <c>pageSizeOptions</c>).</summary>
    public static IReadOnlyList<int> PageSizeOptions { get; } = Array.AsReadOnly(PageSizeOptionsValue);

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="sort">The time-column sort state (web <c>DataTable</c> sortable header).</param>
    /// <param name="page">The 1-based current page (web pagination).</param>
    /// <param name="pageSize">The current page size (web <c>defaultPageSize</c> default 50).</param>
    public static EventHistoryTableDisplay Project(
        EventHistoryTableModel model,
        ILocalizer localizer,
        TableSortState sort,
        int page,
        int pageSize)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(sort);

        string title = localizer.GetString(TitleKey, "Security Event History");
        string emptyMessage = localizer.GetString(NoEventsKey, "No security events recorded yet.");

        var columns = new EventHistoryColumn[]
        {
            new(TimeColumnKey, localizer.GetString(TimeHeaderKey, "Time"), true),
            new(LockColumnKey, localizer.GetString(LockHeaderKey, "Lock"), false),
            new(SentryColumnKey, localizer.GetString(SentryHeaderKey, "Sentry"), false),
            new(DoorsColumnKey, localizer.GetString(DoorsHeaderKey, "Doors"), false),
            new(WindowsColumnKey, localizer.GetString(WindowsHeaderKey, "Windows"), false),
        };

        // web: {isLoading ? <Skeleton/> : <DataTable .../>} — loading replaces the whole table.
        var state = model.IsLoading
            ? EventHistoryTableState.Loading
            : model.History.Count == 0 ? EventHistoryTableState.Empty : EventHistoryTableState.Data;

        var sorted = sort.Apply(model.History, static row => row.CreatedAt);

        var pagination = new PaginationState { PageSize = pageSize };
        pagination.Total = sorted.Count;
        pagination.Page = page;

        var rows = state == EventHistoryTableState.Data
            ? BuildRows(pagination.Slice(sorted), localizer)
            : Array.Empty<EventHistoryRowView>();

        string automationName = state switch
        {
            EventHistoryTableState.Loading => title,
            EventHistoryTableState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}\u2013{2} / {3}",
                title,
                pagination.RangeStart,
                pagination.RangeEnd,
                pagination.Total),
        };

        return new EventHistoryTableDisplay(
            State: state,
            Title: title,
            Columns: columns,
            Rows: rows,
            TimeSortDirection: sort.DirectionFor(TimeColumnKey),
            EmptyMessage: emptyMessage,
            ShowPagination: state == EventHistoryTableState.Data,
            Page: pagination.Page,
            PageCount: pagination.PageCount,
            PageSize: pagination.PageSize,
            TotalCount: pagination.Total,
            RangeStart: pagination.RangeStart,
            RangeEnd: pagination.RangeEnd,
            PageSizeOptions: PageSizeOptions,
            FirstLabel: localizer.GetString(FirstLabelKey, "First page"),
            PreviousLabel: localizer.GetString(PreviousLabelKey, "Previous page"),
            NextLabel: localizer.GetString(NextLabelKey, "Next page"),
            LastLabel: localizer.GetString(LastLabelKey, "Last page"),
            PageSizeLabel: localizer.GetString(PageSizeLabelKey, "Rows per page"),
            AutomationName: automationName);
    }

    /// <summary>
    /// Parse a single window field exactly as the web <c>parseWindowState</c> does: a boolean or null value
    /// (anything <c>asNonEmptyString</c> rejects) is <see cref="SecurityWindowState.Unknown"/>; a non-empty
    /// string lower-cases (no trim, matching the web) then maps <c>"closed"</c> / <c>"0"</c> to
    /// <see cref="SecurityWindowState.Closed"/>, a value containing <c>"vent"</c> to
    /// <see cref="SecurityWindowState.Venting"/>, and every other non-empty string to
    /// <see cref="SecurityWindowState.Open"/>.
    /// </summary>
    public static SecurityWindowState ParseWindowState(SecuritySignal value)
    {
        string? raw = value.NonEmptyString;
        if (raw is null)
        {
            return SecurityWindowState.Unknown;
        }

        string lower = raw.ToLowerInvariant();
        if (lower == "closed" || lower == "0")
        {
            return SecurityWindowState.Closed;
        }

        if (lower.Contains("vent", StringComparison.Ordinal))
        {
            return SecurityWindowState.Venting;
        }

        // web: `lower.includes('open') || lower !== '0'` — '0' already returned Closed, so any remaining
        // non-empty string falls here as Open; the trailing Unknown is unreachable for a non-empty string.
        if (lower.Contains("open", StringComparison.Ordinal) || lower != "0")
        {
            return SecurityWindowState.Open;
        }

        return SecurityWindowState.Unknown;
    }

    /// <summary>
    /// Whether the door state reads closed — the native port of the web <c>doorClosed</c>. Null and the empty
    /// string are closed; a boolean is closed when false; a string is closed when (trimmed, lower-cased) it is
    /// empty / <c>"closed"</c> / <c>"closedall"</c> / <c>"0"</c> / <c>"false"</c>, or when it is a JSON object
    /// literal whose every value is <see langword="false"/> / null; everything else is open.
    /// </summary>
    public static bool DoorClosed(SecuritySignal state)
    {
        switch (state.Kind)
        {
            case SecuritySignalKind.None:
                return true;

            case SecuritySignalKind.Boolean:
                return !state.BooleanValue;

            default:
                string? raw = state.NonEmptyString;
                if (raw is null)
                {
                    return true;
                }

                string lower = raw.Trim().ToLowerInvariant();
                if (lower.Length == 0 || lower == "closed" || lower == "closedall" || lower == "0" || lower == "false")
                {
                    return true;
                }

                if (lower.StartsWith('{') && AllJsonValuesFalseOrNull(raw))
                {
                    return true;
                }

                return false;
        }
    }

    /// <summary>
    /// Whether every window is closed — the native port of the web <c>allWindowsClosed</c>: the four corners
    /// each run through <see cref="ParseWindowState"/> and all must be <see cref="SecurityWindowState.Closed"/>.
    /// </summary>
    public static bool AllWindowsClosed(SecurityEventRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return ParseWindowState(row.FdWindow) == SecurityWindowState.Closed
            && ParseWindowState(row.FpWindow) == SecurityWindowState.Closed
            && ParseWindowState(row.RdWindow) == SecurityWindowState.Closed
            && ParseWindowState(row.RpWindow) == SecurityWindowState.Closed;
    }

    /// <summary>
    /// The window-summary cell text — the native port of the web <c>windowSummary</c>: <c>"All Closed"</c> when
    /// every corner is closed, otherwise <c>"{openCount} Open/Venting"</c>. These derived status strings mirror
    /// the web helper verbatim; like the web source it does not route them through i18n.
    /// </summary>
    public static string WindowSummary(SecurityEventRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        var states = new[]
        {
            ParseWindowState(row.FdWindow),
            ParseWindowState(row.FpWindow),
            ParseWindowState(row.RdWindow),
            ParseWindowState(row.RpWindow),
        };

        int openCount = 0;
        foreach (var s in states)
        {
            if (s != SecurityWindowState.Closed)
            {
                openCount++;
            }
        }

        return openCount == 0
            ? AllClosedSummary
            : string.Concat(openCount.ToString(CultureInfo.CurrentCulture), OpenVentingSuffix);
    }

    private static IReadOnlyList<EventHistoryRowView> BuildRows(
        IReadOnlyList<SecurityEventRow> rows,
        ILocalizer localizer)
    {
        if (rows.Count == 0)
        {
            return Array.Empty<EventHistoryRowView>();
        }

        string lockedLabel = localizer.GetString(LockedKey, "Locked");
        string unlockedLabel = localizer.GetString(UnlockedKey, "Unlocked");
        string onLabel = localizer.GetString(OnKey, "On");
        string offLabel = localizer.GetString(OffKey, "Off");
        string closedLabel = localizer.GetString(ClosedKey, "Closed");

        var result = new List<EventHistoryRowView>(rows.Count);
        foreach (var row in rows)
        {
            bool locked = row.Locked == true;
            bool sentryOn = row.SentryMode.IsTruthy;
            bool doorsClosed = DoorClosed(row.DoorState);
            bool windowsClosed = AllWindowsClosed(row);

            string lockText = locked ? lockedLabel : unlockedLabel;
            string sentryText = sentryOn ? onLabel : offLabel;
            string doorsText = row.DoorState.NonEmptyString ?? (doorsClosed ? closedLabel : EmDash);
            string windowsText = WindowSummary(row);

            string timeText = DateTimeFormatting.Format(row.CreatedAt, DateTimeVariant.Full, DateTimeOffset.Now);

            string automationName = string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}. {2}. {3}. {4}",
                timeText,
                lockText,
                sentryText,
                doorsText,
                windowsText);

            result.Add(new EventHistoryRowView(
                Id: row.Id,
                CreatedAt: row.CreatedAt,
                LockStatus: locked ? StatusKind.Success : StatusKind.Danger,
                LockText: lockText,
                SentryStatus: sentryOn ? StatusKind.Success : StatusKind.Neutral,
                SentryText: sentryText,
                DoorsClosed: doorsClosed,
                DoorsText: doorsText,
                WindowsClosed: windowsClosed,
                WindowsText: windowsText,
                AutomationName: automationName));
        }

        return result;
    }

    private static bool AllJsonValuesFalseOrNull(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (property.Value.ValueKind is not (JsonValueKind.False or JsonValueKind.Null))
                {
                    return false;
                }
            }

            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>EventHistoryTable</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never an event timestamp, lock state or
/// any other row value — so a diagnostics line can never leak a vehicle's security history. Thread-safe.
/// </summary>
public sealed class EventHistoryTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EventHistoryTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EventHistoryTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EventHistoryTableRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>EventHistoryTable</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/security-access/EventHistoryTable.tsx</c>.
/// </summary>
public static class EventHistoryTableRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EventHistoryTable";
}
