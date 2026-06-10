using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SettingsSearch"/> view — the native port of the
/// web component's data flow (web/src/features/settings/components/SettingsSearch.tsx). It owns the static,
/// i18n-built settings index (from the bound <see cref="ISettingsIndexSource"/>, web <c>getSettingsIndex(t)</c>)
/// and runs the find-as-you-type search for one query at a time (web
/// <c>searchSettings(index, query).slice(0, MAX_RESULTS)</c>). The search is <b>synchronous</b> — there is no
/// network read — so the surface resolves to exactly one of <see cref="SettingsSearchState.Idle"/> (empty
/// query, dropdown closed), <see cref="SettingsSearchState.Results"/> (matches) or
/// <see cref="SettingsSearchState.Empty"/> (a non-empty query with no matches → "No matching settings."); there
/// is deliberately no loading / error / stale / offline branch. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class SettingsSearchViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<SettingsEntry> _index;

    private string _query = string.Empty;
    private SettingsSearchState _state = SettingsSearchState.Idle;
    private IReadOnlyList<SettingsEntry> _matches = Array.Empty<SettingsEntry>();
    private IReadOnlyList<SettingsSearchRow> _rows = Array.Empty<SettingsSearchRow>();

    /// <summary>Creates the holder over its index source and localizer, building the index eagerly.</summary>
    public SettingsSearchViewModel(ISettingsIndexSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _index = source.BuildIndex();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The raw text the field currently holds (web <c>query</c>); empty before any input.</summary>
    public string Query
    {
        get => _query;
        private set => Set(ref _query, value);
    }

    /// <summary>The current surface state (idle / results / empty).</summary>
    public SettingsSearchState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(ShowDropdown));
            }
        }
    }

    /// <summary>The ranked matches, capped at <see cref="SettingsSearchRegistration.MaxResults"/>; never null.</summary>
    public IReadOnlyList<SettingsEntry> Matches
    {
        get => _matches;
        private set
        {
            _matches = value ?? Array.Empty<SettingsEntry>();
            Raise(nameof(Matches));
            Raise(nameof(HasMatches));
        }
    }

    /// <summary>
    /// The dropdown rows to render: one per match when <see cref="SettingsSearchState.Results"/>, a single
    /// "No matching settings." row when <see cref="SettingsSearchState.Empty"/>, and none when
    /// <see cref="SettingsSearchState.Idle"/>. Never null.
    /// </summary>
    public IReadOnlyList<SettingsSearchRow> Rows
    {
        get => _rows;
        private set => Set(ref _rows, value ?? Array.Empty<SettingsSearchRow>());
    }

    /// <summary>True when at least one setting matched the current query.</summary>
    public bool HasMatches => _matches.Count > 0;

    /// <summary>True when the dropdown should be shown (web <c>showDropdown = query.length &gt; 0</c>).</summary>
    public bool ShowDropdown => _state != SettingsSearchState.Idle;

    /// <summary>The number of indexed settings (the full <c>getSettingsIndex</c> size).</summary>
    public int IndexedCount => _index.Count;

    /// <summary>The field prompt text shown while empty (web's empty-field prompt).</summary>
    public string PromptText => SettingsSearchRegistration.PromptText(_localizer);

    /// <summary>The accessible field label (web <c>aria-label</c>).</summary>
    public string AriaLabel => SettingsSearchRegistration.AriaLabel(_localizer);

    /// <summary>The "No matching settings." empty-result note (web no-results option).</summary>
    public string NoResultsText => SettingsSearchRegistration.NoResultsText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (the no-results note, else null).</summary>
    public string? StatusAnnouncement => _state == SettingsSearchState.Empty ? NoResultsText : null;

    /// <summary>
    /// Search for <paramref name="query"/> (web's <c>onChange</c> → <c>searchSettings</c>). An empty query
    /// resolves to <see cref="SettingsSearchState.Idle"/> with a closed dropdown; any other query runs the
    /// synchronous matcher, capping the rows and classifying the result as
    /// <see cref="SettingsSearchState.Results"/> or <see cref="SettingsSearchState.Empty"/>.
    /// </summary>
    public void SetQuery(string? query)
    {
        string raw = query ?? string.Empty;
        Query = raw;

        if (raw.Length == 0)
        {
            // web: showDropdown is false while the field is empty — the dropdown stays closed.
            Matches = Array.Empty<SettingsEntry>();
            Rows = Array.Empty<SettingsSearchRow>();
            State = SettingsSearchState.Idle;
            Raise(nameof(StatusAnnouncement));
            return;
        }

        var matches = SettingsSearchMatcher.Search(_index, raw)
            .Take(SettingsSearchRegistration.MaxResults)
            .ToList();
        Matches = matches;

        if (matches.Count == 0)
        {
            // web: a non-empty query with no matches shows the disabled "No matching settings." option.
            Rows = new[] { SettingsSearchRow.NoResults(NoResultsText) };
            State = SettingsSearchState.Empty;
        }
        else
        {
            Rows = matches.Select(SettingsSearchRow.ForEntry).ToList();
            State = SettingsSearchState.Results;
        }

        Raise(nameof(StatusAnnouncement));
    }

    /// <summary>Clear the query back to the resting idle surface (web <c>commit</c> clears the input).</summary>
    public void Clear() => SetQuery(string.Empty);

    /// <summary>Resolve the deep-link destination for a chosen entry (web <c>navigate(entry.href)</c>).</summary>
    public static SettingsNavigationTarget ResolveTarget(SettingsEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return entry.Target;
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
