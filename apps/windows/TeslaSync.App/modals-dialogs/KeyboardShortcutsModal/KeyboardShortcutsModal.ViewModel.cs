using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="KeyboardShortcutsModal"/> view — the native port of
/// the web component's hook composition (web/src/components/feedback/KeyboardShortcutsModal.tsx). It composes the
/// shortcut registry (web <c>useAllShortcuts</c>), the current route (web <c>useLocation</c>) and the localizer
/// (web <c>useTranslation</c>); holds the live search box and the persisted filter mode (web
/// <c>sessionStorage</c>); and projects the three through <see cref="ShortcutProjection"/> into the ordered,
/// grouped cheatsheet the view renders. Search resets when the modal closes (web
/// <c>useEffect(() =&gt; { if (!open) setSearch('') })</c>); opening records the <c>view.opened</c> diagnostic.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class KeyboardShortcutsModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IShortcutRegistry _registry;
    private readonly IRouteContext _route;
    private readonly ILocalizer _localizer;
    private readonly IShortcutFilterStore _filterStore;
    private readonly KeyboardShortcutsModalDiagnostics _diagnostics;

    private bool _subscribed;
    private bool _disposed;
    private bool _snapshotObserved;

    private string _search = string.Empty;
    private ShortcutFilterMode _mode;
    private IReadOnlyList<ShortcutGroup> _groups = Array.Empty<ShortcutGroup>();
    private KeyboardShortcutsState _state = KeyboardShortcutsState.Loading;

    /// <summary>Creates the holder over the registry, route, localizer and (optional) filter store + diagnostics.</summary>
    public KeyboardShortcutsModalViewModel(
        IShortcutRegistry registry,
        IRouteContext route,
        ILocalizer localizer,
        IShortcutFilterStore? filterStore = null,
        KeyboardShortcutsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(route);
        ArgumentNullException.ThrowIfNull(localizer);
        _registry = registry;
        _route = route;
        _localizer = localizer;
        _filterStore = filterStore ?? new InMemoryShortcutFilterStore();
        _diagnostics = diagnostics ?? new KeyboardShortcutsModalDiagnostics();
        _mode = _filterStore.Read();   // web useState(readStoredFilter)
        Reproject();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Render state ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The body's lifecycle state (loading / loaded / empty). See <see cref="KeyboardShortcutsState"/>.</summary>
    public KeyboardShortcutsState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(IsEmpty));
                Raise(nameof(IsLoading));
            }
        }
    }

    /// <summary>The projected, ordered, grouped cheatsheet (web <c>filteredGroups</c>).</summary>
    public IReadOnlyList<ShortcutGroup> Groups
    {
        get => _groups;
        private set
        {
            if (Set(ref _groups, value))
            {
                Raise(nameof(HasGroups));
            }
        }
    }

    /// <summary>True while still in the initial pre-open tick (no snapshot observed yet).</summary>
    public bool IsLoading => _state == KeyboardShortcutsState.Loading;

    /// <summary>True when the registry resolved but nothing matches the active filter + search.</summary>
    public bool IsEmpty => _state == KeyboardShortcutsState.Empty;

    /// <summary>True when at least one group is shown.</summary>
    public bool HasGroups => _groups.Count > 0;

    // ── Controls (web search + filter chips) ───────────────────────────────────────────────────────────

    /// <summary>The live search query (web <c>search</c> state). Setting it re-projects.</summary>
    public string Search
    {
        get => _search;
        set
        {
            string next = value ?? string.Empty;
            if (Set(ref _search, next))
            {
                Reproject();
            }
        }
    }

    /// <summary>The active filter mode (web <c>mode</c> state). Mutate via <see cref="SelectFilter"/>.</summary>
    public ShortcutFilterMode Mode
    {
        get => _mode;
        private set
        {
            if (Set(ref _mode, value))
            {
                Raise(nameof(SelectedFilterValue));
                Reproject();
            }
        }
    }

    /// <summary>The selected filter token (<c>"all" | "global" | "page"</c>) for the pill bar binding.</summary>
    public string SelectedFilterValue => ShortcutFilterModes.Token(_mode);

    /// <summary>Modal title (web <c>t('shortcuts.title', …)</c>).</summary>
    public string Title => KeyboardShortcutsModalRegistration.Title(_localizer);

    /// <summary>Search prompt (web <c>t('shortcuts.search', …)</c>).</summary>
    public string SearchPrompt => KeyboardShortcutsModalRegistration.SearchPrompt(_localizer);

    /// <summary>Empty-state message (web <c>t('shortcuts.empty', …)</c>).</summary>
    public string EmptyMessage => KeyboardShortcutsModalRegistration.Empty(_localizer);

    /// <summary>
    /// The three filter pills, localized (web <c>FILTER_OPTIONS</c>). Values are the stable tokens so the view's
    /// pill bar round-trips selection through <see cref="SelectFilter"/>.
    /// </summary>
    public IReadOnlyList<ComboOption> FilterOptions =>
    [
        new ComboOption(ShortcutFilterModes.Token(ShortcutFilterMode.All), KeyboardShortcutsModalRegistration.FilterAll(_localizer)),
        new ComboOption(ShortcutFilterModes.Token(ShortcutFilterMode.Global), KeyboardShortcutsModalRegistration.FilterGlobal(_localizer)),
        new ComboOption(ShortcutFilterModes.Token(ShortcutFilterMode.Page), KeyboardShortcutsModalRegistration.FilterPage(_localizer)),
    ];

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Select a filter by token, persisting it (web <c>handleFilter</c> → <c>writeStoredFilter</c>).</summary>
    public void SelectFilter(string token) => SetMode(ShortcutFilterModes.Parse(token));

    /// <summary>Select a filter by mode, persisting it (web <c>handleFilter</c> → <c>writeStoredFilter</c>).</summary>
    public void SetMode(ShortcutFilterMode mode)
    {
        if (mode == _mode)
        {
            return;
        }

        _filterStore.Write(mode);   // web writeStoredFilter(next)
        Mode = mode;
    }

    /// <summary>
    /// Open the cheatsheet: subscribe to the registry + route, take the first snapshot (the registry is
    /// synchronous and already populated), record the <c>view.opened</c> diagnostic and project. Idempotent.
    /// </summary>
    public void Open()
    {
        EnsureSubscribed();
        _snapshotObserved = true;
        _diagnostics.RecordViewOpened();
        Reproject();
    }

    /// <summary>
    /// Close the cheatsheet: reset the live search box so it does not bleed into the next session (web
    /// <c>useEffect(() =&gt; { if (!open) setSearch('') })</c>). The filter mode deliberately persists.
    /// </summary>
    public void Close()
    {
        if (_search.Length > 0)
        {
            _search = string.Empty;
            Raise(nameof(Search));
        }

        Reproject();
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private void EnsureSubscribed()
    {
        if (_subscribed || _disposed)
        {
            return;
        }

        _registry.Changed += OnSourceChanged;
        _route.Changed += OnSourceChanged;
        _subscribed = true;
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        _snapshotObserved = true;
        Reproject();
    }

    private void Reproject()
    {
        IReadOnlyList<ShortcutGroup> groups =
            ShortcutProjection.Project(_registry.Snapshot, _mode, _route.CurrentPath, _search);
        Groups = groups;
        State = !_snapshotObserved
            ? KeyboardShortcutsState.Loading
            : groups.Count == 0
                ? KeyboardShortcutsState.Empty
                : KeyboardShortcutsState.Loaded;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_subscribed)
        {
            _registry.Changed -= OnSourceChanged;
            _route.Changed -= OnSourceChanged;
            _subscribed = false;
        }

        GC.SuppressFinalize(this);
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
