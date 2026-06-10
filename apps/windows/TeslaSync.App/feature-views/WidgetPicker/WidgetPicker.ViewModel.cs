using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>Event payload carrying the widget ids an add action targets (web <c>onAddWidgets(ids)</c>).</summary>
public sealed class WidgetAddEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="widgetIds"/>.</summary>
    /// <param name="widgetIds">The de-duplicated, addable widget ids.</param>
    public WidgetAddEventArgs(IReadOnlyList<string> widgetIds)
    {
        ArgumentNullException.ThrowIfNull(widgetIds);
        WidgetIds = widgetIds;
    }

    /// <summary>The de-duplicated, addable widget ids (web <c>addableIds</c>).</summary>
    public IReadOnlyList<string> WidgetIds { get; }
}

/// <summary>Event payload carrying the preset id an apply action targets (web <c>onApplyPreset(id)</c>).</summary>
public sealed class WidgetPresetEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="presetId"/>.</summary>
    /// <param name="presetId">The preset id to apply.</param>
    public WidgetPresetEventArgs(string presetId)
    {
        ArgumentNullException.ThrowIfNull(presetId);
        PresetId = presetId;
    }

    /// <summary>The preset id to apply (web callback's <c>presetId</c> argument).</summary>
    public string PresetId { get; }
}

/// <summary>
/// Event payload carrying the new recently-added list to persist (web <c>saveRecentlyAdded(ids)</c>): the
/// host writes it back to durable storage so the section survives across open sessions.
/// </summary>
public sealed class RecentlyAddedChangedEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="ids"/>.</summary>
    /// <param name="ids">The new recently-added ids, most-recent first, capped.</param>
    public RecentlyAddedChangedEventArgs(IReadOnlyList<string> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        Ids = ids;
    }

    /// <summary>The new recently-added ids, most-recent first, capped (web persisted list).</summary>
    public IReadOnlyList<string> Ids { get; }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WidgetPicker"/> view — the native port of the web
