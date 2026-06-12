using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SearchInput"/> view — the native port of the web
/// <c>SearchInput</c> component body (web/src/components/forms/SearchInput.tsx). It reproduces the web source's
/// behaviour over the injected history seam (<see cref="ISearchHistoryStore"/>, P1/S8) and the i18n facade
/// (<see cref="ILocalizer"/>, P1/S10): the controlled committed value (<see cref="Value"/>) which re-syncs the
/// buffered text when the parent resets it (web <c>useEffect([value])</c>); the buffered typing
/// (<see cref="LocalText"/>) whose commit is coalesced behind a debounce the view drives, emitted through
/// <see cref="ValueCommitted"/> only when it diverges from the committed value (web debounce effect); the clear
/// affordance (<see cref="ShowClear"/>); the recent-searches dropdown visibility + content
/// (<see cref="DropdownVisible"/>, <see cref="Entries"/>) shown only while focused with an empty value and a
/// non-empty history; the keyboard active descendant with clamped movement and commit-on-Enter
/// (<see cref="ActiveIndex"/>); selection / removal / clear-all of history entries; and the localized labels.
/// The view binds the projected state and never touches storage. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class SearchInputViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<string> NoEntries = Array.Empty<string>();

    private readonly ILocalizer _localizer;
    private readonly ISearchHistoryStore _store;

    private string _value = string.Empty;
    private string _local = string.Empty;
    private string? _historyScope;
    private bool _showHistoryOnFocus;
    private int _maxHistory;
    private string? _clearLabelOverride;
    private bool _isFocused;
    private int _activeIndex = -1;
    private IReadOnlyList<string> _entries = NoEntries;

    /// <summary>Creates the holder over the i18n facade, the history seam and the optional history configuration.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="store">The recent-search history seam (P1/S8); defaults to an in-memory-backed store.</param>
    /// <param name="historyScope">The history storage scope (web <c>historyScope</c>); null/blank keeps the field history-less.</param>
    /// <param name="showHistoryOnFocus">Whether focusing the empty field shows the dropdown (web <c>showHistoryOnFocus = true</c>).</param>
    /// <param name="maxHistory">Maximum entries rendered in the dropdown (web <c>maxHistory = 8</c>).</param>
    public SearchInputViewModel(
        ILocalizer localizer,
        ISearchHistoryStore? store = null,
        string? historyScope = null,
        bool showHistoryOnFocus = true,
        int maxHistory = SearchInputRegistration.DefaultMaxHistory)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _store = store ?? new JsonSearchHistoryStore();
        _historyScope = string.IsNullOrEmpty(historyScope) ? null : historyScope;
        _showHistoryOnFocus = showHistoryOnFocus;
        _maxHistory = maxHistory;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the committed value changes (web <c>onChange(value)</c>) — after debounce, on clear, or on selection.</summary>
    public event EventHandler<string>? ValueCommitted;

    /// <summary>Raised whenever the buffered text changes so the view can (re)start its debounce timer (web debounce effect dependency).</summary>
    public event EventHandler? LocalTextChanged;

    /// <summary>Raised when the surface asks the view to refocus the input (web <c>inputRef.current?.focus()</c>).</summary>
    public event EventHandler? FocusRequested;

    /// <summary>
    /// The committed (controlled) value — the web <c>value</c> prop. Setting it from the parent re-syncs the
    /// buffered text (web <c>useEffect(() =&gt; setLocal(value), [value])</c>) without emitting a fresh commit.
    /// </summary>
    public string Value
    {
        get => _value;
        set
        {
            string next = value ?? string.Empty;
            if (_value == next)
            {
                return;
            }

            _value = next;

            // web: the controlled value changing externally resets the buffered text to match.
            if (_local != next)
            {
                _local = next;
                _activeIndex = -1;
                RaiseAll();
                LocalTextChanged?.Invoke(this, EventArgs.Empty);
            }
            else
            {
                RaiseAll();
            }
        }
    }

    /// <summary>The buffered typing text (web <c>local</c>); commits are coalesced behind the view's debounce.</summary>
    public string LocalText => _local;

    /// <summary>The history storage scope (web <c>historyScope</c>); null keeps the field history-less.</summary>
    public string? HistoryScope
    {
        get => _historyScope;
        set
        {
            string? next = string.IsNullOrEmpty(value) ? null : value;
            if (_historyScope == next)
            {
                return;
            }

            _historyScope = next;
            RefreshEntries();
            _activeIndex = -1;
            RaiseAll();
        }
    }

    /// <summary>Whether focusing the empty field shows the recent-searches dropdown (web <c>showHistoryOnFocus</c>).</summary>
    public bool ShowHistoryOnFocus
    {
        get => _showHistoryOnFocus;
        set
        {
            if (_showHistoryOnFocus == value)
            {
                return;
            }

            _showHistoryOnFocus = value;
            RaiseAll();
        }
    }

    /// <summary>Maximum entries rendered in the dropdown (web <c>maxHistory</c>); changing it re-reads the history.</summary>
    public int MaxHistory
    {
        get => _maxHistory;
        set
        {
            if (_maxHistory == value)
            {
                return;
            }

            _maxHistory = value;
            RefreshEntries();
            RaiseAll();
        }
    }

    /// <summary>Optional override for the clear button's accessible name (web <c>clearLabel</c>); falls back to the localized default.</summary>
    public string? ClearLabelOverride
    {
        get => _clearLabelOverride;
        set
        {
            if (_clearLabelOverride == value)
            {
                return;
            }

            _clearLabelOverride = value;
            RaiseAll();
        }
    }

    /// <summary>Whether a history scope is configured (web <c>Boolean(historyScope)</c>).</summary>
    public bool HistoryEnabled => _historyScope is not null;

    /// <summary>Whether the field is focused (web <c>isFocused</c>).</summary>
    public bool IsFocused => _isFocused;

    /// <summary>Whether the clear (×) button is shown (web suffix renders when <c>local</c> is non-empty).</summary>
    public bool ShowClear => _local.Length > 0;

    /// <summary>The recent-search entries currently available for the dropdown, newest-first (web <c>entries</c>).</summary>
    public IReadOnlyList<string> Entries => _entries;

    /// <summary>The keyboard active-descendant index within <see cref="Entries"/> (-1 = none; web <c>activeIdx</c>).</summary>
    public int ActiveIndex => _activeIndex;

    /// <summary>The active entry, or null when no row is highlighted.</summary>
    public string? ActiveEntry => _activeIndex >= 0 && _activeIndex < _entries.Count ? _entries[_activeIndex] : null;

    /// <summary>
    /// Whether the recent-searches dropdown is shown — the web <c>dropdownVisible</c>: a history scope is set,
    /// <see cref="ShowHistoryOnFocus"/> is on, the field is focused, the buffered text is empty and there is at
    /// least one entry.
    /// </summary>
    public bool DropdownVisible =>
        HistoryEnabled && _showHistoryOnFocus && _isFocused && _local.Length == 0 && _entries.Count > 0;

    /// <summary>The content the surface renders (web render branches): the dropdown, the clear affordance, or the idle field.</summary>
    public SearchInputContentState ContentState =>
        DropdownVisible ? SearchInputContentState.History
        : _local.Length > 0 ? SearchInputContentState.Typing
        : SearchInputContentState.Empty;

    /// <summary>The clear (×) button accessible name (web <c>clearLabel ?? t('common.clear', 'Clear')</c>).</summary>
    public string ClearLabel =>
        _clearLabelOverride ?? _localizer.GetString(SearchInputRegistration.ClearKey, SearchInputRegistration.ClearFallback);

    /// <summary>The dropdown title + listbox accessible name (web <c>t('search.history.title', 'Recent searches')</c>).</summary>
    public string HistoryTitle =>
        _localizer.GetString(SearchInputRegistration.HistoryTitleKey, SearchInputRegistration.HistoryTitleFallback);

    /// <summary>The "Clear history" footer button label (web <c>t('search.history.clear', 'Clear history')</c>).</summary>
    public string ClearHistoryLabel =>
        _localizer.GetString(SearchInputRegistration.ClearHistoryKey, SearchInputRegistration.ClearHistoryFallback);

    /// <summary>The accessible name of a history row's remove button (web <c>t('search.history.removeAria', { query })</c>).</summary>
    public string RemoveAriaFor(string entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return SearchInputRegistration.FormatRemoveAria(
            _localizer.GetString(SearchInputRegistration.RemoveAriaKey, SearchInputRegistration.RemoveAriaFallback),
            entry);
    }

    /// <summary>Buffer a keystroke (web <c>handleInputChange</c>): set the text, reset the active row, and signal the debounce.</summary>
    public void Type(string? text)
    {
        _local = text ?? string.Empty;
        _activeIndex = -1;
        RaiseAll();
        LocalTextChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Commit the buffered text once the debounce window elapses (web debounce effect): emit
    /// <see cref="ValueCommitted"/> only when the buffered text diverges from the committed value.
    /// </summary>
    public void FlushDebounced()
    {
        if (_local == _value)
        {
            return;
        }

        _value = _local;
        RaiseAll();
        ValueCommitted?.Invoke(this, _value);
    }

    /// <summary>Clear the field (web <c>handleClear</c>): reset the buffered text to empty, refresh the history and signal the debounce so an empty value is committed.</summary>
    public void Clear()
    {
        _local = string.Empty;
        _activeIndex = -1;
        RefreshEntries();
        RaiseAll();
        LocalTextChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Handle the field gaining focus (web <c>handleFocus</c>): refresh the history, mark focused and clear the active row.</summary>
    public void Focus()
    {
        RefreshEntries();
        _isFocused = true;
        _activeIndex = -1;
        RaiseAll();
    }

    /// <summary>Handle focus leaving the whole surface (web <c>handleWrapperBlur</c>): unfocus, clear the active row and record the buffered text to history.</summary>
    public void Blur()
    {
        _isFocused = false;
        _activeIndex = -1;
        CommitToHistory();
        RaiseAll();
    }

    /// <summary>
    /// Select a history entry (web <c>selectEntry</c>): adopt it as both the buffered text and the committed
    /// value immediately (skipping the debounce), record it back to history, clear the active row and ask the
    /// view to refocus the input so the user can refine without re-clicking.
    /// </summary>
    public void SelectEntry(string entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        _local = entry;
        _value = entry;
        if (_historyScope is { } scope)
        {
            _store.Record(scope, entry);
        }

        _activeIndex = -1;
        RaiseAll();
        ValueCommitted?.Invoke(this, entry);
        FocusRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Remove a single history entry (web <c>handleRemoveEntry</c>): delete it, re-read the list, clamp the active row and refocus the input.</summary>
    public void RemoveEntry(string entry)
    {
        if (_historyScope is not { } scope)
        {
            return;
        }

        _store.Remove(scope, entry);
        _entries = _store.GetRecent(scope, _maxHistory);
        _activeIndex = Math.Min(_activeIndex, _entries.Count - 1);
        RaiseAll();
        FocusRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Clear the entire scope's history (web <c>handleClearAll</c>): wipe it, empty the list, clear the active row and refocus the input.</summary>
    public void ClearAll()
    {
        if (_historyScope is not { } scope)
        {
            return;
        }

        _store.ClearScope(scope);
        _entries = NoEntries;
        _activeIndex = -1;
        RaiseAll();
        FocusRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Move the active row down (web ArrowDown), clamped to the last entry. Returns whether the key was handled.</summary>
    public bool MoveActiveDown()
    {
        if (!DropdownVisible)
        {
            return false;
        }

        int next = Math.Min(_activeIndex + 1, _entries.Count - 1);
        if (next != _activeIndex)
        {
            _activeIndex = next;
            RaiseAll();
        }

        return true;
    }

    /// <summary>Move the active row up (web ArrowUp), clamped to "no selection" (-1). Returns whether the key was handled.</summary>
    public bool MoveActiveUp()
    {
        if (!DropdownVisible)
        {
            return false;
        }

        int next = Math.Max(_activeIndex - 1, -1);
        if (next != _activeIndex)
        {
            _activeIndex = next;
            RaiseAll();
        }

        return true;
    }

    /// <summary>
    /// Handle Enter (web Enter branch): select the active entry when the dropdown is open with a highlighted
    /// row (returns true so the view marks the key handled); otherwise record the buffered text to history when
    /// it is long enough (returns false). Mirrors the web source, which does not force a debounce flush here.
    /// </summary>
    public bool CommitActiveOrRecord()
    {
        if (DropdownVisible && _activeIndex >= 0 && _activeIndex < _entries.Count)
        {
            SelectEntry(_entries[_activeIndex]);
            return true;
        }

        if (_historyScope is { } scope && _local.Trim().Length >= SearchInputRegistration.MinQueryLen)
        {
            _store.Record(scope, _local);
        }

        return false;
    }

    /// <summary>Handle Escape (web Escape branch): close the dropdown when it is open. Returns whether the key was handled.</summary>
    public bool Escape()
    {
        if (!DropdownVisible)
        {
            return false;
        }

        _isFocused = false;
        _activeIndex = -1;
        RaiseAll();
        return true;
    }

    private void CommitToHistory()
    {
        if (_historyScope is { } scope && _local.Trim().Length >= SearchInputRegistration.MinQueryLen)
        {
            _store.Record(scope, _local);
        }
    }

    private void RefreshEntries() =>
        _entries = _historyScope is { } scope ? _store.GetRecent(scope, _maxHistory) : NoEntries;

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
