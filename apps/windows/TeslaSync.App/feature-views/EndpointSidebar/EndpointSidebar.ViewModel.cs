using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EndpointSidebar"/> view — the native port of the
/// web <c>EndpointSidebar</c> component's local state (the <c>useState</c> search box and the per-group
/// <c>useState(defaultOpen)</c> collapse) in web/src/features/admin/components/EndpointSidebar.tsx. The web
/// component is presentational: its data (the endpoint list and the selection) arrives as props and its only
/// hook is <c>useTranslation</c>, so there is no asynchronous load — the single seam is the i18n facade.
/// This holder owns the search text, the selection (settable by the parent via <see cref="SetSelected"/> or
/// by a row click via <see cref="Select"/>), and the user's per-group open overrides; it recomputes the
/// render-ready <see cref="Display"/> on demand through the pure <see cref="EndpointSidebarProjection"/>.
/// Row clicks echo the chosen endpoint to the injected <c>onSelect</c> callback exactly as the web row's
/// <c>onClick={() =&gt; onSelect(ep)}</c>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class EndpointSidebarViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly Action<ParsedEndpoint>? _onSelect;
    private readonly Dictionary<string, bool> _openOverrides = new(StringComparer.Ordinal);

    private IReadOnlyList<ParsedEndpoint> _endpoints;
    private ParsedEndpoint? _selected;
    private string _search = string.Empty;

    /// <summary>Creates the holder over the i18n facade and the optional initial props.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string (web <c>useTranslation</c>).</param>
    /// <param name="endpoints">The initial endpoint list (web <c>endpoints</c> prop); defaults to empty.</param>
    /// <param name="selected">The initially selected endpoint (web <c>selected</c> prop); defaults to none.</param>
    /// <param name="onSelect">The selection callback (web <c>onSelect</c> prop); invoked on a row click.</param>
    public EndpointSidebarViewModel(
        ILocalizer localizer,
        IReadOnlyList<ParsedEndpoint>? endpoints = null,
        ParsedEndpoint? selected = null,
        Action<ParsedEndpoint>? onSelect = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _endpoints = endpoints ?? Array.Empty<ParsedEndpoint>();
        _selected = selected;
        _onSelect = onSelect;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The full endpoint list (web <c>endpoints</c> prop).</summary>
    public IReadOnlyList<ParsedEndpoint> Endpoints => _endpoints;

    /// <summary>The currently selected endpoint, or null (web <c>selected</c> prop).</summary>
    public ParsedEndpoint? Selected => _selected;

    /// <summary>The current search text (web search <c>useState</c>).</summary>
    public string Search => _search;

    /// <summary>
    /// The render-ready projection of the current inputs — recomputed on each read so it always reflects the
    /// latest search, selection and per-group open overrides. The projection is cheap (a filter + group over
    /// a bounded list), so the view reads it on each rebuild and tests read it directly.
    /// </summary>
    public EndpointSidebarDisplay Display => EndpointSidebarProjection.Project(
        _endpoints, _selected, _search, ResolveOpen, _localizer);

    /// <summary>
    /// Set the search text and re-project — the native analogue of the web search box <c>onChange</c> driving
    /// the <c>filtered</c> memo. A no-op (no notification) when the text is unchanged.
    /// </summary>
    /// <param name="search">The new search text (null is treated as empty).</param>
    public void UpdateSearch(string? search)
    {
        string next = search ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        RaiseDisplay();
    }

    /// <summary>
    /// Select an endpoint from a row click — sets the selection (so the highlight updates immediately) and
    /// echoes it to the injected <c>onSelect</c> callback, mirroring the web row's
    /// <c>onClick={() =&gt; onSelect(ep)}</c>. The callback fires even when the row is already selected (as it
    /// does on the web); a notification is raised only when the highlighted row actually changes.
    /// </summary>
    /// <param name="endpoint">The endpoint whose row was clicked.</param>
    public void Select(ParsedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        bool changed = !EndpointSidebarProjection.IsSameEndpoint(_selected, endpoint);
        _selected = endpoint;
        _onSelect?.Invoke(endpoint);

        if (changed)
        {
            RaiseDisplay();
        }
    }

    /// <summary>
    /// Set the selection from the parent (the web <c>selected</c> prop changing) without invoking the
    /// <c>onSelect</c> callback. A no-op when the selection is unchanged.
    /// </summary>
    /// <param name="endpoint">The new selection, or null to clear it.</param>
    public void SetSelected(ParsedEndpoint? endpoint)
    {
        if (_selected is null && endpoint is null)
        {
            return;
        }

        if (EndpointSidebarProjection.IsSameEndpoint(_selected, endpoint))
        {
            return;
        }

        _selected = endpoint;
        RaiseDisplay();
    }

    /// <summary>
    /// Replace the endpoint list (the web <c>endpoints</c> prop changing) and re-project. User open overrides
    /// are kept (keyed by tag) so a list refresh does not discard the operator's expand/collapse choices.
    /// </summary>
    /// <param name="endpoints">The new endpoint list.</param>
    public void SetEndpoints(IReadOnlyList<ParsedEndpoint> endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        _endpoints = endpoints;
        RaiseDisplay();
    }

    /// <summary>
    /// Persist a user's expand/collapse of a tag group — the native analogue of the web per-group
    /// <c>setOpen</c>. The override is silent (no notification): the view's expander already reflects the new
    /// state visually, so re-projecting the whole list on every toggle is unnecessary; the override is read
    /// back the next time <see cref="Display"/> is projected.
    /// </summary>
    /// <param name="tag">The group tag being toggled.</param>
    /// <param name="open">The new open state chosen by the user.</param>
    public void SetGroupOpen(string tag, bool open)
    {
        ArgumentNullException.ThrowIfNull(tag);
        _openOverrides[tag] = open;
    }

    /// <summary>
    /// The effective open state for a tag given the current inputs — the user override if one exists,
    /// otherwise the web default (<see cref="EndpointSidebarProjection.DefaultOpen"/> over the current group
    /// set). Used by the view to ignore redundant programmatic expander events and by tests to assert the
    /// override semantics.
    /// </summary>
    /// <param name="tag">The group tag to resolve.</param>
    public bool IsGroupOpen(string tag)
    {
        ArgumentNullException.ThrowIfNull(tag);

        var filtered = EndpointSidebarProjection.Filter(_endpoints, _search);
        var grouped = EndpointSidebarProjection.Group(filtered);
        string? selectedTag = EndpointSidebarProjection.SelectedTag(_selected);
        bool defaultOpen = EndpointSidebarProjection.DefaultOpen(tag, selectedTag, grouped.Count);
        return ResolveOpen(tag, defaultOpen);
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project — the native analogue of react-i18next
    /// re-rendering the component after the active language changes.
    /// </summary>
    public void Reload() => RaiseDisplay();

    private bool ResolveOpen(string tag, bool defaultOpen) =>
        _openOverrides.TryGetValue(tag, out bool over) ? over : defaultOpen;

    private void RaiseDisplay()
    {
        Raise(nameof(Display));
        Raise(nameof(Selected));
        Raise(nameof(Search));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
