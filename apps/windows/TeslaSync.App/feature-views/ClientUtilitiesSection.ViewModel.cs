using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.ClientUtilities;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ClientUtilitiesSection"/> view — the native port
/// of the web <c>ClientUtilitiesSection</c> component
/// (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx). It projects the canonical
/// <see cref="IClientUtilityToolSource"/> through <see cref="ClientUtilitiesProjection"/> for the current
/// <see cref="SearchText"/> and exposes the resulting <see cref="Display"/> plus the mutually-exclusive
/// <see cref="State"/> so the view is a thin renderer. The surface is presentational — there is no
/// asynchronous load — so projection is synchronous; reassigning <see cref="SearchText"/> re-filters (the
/// web <c>filtered = useMemo(…)</c>), and <see cref="ToggleExpand(string)"/> drives the single-open
/// disclosure (the web <c>expandedId</c> state: opening one card closes the previously open one). Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ClientUtilitiesViewModel : INotifyPropertyChanged
{
    private readonly IClientUtilityToolSource _source;
    private readonly ILocalizer _localizer;

    private string _searchText = string.Empty;
    private string? _expandedId;
    private ClientUtilitiesDisplay _display;
    private ClientUtilityToolState _state;

    /// <summary>Creates the holder over its tool source and localizer.</summary>
    /// <param name="source">The client-utility entry source (the canonical catalog).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public ClientUtilitiesViewModel(IClientUtilityToolSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _display = ClientUtilitiesProjection.Project(source.GetTools(), _searchText, localizer);
        _state = StateFor(_display);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (grid vs no-match empty).</summary>
    public ClientUtilityToolState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready tool cards for the current search (web <c>filtered</c>).</summary>
    public ClientUtilitiesDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasResults));
        }
    }

    /// <summary>True when at least one tool matched the search (web grid renders) — false drives the empty surface.</summary>
    public bool HasResults => _display.Cards.Count > 0;

    /// <summary>The total number of tools in the registry before filtering (web <c>tools.length</c>).</summary>
    public int ToolCount => _display.TotalCount;

    /// <summary>
    /// The current search query (the web <c>search</c> state). Reassigning re-filters the tool list and, when
    /// the result set changes shape, flips <see cref="State"/> between grid and empty.
    /// </summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_searchText, next, StringComparison.Ordinal))
            {
                return;
            }

            _searchText = next;
            Raise(nameof(SearchText));
            Reproject();
        }
    }

    /// <summary>The id of the single currently-expanded tool card, or <c>null</c> when all are collapsed (web <c>expandedId</c>).</summary>
    public string? ExpandedId
    {
        get => _expandedId;
        private set => Set(ref _expandedId, value);
    }

    /// <summary>Localized surface title (Narrator name / host chrome).</summary>
    public string Title => ClientUtilitiesRegistration.Name(_localizer);

    /// <summary>Localized search field hint (web <c>t('devtools.searchTools', 'Search tools...')</c>).</summary>
    public string SearchHint => _localizer.GetString("devtools.searchTools", "Search tools...");

    /// <summary>Localized empty-state message (web <c>t('devtools.noToolsFound', 'No tools match your search')</c>).</summary>
    public string EmptyMessage => _localizer.GetString("devtools.noToolsFound", "No tools match your search");

    /// <summary>True when <paramref name="id"/> is the single currently-expanded card.</summary>
    /// <param name="id">The tool id to test.</param>
    public bool IsExpanded(string id) => string.Equals(_expandedId, id, StringComparison.Ordinal);

    /// <summary>
    /// Toggle the disclosure for <paramref name="id"/> (the web header click): expand it when collapsed,
    /// collapse it when already open. Opening a card closes the previously open one (single-open semantics).
    /// </summary>
    /// <param name="id">The tool id to toggle.</param>
    public void ToggleExpand(string id)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        ExpandedId = string.Equals(_expandedId, id, StringComparison.Ordinal) ? null : id;
    }

    /// <summary>
    /// Set the explicit expanded state for <paramref name="id"/> (the disclosure's own expand / collapse
    /// events). Expanding a card closes the previously open one; collapsing the open card clears the
    /// selection. Collapsing a card that is not the open one is a no-op.
    /// </summary>
    /// <param name="id">The tool id whose state changed.</param>
    /// <param name="expanded">True when the card is now expanded, false when collapsed.</param>
    public void SetExpanded(string id, bool expanded)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        if (expanded)
        {
            ExpandedId = id;
        }
        else if (string.Equals(_expandedId, id, StringComparison.Ordinal))
        {
            ExpandedId = null;
        }
    }

    private void Reproject()
    {
        Display = ClientUtilitiesProjection.Project(_source.GetTools(), _searchText, _localizer);
        State = StateFor(_display);
    }

    private static ClientUtilityToolState StateFor(ClientUtilitiesDisplay display) =>
        display.Cards.Count > 0 ? ClientUtilityToolState.Ready : ClientUtilityToolState.Empty;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