/// <c>WidgetPicker</c> hook composition + handlers
/// (web/src/features/dashboard/components/WidgetPicker.tsx). It owns the catalogue/active-ids
/// <see cref="Model"/>, the transient <see cref="Interaction"/> (the web <c>useState</c> values: search,
/// category filter, this-session adds, recently-added, the live announcement) and the open flag, re-projects
/// through <see cref="WidgetPickerProjection"/> whenever an input changes, and exposes the resulting
/// <see cref="Display"/> so the view is a thin renderer. The commands reproduce the web handlers
/// (<c>handleAdd</c>, <c>handleAddMany</c>, the preset apply, the search/category setters and the open/close
/// reset effect) and raise the parent-owned callbacks as events (the web <c>onAddWidgets</c> /
/// <c>onApplyPreset</c> / <c>onClose</c> props, plus the recently-added persistence the web does through
/// <c>localStorage</c>). The view never performs HTTP or storage; the only seams are the i18n facade and the
/// recently-added loader the host supplies. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class WidgetPickerViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly WidgetPickerDiagnostics _diagnostics;
    private readonly Func<IReadOnlyList<string>>? _recentlyAddedLoader;
    private readonly Func<string, string?> _iconResolver;

    private WidgetPickerModel _model;
    private WidgetPickerInteraction _interaction;
    private WidgetPickerDisplay _display;
    private bool _isOpen;

    /// <summary>Creates the holder over the i18n facade, an optional model, diagnostics and a recently-added loader.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string (the web's <c>useTranslation</c>).</param>
    /// <param name="model">The catalogue + active ids; defaults to <see cref="WidgetPickerModel.Default"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="recentlyAddedLoader">
    /// The host's persisted recently-added loader (web <c>loadRecentlyAdded</c>), invoked on open to refresh the
    /// section. Optional — when absent the in-memory list is reused.
    /// </param>
    /// <param name="iconResolver">
    /// The widget-id to glyph resolver (web <c>getWidgetDef(id).icon</c>); defaults to
    /// <see cref="MiniGridWidgetIcons.GlyphFor"/>.
    /// </param>
    public WidgetPickerViewModel(
        ILocalizer localizer,
        WidgetPickerModel? model = null,
        WidgetPickerDiagnostics? diagnostics = null,
        Func<IReadOnlyList<string>>? recentlyAddedLoader = null,
        Func<string, string?>? iconResolver = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetPickerDiagnostics();
        _recentlyAddedLoader = recentlyAddedLoader;
        _iconResolver = iconResolver ?? MiniGridWidgetIcons.GlyphFor;
        _model = model ?? WidgetPickerModel.Default;
        _interaction = WidgetPickerInteraction.Empty;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised to add widgets to the dashboard (web <c>onAddWidgets(ids)</c>).</summary>
    public event EventHandler<WidgetAddEventArgs>? AddWidgetsRequested;

    /// <summary>Raised to apply a layout preset (web <c>onApplyPreset(id)</c>).</summary>
    public event EventHandler<WidgetPresetEventArgs>? ApplyPresetRequested;

    /// <summary>Raised to persist the recently-added list (web <c>saveRecentlyAdded(ids)</c>).</summary>
    public event EventHandler<RecentlyAddedChangedEventArgs>? RecentlyAddedChanged;

    /// <summary>Raised when the drawer should close (web <c>onClose()</c>).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The catalogue + active ids the picker renders from.</summary>
    public WidgetPickerModel Model => _model;

    /// <summary>The transient search / filter / added / announcement state.</summary>
    public WidgetPickerInteraction Interaction => _interaction;

    /// <summary>The projected, render-ready display for the current inputs.</summary>
    public WidgetPickerDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>True while the drawer is open (web <c>open</c> prop).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            Raise(nameof(IsOpen));
        }
    }

    /// <summary>The current search-box text (web <c>search</c>).</summary>
    public string Search => _interaction.Search;

    /// <summary>The selected category, or null for the "All" pill (web <c>categoryFilter</c>).</summary>
    public WidgetCategory? CategoryFilter => _interaction.CategoryFilter;

    /// <summary>The ids added during this open session (web <c>addedThisSessionIds</c>).</summary>
    public IReadOnlyList<string> AddedThisSessionIds => _interaction.AddedThisSessionIds;

    /// <summary>The current recently-added ids, most-recent first (web <c>recentlyAddedIds</c>).</summary>
    public IReadOnlyList<string> RecentlyAddedIds => _interaction.RecentlyAddedIds;

    // ── Open / close (the web `useEffect([open])` reset) ─────────────────────────────────────────────

    /// <summary>
    /// Open the drawer and reset the transient state (web open effect): clear the search, the category filter,
    /// the this-session adds and the announcement, and reload the recently-added list from the host. Emits the
    /// <c>view.opened</c> diagnostics event.
    /// </summary>
    public void Open()
    {
        IReadOnlyList<string> recent = _recentlyAddedLoader?.Invoke() ?? _interaction.RecentlyAddedIds;
        _interaction = WidgetPickerInteraction.Create(recentlyAddedIds: recent);
        IsOpen = true;
        _diagnostics.RecordViewOpened();
        Display = Project();
    }

    /// <summary>
    /// Close the drawer (web <c>onClose()</c> + the open-effect cleanup): raise the close request and clear the
    /// this-session adds and the announcement.
    /// </summary>
    public void Close()
    {
        _interaction = _interaction with
        {
            AddedThisSessionIds = Array.Empty<string>(),
            Announcement = string.Empty,
        };
        IsOpen = false;
        CloseRequested?.Invoke(this, EventArgs.Empty);
        Display = Project();
    }

    // ── Input setters (web setState) ─────────────────────────────────────────────────────────────────

    /// <summary>Update the search-box text and re-project (web <c>setSearch(value)</c>).</summary>
    /// <param name="search">The new raw search text.</param>
    public void SetSearch(string? search)
    {
        _interaction = _interaction with { Search = search ?? string.Empty };
        Display = Project();
    }

    /// <summary>Clear the search box (web Escape-with-text <c>setSearch('')</c>).</summary>
    public void ClearSearch() => SetSearch(string.Empty);

    /// <summary>Select a category filter, or null for the "All" pill, and re-project (web <c>setCategoryFilter</c>).</summary>
    /// <param name="category">The category to filter to, or null for "All".</param>
    public void SetCategoryFilter(WidgetCategory? category)
    {
        _interaction = _interaction with { CategoryFilter = category };
        Display = Project();
    }

    /// <summary>
    /// Replace the persisted recently-added list (web <c>setRecentlyAddedIds(loadRecentlyAdded())</c>) without
    /// raising the persistence event — used when the host hydrates the section.
    /// </summary>
    /// <param name="ids">The recently-added ids, most-recent first.</param>
    public void SetRecentlyAdded(IReadOnlyList<string>? ids)
    {
        _interaction = _interaction with { RecentlyAddedIds = ids ?? Array.Empty<string>() };
        Display = Project();
    }

    /// <summary>Replace the active-widget ids (web <c>activeWidgetIds</c> prop change) and re-project.</summary>
    /// <param name="activeWidgetIds">The ids now on the dashboard.</param>
    public void SetActiveWidgetIds(IReadOnlyList<string>? activeWidgetIds)
    {
        _model = _model with { ActiveWidgetIds = activeWidgetIds ?? Array.Empty<string>() };
        Display = Project();
    }

    // ── Commands (web handlers) ──────────────────────────────────────────────────────────────────────

    /// <summary>Add a single widget (web <c>handleAdd(widget, closeAfterAdd)</c>).</summary>
    /// <param name="widgetId">The widget id to add.</param>
    /// <param name="closeAfterAdd">When true, close the drawer after adding (web <c>closeAfterAdd</c>).</param>
    public void AddWidget(string widgetId, bool closeAfterAdd = false)
    {
        ArgumentNullException.ThrowIfNull(widgetId);
        AddWidgets(new[] { widgetId }, closeAfterAdd);
    }

    /// <summary>
    /// Add many widgets (web <c>handleAddMany(ids, options)</c>): drop ids already on the dashboard, unknown or
    /// duplicated; raise the add request; record the this-session adds; update + persist the recently-added
    /// list; set the live-region announcement; and optionally close. A no-op when nothing is addable.
    /// </summary>
    /// <param name="widgetIds">The candidate widget ids.</param>
    /// <param name="closeAfterAdd">When true, close the drawer after adding.</param>
    public void AddWidgets(IEnumerable<string> widgetIds, bool closeAfterAdd = false)
    {
        ArgumentNullException.ThrowIfNull(widgetIds);

        IReadOnlyList<string> addable = WidgetPickerProjection.ResolveAddable(_model, widgetIds);
        if (addable.Count == 0)
        {
            return;
        }

        AddWidgetsRequested?.Invoke(this, new WidgetAddEventArgs(addable));

        var added = new List<string>(_interaction.AddedThisSessionIds);
        var addedSet = new HashSet<string>(added, StringComparer.Ordinal);
        foreach (string id in addable)
        {
            if (addedSet.Add(id))
            {
                added.Add(id);
            }
        }

        IReadOnlyList<string> nextRecent =
            WidgetPickerProjection.NextRecentlyAdded(_interaction.RecentlyAddedIds, addable);

        string announcement = WidgetPickerProjection.AddedAnnouncement(ResolveNames(addable), _localizer);

        _interaction = _interaction with
        {
            AddedThisSessionIds = added,
            RecentlyAddedIds = nextRecent,
            Announcement = announcement,
        };

        _diagnostics.RecordWidgetsAdded(addable.Count);
        RecentlyAddedChanged?.Invoke(this, new RecentlyAddedChangedEventArgs(nextRecent));

        if (closeAfterAdd)
        {
            Close();
            return;
        }

        Display = Project();
    }

    /// <summary>
    /// Add every addable widget currently visible in the search results (web search "+ Add all" action over
    /// <c>addableSearchWidgets</c>).
    /// </summary>
    public void AddAllSearchResults() => AddWidgets(_display.SearchAddAllIds);

    /// <summary>
    /// Add every addable widget in a category group (web per-group "+ Add all" over
    /// <c>addableCategoryWidgets</c>).
    /// </summary>
    /// <param name="category">The category whose addable widgets are added.</param>
    public void AddAllInCategory(WidgetCategory category)
    {
        foreach (WidgetGroupView group in _display.Groups)
        {
            if (group.Category == category)
            {
                AddWidgets(group.AddAllIds);
                return;
            }
        }
    }

    /// <summary>
    /// Apply a layout preset (web preset button <c>onClick={() =&gt; { onApplyPreset(id); onClose(); }}</c>):
    /// raise the apply request, record the diagnostics counter and close the drawer.
    /// </summary>
    /// <param name="presetId">The preset id to apply.</param>
    public void ApplyPreset(string presetId)
    {
        ArgumentNullException.ThrowIfNull(presetId);
        ApplyPresetRequested?.Invoke(this, new WidgetPresetEventArgs(presetId));
        _diagnostics.RecordPresetApplied();
        Close();
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project the current inputs — the native analogue of
    /// react-i18next re-rendering after the active language changes.
    /// </summary>
    public void Reload() => Display = Project();

    private WidgetPickerDisplay Project() =>
        WidgetPickerProjection.Project(_model, _interaction, _localizer, _iconResolver);

    private List<string> ResolveNames(IReadOnlyList<string> ids)
    {
        var byId = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (WidgetCatalogEntry entry in _model.Catalog)
        {
            byId[entry.Id] = entry.Name;
        }

        var names = new List<string>(ids.Count);
        foreach (string id in ids)
        {
            names.Add(byId.TryGetValue(id, out string? name) ? name : id);
        }

        return names;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
