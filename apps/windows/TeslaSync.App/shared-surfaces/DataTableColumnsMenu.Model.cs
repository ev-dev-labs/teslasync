using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A single column the chooser can show or hide — the native mirror of the web <c>ColumnDescriptor</c>
/// (web/src/components/ui/DataTableColumnsMenu.tsx L6-L11): a stable <see cref="Key"/>, the user-visible
/// <see cref="Header"/> (the web row falls back to the key when the header is blank, via
/// <c>col.header || col.key</c>) and the <see cref="Required"/> flag for columns that can never be hidden
/// (web "selection / expand" columns). A plain record so the chooser logic is verified without a XAML host —
/// the WinUI atomic <c>TsDataColumn</c> is a dependency object and is intentionally NOT used by this surface.
/// </summary>
/// <param name="Key">Stable column key persisted in the visible-key set.</param>
/// <param name="Header">Localized, user-visible column header; blank falls back to <paramref name="Key"/>.</param>
/// <param name="Required">When true the column can never be hidden (web <c>required</c>); its row is disabled.</param>
public sealed record DataTableColumnDescriptor(string Key, string? Header = null, bool Required = false);

/// <summary>
/// Canonical metadata + i18n keys for the DataTableColumnsMenu surface — the native mirror of the web
/// <c>DataTableColumnsMenu</c> (web/src/components/ui/DataTableColumnsMenu.tsx). The web component is a popover
/// of column-visibility checkboxes: an icon "Columns" trigger that opens a <c>role="menu"</c> surface with a
/// "Visible columns" heading, a "Show all" action and one checkbox per column. This metadata carries the
/// diagnostics slug the surface registers under and every render-contract i18n key / fallback the web source
/// passes to <c>t()</c> (the four <c>table.columns.*</c> keys), so the native surface reproduces the web copy
/// verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the
/// keys exist in <c>Strings/{en,ar,he}/Resources.resw</c> / the shared i18n catalog) and resolves against the
/// English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class DataTableColumnsMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DataTableColumnsMenu";

    /// <summary>i18n key for the trigger + menu accessible name (web <c>table.columns.menu</c>).</summary>
    public const string MenuKey = "translation.table.columns.menu";

    /// <summary>English fallback for <see cref="MenuKey"/> (web second arg, verbatim).</summary>
    public const string MenuFallback = "Show or hide columns";

    /// <summary>i18n key for the trigger's visible label (web <c>table.columns.button</c>).</summary>
    public const string ButtonKey = "translation.table.columns.button";

    /// <summary>English fallback for <see cref="ButtonKey"/> (web second arg, verbatim).</summary>
    public const string ButtonFallback = "Columns";

    /// <summary>i18n key for the popover heading (web <c>table.columns.heading</c>).</summary>
    public const string HeadingKey = "translation.table.columns.heading";

    /// <summary>English fallback for <see cref="HeadingKey"/> (web second arg, verbatim).</summary>
    public const string HeadingFallback = "Visible columns";

    /// <summary>i18n key for the "show every column" action (web <c>table.columns.showAll</c>).</summary>
    public const string ShowAllKey = "translation.table.columns.showAll";

    /// <summary>English fallback for <see cref="ShowAllKey"/> (web second arg, verbatim).</summary>
    public const string ShowAllFallback = "Show all";

    /// <summary>Localized trigger / menu accessible name (web <c>t('table.columns.menu', 'Show or hide columns')</c>).</summary>
    public static string Menu(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(MenuKey, MenuFallback);
    }

    /// <summary>Localized trigger label (web <c>t('table.columns.button', 'Columns')</c>).</summary>
    public static string Button(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ButtonKey, ButtonFallback);
    }

    /// <summary>Localized popover heading (web <c>t('table.columns.heading', 'Visible columns')</c>).</summary>
    public static string Heading(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(HeadingKey, HeadingFallback);
    }

    /// <summary>Localized show-all action label (web <c>t('table.columns.showAll', 'Show all')</c>).</summary>
    public static string ShowAll(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ShowAllKey, ShowAllFallback);
    }
}

