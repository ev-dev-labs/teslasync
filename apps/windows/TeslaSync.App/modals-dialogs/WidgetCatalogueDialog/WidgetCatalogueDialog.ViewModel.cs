using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WidgetCatalogueDialog"/> view — the native port of the
/// web component's hook composition (web/src/features/dashboard/components/WidgetCatalogueDialog.tsx). It composes
/// the static widget catalogue (web <c>WIDGET_REGISTRY</c>), the set of widgets already on the active dashboard
/// (the web <c>activeWidgetIds</c> prop → <c>activeSet</c>) and the localizer (web <c>useTranslation</c>); holds the
/// live search box (web <c>query</c> state); and projects them through <see cref="WidgetCatalogueProjection"/> into
/// the ordered, grouped, search-filtered catalogue the view renders. The search resets every time the dialog opens
/// (web <c>useEffect(() =&gt; { if (open) setQuery('') })</c>); opening records the <c>view.opened</c> diagnostic.
/// Picking a widget that is not already added raises <see cref="WidgetAddRequested"/> and <see cref="CloseRequested"/>
/// (web <c>onAdd(widgetId); onClose();</c>); picking an already-added widget is a no-op (web early return). Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class WidgetCatalogueDialogViewModel : INotifyPropertyChanged
{
    private readonly IWidgetCatalogue _catalogue;
    private readonly ILocalizer _localizer;
    private readonly WidgetCatalogueDialogDiagnostics _diagnostics;
    private readonly HashSet<string> _active = new(StringComparer.Ordinal);

    private string _search = string.Empty;
    private bool _opened;
    private IReadOnlyList<WidgetCatalogueGroup> _groups = Array.Empty<WidgetCatalogueGroup>();
    private int _visibleCount;
    private WidgetCatalogueState _state = WidgetCatalogueState.Loading;

    /// <summary>Creates the holder over the catalogue, localizer and (optional) diagnostics.</summary>
    /// <param name="catalogue">The widget catalogue seam (web <c>WIDGET_REGISTRY</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public WidgetCatalogueDialogViewModel(
        IWidgetCatalogue catalogue,
        ILocalizer localizer,
        WidgetCatalogueDialogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(catalogue);
        ArgumentNullException.ThrowIfNull(localizer);
        _catalogue = catalogue;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetCatalogueDialogDiagnostics();
        Reproject();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user picks a not-yet-added widget (web <c>onAdd(widgetId)</c>); carries its id.</summary>
    public event EventHandler<string>? WidgetAddRequested;

    /// <summary>Raised after a successful add so the dialog dismisses (web <c>onClose()</c> after <c>onAdd</c>).</summary>
    public event EventHandler? CloseRequested;

    // ── Render state ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The body's lifecycle state (loading / loaded / empty). See <see cref="WidgetCatalogueState"/>.</summary>
    public WidgetCatalogueState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(IsLoading));
                Raise(nameof(IsEmpty));
                Raise(nameof(HasGroups));
            }
        }
    }

    /// <summary>The projected, ordered, grouped, search-filtered sections (web <c>filteredEntries</c>).</summary>
    public IReadOnlyList<WidgetCatalogueGroup> Groups
    {
        get => _groups;
        private set => Set(ref _groups, value);
    }

    /// <summary>True while still in the initial pre-open tick.</summary>
    public bool IsLoading => _state == WidgetCatalogueState.Loading;

    /// <summary>True when a search is active and nothing matches (web empty panel).</summary>
    public bool IsEmpty => _state == WidgetCatalogueState.Empty;

    /// <summary>True when at least one category section is shown.</summary>
    public bool HasGroups => _state == WidgetCatalogueState.Loaded;

    // ── Counts (web totalCount / addedCount / visibleCount) ────────────────────────────────────────────────

    /// <summary>Total number of catalogue widgets (web <c>WIDGET_REGISTRY.length</c>).</summary>
    public int TotalCount => _catalogue.Entries.Count;

    /// <summary>Number of widgets already on the active dashboard (web <c>activeSet.size</c>).</summary>
    public int AddedCount => _active.Count;

    /// <summary>Number of widgets currently visible after the search filter (web <c>visibleCount</c>).</summary>
    public int VisibleCount => _visibleCount;

    /// <summary>True while a non-blank search is active (web <c>isFiltering</c>).</summary>
    public bool IsFiltering => _search.Trim().Length > 0;

    // ── Search (web query state) ───────────────────────────────────────────────────────────────────────────

    /// <summary>The live search query (web <c>query</c>). Setting it re-projects + recomputes the result count.</summary>
    public string Search
    {
        get => _search;
        set
        {
            string next = value ?? string.Empty;
            if (Set(ref _search, next))
            {
                Raise(nameof(IsFiltering));
                Reproject();
            }
        }
    }

    // ── Localized copy (the Narrator-label source) ─────────────────────────────────────────────────────────

    /// <summary>Modal title (web <c>dashboard.catalogue.title</c>).</summary>
    public string Title => WidgetCatalogueRegistration.Title(_localizer);

    /// <summary>Subtitle with the live added / total counts (web <c>dashboard.catalogue.subtitle</c>).</summary>
    public string Subtitle => WidgetCatalogueRegistration.Subtitle(_localizer, AddedCount, TotalCount);

    /// <summary>Search-field prompt (the web catalogue search hint).</summary>
    public string SearchPrompt => WidgetCatalogueRegistration.SearchPrompt(_localizer);

    /// <summary>Search field accessible label (web <c>dashboard.catalogue.searchLabel</c>).</summary>
    public string SearchLabel => WidgetCatalogueRegistration.SearchLabel(_localizer);

    /// <summary>Live result-count line, shown only while filtering (web <c>dashboard.catalogue.resultCount</c>).</summary>
    public string ResultCountText => WidgetCatalogueRegistration.ResultCount(_localizer, VisibleCount, TotalCount);

    /// <summary>Empty-state title (web <c>dashboard.catalogue.emptyTitle</c>).</summary>
    public string EmptyTitle => WidgetCatalogueRegistration.EmptyTitle(_localizer);

    /// <summary>Empty-state body with the total interpolated (web <c>dashboard.catalogue.emptyBody</c>).</summary>
    public string EmptyBody => WidgetCatalogueRegistration.EmptyBody(_localizer, TotalCount);

    /// <summary>Clear-search button label (web <c>dashboard.catalogue.clearSearch</c>).</summary>
    public string ClearSearchLabel => WidgetCatalogueRegistration.ClearSearch(_localizer);

    /// <summary>The "Added" badge / disabled-button label (web <c>dashboard.added</c>).</summary>
    public string AddedLabel => WidgetCatalogueRegistration.Added(_localizer);

    /// <summary>The default "Add" button label (web <c>dashboard.catalogue.add</c>).</summary>
    public string AddActionLabel => WidgetCatalogueRegistration.Add(_localizer);

    // ── Per-entry display (web per-card derivations) ───────────────────────────────────────────────────────

    /// <summary>True when <paramref name="widgetId"/> is already on the active dashboard (web <c>activeSet.has(id)</c>).</summary>
    public bool IsAdded(string widgetId) => widgetId is not null && _active.Contains(widgetId);

    /// <summary>The card's Add button label — "Added" when present, else "Add" (web <c>isAdded ? Added : Add</c>).</summary>
    public string AddButtonLabel(WidgetCatalogueEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return IsAdded(entry.Id) ? AddedLabel : AddActionLabel;
    }

    /// <summary>
    /// The card's Add button Narrator label, always "Add {name} widget" (web
    /// <c>aria-label={t('dashboard.catalogue.addLabel', 'Add {{name}} widget', { name })}</c>).
    /// </summary>
    public string AddAccessibleName(WidgetCatalogueEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return WidgetCatalogueRegistration.AddLabel(_localizer, entry.Name);
    }

    /// <summary>The localized per-section heading count suffix, e.g. <c>(3)</c> (web <c>({widgets.length})</c>).</summary>
    public static string SectionCountLabel(WidgetCatalogueGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        return string.Create(System.Globalization.CultureInfo.CurrentCulture, $"({group.Entries.Count})");
    }

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Replace the set of widgets already on the active dashboard (web <c>activeWidgetIds</c> prop). Null ids are
    /// ignored; updates the added count, subtitle and every card's added state.
    /// </summary>
    public void SetActiveWidgets(IEnumerable<string>? widgetIds)
    {
        _active.Clear();
        if (widgetIds is not null)
        {
            foreach (string id in widgetIds)
            {
                if (!string.IsNullOrEmpty(id))
                {
                    _active.Add(id);
                }
            }
        }

        Raise(nameof(AddedCount));
        Raise(nameof(Subtitle));
        Raise(nameof(ActiveWidgetsVersion));
    }

    /// <summary>
    /// Monotonically-meaningful change token raised whenever the active-widget set changes, so the view can
    /// refresh every card's Added badge / disabled state without re-projecting the (unchanged) groups.
    /// </summary>
    public object ActiveWidgetsVersion => _active;

    /// <summary>
    /// Open the catalogue: reset the live search box so a stale query never hides the catalogue on the next open
    /// (web <c>useEffect(() =&gt; { if (open) setQuery('') })</c>), record the <c>view.opened</c> diagnostic and
    /// project. Idempotent re-entry simply re-resets the search.
    /// </summary>
    public void Open()
    {
        _opened = true;
        _search = string.Empty;
        Raise(nameof(Search));
        Raise(nameof(IsFiltering));
        _diagnostics.RecordViewOpened();
        Reproject();
    }

    /// <summary>Close the catalogue, clearing the live search so the next open starts fresh (web open/close reset).</summary>
    public void Close()
    {
        if (_search.Length > 0)
        {
            _search = string.Empty;
            Raise(nameof(Search));
            Raise(nameof(IsFiltering));
        }

        Reproject();
    }

    /// <summary>
    /// Pick a widget from the catalogue (web <c>handleAdd</c>): an already-added id is a no-op (web early return);
    /// otherwise raise <see cref="WidgetAddRequested"/> then <see cref="CloseRequested"/> (web <c>onAdd</c> +
    /// <c>onClose</c>). Returns true only when the widget was actually requested.
    /// </summary>
    public bool Add(string widgetId)
    {
        if (string.IsNullOrEmpty(widgetId) || _active.Contains(widgetId))
        {
            return false;
        }

        WidgetAddRequested?.Invoke(this, widgetId);
        CloseRequested?.Invoke(this, EventArgs.Empty);
        return true;
    }

    /// <summary>Clear the live search box (web empty-state <c>Clear search</c> → <c>setQuery('')</c>).</summary>
    public void ClearSearch() => Search = string.Empty;

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────────

    private void Reproject()
    {
        IReadOnlyList<WidgetCatalogueGroup> groups =
            WidgetCatalogueProjection.Project(_catalogue.Entries, _localizer, _search);
        int visible = WidgetCatalogueProjection.VisibleCount(groups);

        Groups = groups;
        if (Set(ref _visibleCount, visible))
        {
            Raise(nameof(VisibleCount));
            Raise(nameof(ResultCountText));
        }

        State = !_opened
            ? WidgetCatalogueState.Loading
            : IsFiltering && visible == 0
                ? WidgetCatalogueState.Empty
                : WidgetCatalogueState.Loaded;
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