/// <summary>
/// One rendered checkbox row — the native projection of a web column <c>&lt;li&gt;&lt;label&gt;&lt;input
/// type="checkbox" /&gt;&lt;/label&gt;&lt;/li&gt;</c> (web/src/components/ui/DataTableColumnsMenu.tsx
/// L117-L139). <see cref="IsChecked"/> mirrors <c>visibleSet.has(col.key)</c>; <see cref="IsDisabled"/> mirrors
/// the web <c>col.required || (checked &amp;&amp; visibleKeys.length &lt;= 1)</c> so required columns and the
/// final visible column cannot be toggled off; <see cref="Label"/> is the web <c>col.header || col.key</c>.
/// </summary>
/// <param name="Key">The owning column's stable key.</param>
/// <param name="Label">The visible label (header, or key when the header is blank).</param>
/// <param name="IsChecked">True when the column is currently visible.</param>
/// <param name="IsDisabled">True when the row cannot be toggled (required, or the last visible column).</param>
public sealed record DataTableColumnRow(string Key, string Label, bool IsChecked, bool IsDisabled);

/// <summary>
/// The render-ready projection of the chooser inputs — the native analogue of what the web
/// <c>DataTableColumnsMenu</c> renders for a given <c>columns</c> / <c>visibleKeys</c> set
/// (web/src/components/ui/DataTableColumnsMenu.tsx L71-L144). The WinUI view consumes this and never
/// recomputes; the headless tests assert it directly. The web primitive is a controlled, presentational
/// popover with no query-freshness or connectivity concept, so it has no loading / error / stale / offline
/// chrome to reproduce; the only data-driven branch is the no-column set (<see cref="IsEmpty"/>), which the
/// native surface renders as the heading chrome over an empty list rather than a blank box (the web source
/// likewise always renders the heading + "Show all" and an empty <c>&lt;ul&gt;</c>).
/// </summary>
public sealed class DataTableColumnsMenuDisplay
{
    internal DataTableColumnsMenuDisplay(
        string menuLabel,
        string buttonLabel,
        string headingLabel,
        string showAllLabel,
        IReadOnlyList<DataTableColumnRow> rows,
        bool isEmpty)
    {
        MenuLabel = menuLabel;
        ButtonLabel = buttonLabel;
        HeadingLabel = headingLabel;
        ShowAllLabel = showAllLabel;
        Rows = rows;
        IsEmpty = isEmpty;
    }

    /// <summary>The trigger's + menu's Narrator name (web <c>aria-label</c> "Show or hide columns").</summary>
    public string MenuLabel { get; }

    /// <summary>The trigger's visible label (web "Columns").</summary>
    public string ButtonLabel { get; }

    /// <summary>The popover heading (web "Visible columns").</summary>
    public string HeadingLabel { get; }

    /// <summary>The show-all action label (web "Show all").</summary>
    public string ShowAllLabel { get; }

    /// <summary>One checkbox row per column, in column order (never null).</summary>
    public IReadOnlyList<DataTableColumnRow> Rows { get; }

    /// <summary>True when there are no columns — the popover shows the heading over an empty list.</summary>
    public bool IsEmpty { get; }
}

/// <summary>
/// Pure, UI-thread-free projection + visibility math for the DataTableColumnsMenu — the native port of the web
/// component body (web/src/components/ui/DataTableColumnsMenu.tsx L55-L69, L116-L141). <see cref="Project"/>
/// resolves every localized string through the <see cref="ILocalizer"/> and computes each row's checked /
/// disabled state; <see cref="ComputeToggle"/> and <see cref="ComputeShowAll"/> reproduce the web
/// <c>toggle</c> / <c>showAll</c> handlers exactly. It touches no view framework, so both the WinUI view and
/// the unit tests share one source of truth.
/// </summary>
public static class DataTableColumnsMenuProjection
{
    /// <summary>
    /// Project the inputs against <paramref name="localizer"/>. Null inputs are treated as empty so the view
    /// never dereferences null. A row is checked when its key is in <paramref name="visibleKeys"/> and disabled
    /// when the column is required or it is the only remaining visible column (web
    /// <c>col.required || (checked &amp;&amp; visibleKeys.length &lt;= 1)</c>); the label falls back to the key
    /// when the header is blank (web <c>col.header || col.key</c>).
    /// </summary>
    public static DataTableColumnsMenuDisplay Project(
        IReadOnlyList<DataTableColumnDescriptor>? columns,
        IReadOnlyList<string>? visibleKeys,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<DataTableColumnDescriptor> safeColumns = columns ?? Array.Empty<DataTableColumnDescriptor>();
        IReadOnlyList<string> safeVisible = visibleKeys ?? Array.Empty<string>();
        var visibleSet = new HashSet<string>(safeVisible, StringComparer.Ordinal);

        var rows = new List<DataTableColumnRow>(safeColumns.Count);
        for (int i = 0; i < safeColumns.Count; i++)
        {
            DataTableColumnDescriptor column = safeColumns[i];
            bool isChecked = visibleSet.Contains(column.Key);
            bool isDisabled = column.Required || (isChecked && safeVisible.Count <= 1);
            string label = string.IsNullOrEmpty(column.Header) ? column.Key : column.Header!;
            rows.Add(new DataTableColumnRow(column.Key, label, isChecked, isDisabled));
        }

        return new DataTableColumnsMenuDisplay(
            DataTableColumnsMenuRegistration.Menu(localizer),
            DataTableColumnsMenuRegistration.Button(localizer),
            DataTableColumnsMenuRegistration.Heading(localizer),
            DataTableColumnsMenuRegistration.ShowAll(localizer),
            rows,
            safeColumns.Count == 0);
    }

    /// <summary>
    /// Compute the next visible-key set for toggling <paramref name="key"/> — the native port of the web
    /// <c>toggle</c> handler (web L57-L67). When the key is currently visible it is removed, EXCEPT when it is
    /// the last visible column, in which case the toggle is a no-op and <see langword="null"/> is returned (web
    /// <c>if (visibleKeys.length &lt;= 1) return</c>) so the caller skips the change. When the key is hidden the
    /// set is rebuilt in column order to keep the persisted order stable (web
    /// <c>order.filter(k =&gt; visibleSet.has(k) || k === key)</c>).
    /// </summary>
    public static IReadOnlyList<string>? ComputeToggle(
        IReadOnlyList<DataTableColumnDescriptor>? columns,
        IReadOnlyList<string>? visibleKeys,
        string key)
    {
        IReadOnlyList<DataTableColumnDescriptor> safeColumns = columns ?? Array.Empty<DataTableColumnDescriptor>();
        IReadOnlyList<string> safeVisible = visibleKeys ?? Array.Empty<string>();
        var visibleSet = new HashSet<string>(safeVisible, StringComparer.Ordinal);

        if (visibleSet.Contains(key))
        {
            // Never hide the last visible column — at least one must stay (web early return).
            if (safeVisible.Count <= 1)
            {
                return null;
            }

            var next = new List<string>(safeVisible.Count - 1);
            for (int i = 0; i < safeVisible.Count; i++)
            {
                if (!string.Equals(safeVisible[i], key, StringComparison.Ordinal))
                {
                    next.Add(safeVisible[i]);
                }
            }

            return next;
        }

        // Showing a hidden column: rebuild from column order so the persisted list stays in column order.
        var shown = new List<string>(safeColumns.Count);
        for (int i = 0; i < safeColumns.Count; i++)
        {
            string columnKey = safeColumns[i].Key;
            if (visibleSet.Contains(columnKey) || string.Equals(columnKey, key, StringComparison.Ordinal))
            {
                shown.Add(columnKey);
            }
        }

        return shown;
    }

    /// <summary>
    /// Compute the visible-key set that shows every column, in column order — the native port of the web
    /// <c>showAll</c> handler (web L69: <c>onChange(columns.map((c) =&gt; c.key))</c>).
    /// </summary>
    public static IReadOnlyList<string> ComputeShowAll(IReadOnlyList<DataTableColumnDescriptor>? columns)
    {
        IReadOnlyList<DataTableColumnDescriptor> safeColumns = columns ?? Array.Empty<DataTableColumnDescriptor>();
        var keys = new List<string>(safeColumns.Count);
        for (int i = 0; i < safeColumns.Count; i++)
        {
            keys.Add(safeColumns[i].Key);
        }

        return keys;
    }
}

/// <summary>
/// PII-safe diagnostics for the DataTableColumnsMenu surface (P1/S11 diagnostics contract). Column keys and
/// headers can carry user-facing content, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never a column key, header or the visible-key
/// set. Thread-safe; mirrors the other shared-surface diagnostics collectors.
/// </summary>
public sealed class DataTableColumnsMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DataTableColumnsMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DataTableColumnsMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DataTableColumnsMenuRegistration.Slug}");
    }
}
