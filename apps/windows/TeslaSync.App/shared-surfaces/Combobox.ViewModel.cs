using System.ComponentModel;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Combobox"/> view — the native port of the web
/// <c>Combobox</c> component body (web/src/components/forms/Combobox.tsx). It reproduces the web source's
/// behaviour over the injected option seam (<see cref="IComboboxOptionsSource"/>, the static-array filter or
/// the async loader), reusing the shared, unit-tested <see cref="ComboboxFilter"/> + <see cref="ComboOption"/>
/// (P1/S8) rather than re-implementing the filter: the open/closed listbox (<see cref="IsOpen"/>); the
/// type-ahead query (<see cref="InputText"/>) which opens the listbox and re-filters (static) or debounces +
/// cancels the previous fetch (async, web L231-L266); the options capped at <see cref="MaxVisibleOptions"/>
/// (<see cref="VisibleOptions"/>) with the hidden-overflow count (<see cref="HiddenCount"/>, web "more — refine
/// search"); the keyboard active descendant with wrap-around movement, Home/End and commit-on-Enter/Tab
/// (<see cref="ActiveIndex"/>); the clear (×) and chevron-toggle affordances; free-text commit when
/// <see cref="AllowFreeText"/>; the loading / empty / results projection (<see cref="Status"/>); and the live
/// result-count announcement fired through the shared announcer (<see cref="IAnnouncerBus"/>, web
/// <c>announce()</c>). The view binds the projected state and never performs I/O. Drive it from one
/// confinement (the UI thread); it is not internally synchronised beyond the keystroke cancellation token.
/// </summary>
public sealed class ComboboxViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);
    private static readonly IReadOnlyList<ComboOption> NoOptions = Array.Empty<ComboOption>();

    private readonly IComboboxOptionsSource _source;
    private readonly ILocalizer _localizer;
    private readonly IAnnouncerBus _announcer;
    private readonly int _maxVisibleOptions;
    private readonly int _asyncDebounceMs;

    private string _label;
    private bool _open;
    private bool _disabled;
    private string _inputText = string.Empty;
    private int _activeIndex = -1;
    private bool _loading;
    private ComboOption? _selected;
    private IReadOnlyList<ComboOption> _filtered = NoOptions;
    private IReadOnlyList<ComboOption> _visible = NoOptions;
    private string _lastAnnounced = string.Empty;
    private CancellationTokenSource? _queryCts;
    private bool _disposed;

    /// <summary>Creates the holder over its option seam, the i18n facade and the announcer bus.</summary>
    /// <param name="source">The option provider (static array filter or async loader); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="label">The consumer-supplied, already-localized field + listbox accessible name (web <c>label</c>).</param>
    /// <param name="announcer">The screen-reader announcer bus (web <c>useAnnouncer()</c>); defaults to the shared bus.</param>
    /// <param name="allowFreeText">When true, Enter with no active option commits the typed text (web <c>allowFreeText</c>).</param>
    /// <param name="maxVisibleOptions">Cap on rendered options (web <c>maxVisibleOptions = 50</c>).</param>
    /// <param name="asyncDebounceMs">Async fetch debounce in ms (web <c>asyncDebounceMs = 200</c>); ignored for static sources.</param>
    public ComboboxViewModel(
        IComboboxOptionsSource source,
        ILocalizer localizer,
        string label,
        IAnnouncerBus? announcer = null,
        bool allowFreeText = false,
        int maxVisibleOptions = ComboboxRegistration.DefaultMaxVisibleOptions,
        int asyncDebounceMs = ComboboxRegistration.DefaultAsyncDebounceMs)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(label);

        _source = source;
        _localizer = localizer;
        _label = label;
        _announcer = announcer ?? AnnouncerBus.Shared;
        AllowFreeText = allowFreeText;
        _maxVisibleOptions = Math.Max(1, maxVisibleOptions);
        _asyncDebounceMs = Math.Max(0, asyncDebounceMs);

        // A static source resolves synchronously, so seed the filtered/visible projection up front (web's
        // useMemo computes filteredOptions immediately). An async source fetches nothing until the listbox is
        // opened (web L237: `if (!open && !inputValue) return;`), so it starts empty.
        if (!_source.IsAsync)
        {
            ApplyOptions(LoadStaticUnchecked(string.Empty));
        }
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the committed selection changes (web <c>onChange(value)</c>); null clears it.</summary>
    public event EventHandler<ComboOption?>? SelectionChanged;

    /// <summary>Raised when Enter commits raw typed text in free-text mode (web <c>onFreeTextCommit(text)</c>).</summary>
    public event EventHandler<string>? FreeTextCommitted;

    /// <summary>Raised whenever the user types or clears the input (web <c>onInputChange(text)</c>).</summary>
    public event EventHandler<string>? InputChanged;

    /// <summary>The consumer-supplied field + listbox accessible name (web <c>label</c>).</summary>
    public string Label
    {
        get => _label;
        set
        {
            string next = value ?? string.Empty;
            if (_label == next)
            {
                return;
            }

            _label = next;
            RaiseAll();
        }
    }

    /// <summary>Whether Enter commits raw typed text when no option is active (web <c>allowFreeText</c>).</summary>
    public bool AllowFreeText { get; }

    /// <summary>The cap on rendered options (web <c>maxVisibleOptions</c>).</summary>
    public int MaxVisibleOptions => _maxVisibleOptions;

    /// <summary>Whether this combobox loads its options asynchronously (web <c>isAsync</c>).</summary>
    public bool IsAsync => _source.IsAsync;

    /// <summary>Whether the field is disabled — typing, opening and key handling are inert (web <c>disabled</c>).</summary>
    public bool IsDisabled
    {
        get => _disabled;
        set
        {
            if (_disabled == value)
            {
                return;
            }

            _disabled = value;
            if (_disabled && _open)
            {
                CloseInternal();
            }

            RaiseAll();
        }
    }

    /// <summary>Whether the listbox is open (web <c>open</c>).</summary>
    public bool IsOpen => _open;

    /// <summary>The current type-ahead text (web <c>inputValue</c>).</summary>
    public string InputText => _inputText;

    /// <summary>The options rendered in the listbox, capped at <see cref="MaxVisibleOptions"/> (web <c>visibleOptions</c>).</summary>
    public IReadOnlyList<ComboOption> VisibleOptions => _visible;

    /// <summary>The total options matching the query, before the cap (web <c>filteredOptions.length</c>).</summary>
    public int FilteredCount => _filtered.Count;

    /// <summary>The number of matching options hidden by the cap (web <c>filteredOptions.length - visibleOptions.length</c>).</summary>
    public int HiddenCount => Math.Max(0, _filtered.Count - _visible.Count);

    /// <summary>Whether the capped-list overflow row is shown (web <c>filteredOptions.length &gt; visibleOptions.length</c>).</summary>
    public bool HasOverflow => HiddenCount > 0;

    /// <summary>Index of the keyboard-active option within <see cref="VisibleOptions"/> (-1 = none; web <c>activeIndex</c>).</summary>
    public int ActiveIndex => _activeIndex;

    /// <summary>The keyboard-active option, or null (web <c>visibleOptions[activeIndex]</c>).</summary>
    public ComboOption? ActiveOption =>
        _activeIndex >= 0 && _activeIndex < _visible.Count ? _visible[_activeIndex] : null;

    /// <summary>Whether a fetch is in flight (web <c>loading = loadingProp || asyncLoading</c>).</summary>
    public bool IsLoading => _loading;

    /// <summary>The committed selected option, or null (web <c>value</c>).</summary>
    public ComboOption? SelectedOption => _selected;

    /// <summary>The committed selected value, or null (web <c>value</c>'s key).</summary>
    public string? SelectedValue => _selected?.Value;

    /// <summary>The listbox content state — loading, empty or results (web dropdown branches).</summary>
    public ComboboxResultStatus Status =>
        _loading && _visible.Count == 0 ? ComboboxResultStatus.Loading
        : _visible.Count == 0 ? ComboboxResultStatus.Empty
        : ComboboxResultStatus.Results;

    /// <summary>Whether the clear (×) button is shown (web <c>value !== null || inputValue.length &gt; 0</c>, gated by enabled).</summary>
    public bool ShowClear => !_disabled && (_selected is not null || _inputText.Length > 0);

    /// <summary>The localized busy label / spinner accessible name (web <c>t('combobox.loading')</c>).</summary>
    public string LoadingLabel => _localizer.GetString(ComboboxRegistration.LoadingKey, ComboboxRegistration.LoadingFallback);

    /// <summary>The localized empty-state row text (web <c>t('combobox.noResults')</c>).</summary>
    public string NoResultsLabel => _localizer.GetString(ComboboxRegistration.NoResultsKey, ComboboxRegistration.NoResultsFallback);

    /// <summary>The localized clear (×) button accessible name (web <c>t('combobox.clearAria')</c>).</summary>
    public string ClearLabel => _localizer.GetString(ComboboxRegistration.ClearAriaKey, ComboboxRegistration.ClearAriaFallback);

    /// <summary>The localized chevron-toggle accessible name for the current open state (web <c>closeListAria</c> / <c>openListAria</c>).</summary>
    public string ToggleLabel => _open
        ? _localizer.GetString(ComboboxRegistration.CloseListAriaKey, ComboboxRegistration.CloseListAriaFallback)
        : _localizer.GetString(ComboboxRegistration.OpenListAriaKey, ComboboxRegistration.OpenListAriaFallback);

    /// <summary>The localized capped-list overflow row text, interpolated with <see cref="HiddenCount"/> (web <c>moreHidden</c>).</summary>
    public string OverflowLabel => ComboboxRegistration.FormatMoreHidden(
        _localizer.GetString(ComboboxRegistration.MoreHiddenKey, ComboboxRegistration.MoreHiddenFallback),
        HiddenCount);

    /// <summary>
    /// The localized live result-count announcement for the current query (web L289-L294): "No results" at
    /// zero, "1 result" at one, "{{count}} results" otherwise — computed from <see cref="FilteredCount"/>.
    /// </summary>
    public string ResultsAnnouncement => ComboboxRegistration.ResultsAnnouncement(
        FilteredCount,
        _localizer.GetString(ComboboxRegistration.NoResultsKey, ComboboxRegistration.NoResultsFallback),
        _localizer.GetString(ComboboxRegistration.ResultsCountOneKey, ComboboxRegistration.ResultsCountOneFallback),
        _localizer.GetString(ComboboxRegistration.ResultsCountKey, ComboboxRegistration.ResultsCountFallback));

    /// <summary>Set the committed selection from the host (web <c>value</c> prop). Reverts the closed input text to the option's label.</summary>
    public void SetSelectedOption(ComboOption? option)
    {
        _selected = option;

        // web L221-L225: while uncontrolled and closed, the visible text tracks the selected option's label.
        if (!_open)
        {
            _inputText = option?.Label ?? string.Empty;
        }

        RaiseAll();
    }

    /// <summary>Open the listbox (web focus / chevron open), then load options for the current query.</summary>
    public void Open() => _ = OpenAsync();

    /// <summary>Open the listbox and refresh — the awaitable core of <see cref="Open"/> (exposed for tests).</summary>
    public Task OpenAsync()
    {
        // A disabled field never opens (web focus/open is gated by disabled); an already-open one is a no-op.
        if (_disabled || _open)
        {
            return Task.CompletedTask;
        }

        return OpenAndRefresh();
    }

    /// <summary>Toggle the listbox open/closed (web chevron button).</summary>
    public void Toggle()
    {
        if (_disabled)
        {
            return;
        }

        if (_open)
        {
            Close();
        }
        else
        {
            Open();
        }
    }

    /// <summary>Set the type-ahead text from user input (web <c>handleInputChange</c>); opens the listbox and refreshes.</summary>
    public void SetInputText(string text) => _ = SetInputTextAsync(text);

    /// <summary>Set the type-ahead text and refresh — the awaitable core of <see cref="SetInputText"/> (exposed for tests).</summary>
    public Task SetInputTextAsync(string text)
    {
        if (_disabled)
        {
            return Task.CompletedTask;
        }

        string next = text ?? string.Empty;
        _inputText = next;
        InputChanged?.Invoke(this, next);

        // web handleInputChange: `if (!open) setOpen(true);`
        _open = true;
        RaiseAll();
        return RefreshAsync();
    }

    /// <summary>Move the active descendant by <paramref name="delta"/> with wrap-around (web ArrowUp / ArrowDown).</summary>
    public void MoveActive(int delta)
    {
        if (!_open)
        {
            // web: ArrowUp / ArrowDown while closed just opens the listbox.
            Open();
            return;
        }

        if (_visible.Count == 0)
        {
            return;
        }

        int count = _visible.Count;
        int next = ((_activeIndex + delta) % count + count) % count;
        SetActiveIndex(next);
    }

    /// <summary>Move the active descendant to the first option (web Home).</summary>
    public void ActivateFirst()
    {
        if (_open && _visible.Count > 0)
        {
            SetActiveIndex(0);
        }
    }

    /// <summary>Move the active descendant to the last option (web End).</summary>
    public void ActivateLast()
    {
        if (_open && _visible.Count > 0)
        {
            SetActiveIndex(_visible.Count - 1);
        }
    }

    /// <summary>Set the active descendant explicitly (web option <c>onMouseEnter</c>).</summary>
    public void SetActiveIndex(int index)
    {
        int clamped = _visible.Count == 0 ? -1 : Math.Clamp(index, 0, _visible.Count - 1);
        if (clamped == _activeIndex)
        {
            return;
        }

        _activeIndex = clamped;
        RaiseAll();
    }

    /// <summary>
    /// Commit the active option, or — in free-text mode with no active option — the trimmed typed text
    /// (web Enter, L438-L446). A disabled active option is not committed (consistent with the shared
    /// <see cref="ComboboxFilter"/> model, which never commits a disabled option). Returns true when
    /// something was committed.
    /// </summary>
    public bool CommitActiveOrFreeText()
    {
        if (_open && ActiveOption is { } option)
        {
            if (option.Disabled)
            {
                return false;
            }

            CommitOption(option);
            return true;
        }

        string trimmed = _inputText.Trim();
        if (AllowFreeText && trimmed.Length > 0)
        {
            CommitFreeText(trimmed);
            return true;
        }

        return false;
    }

    /// <summary>Commit a specific option (web option <c>onClick</c> / Tab on a highlighted option). Disabled options are ignored.</summary>
    public void CommitOption(ComboOption option)
    {
        ArgumentNullException.ThrowIfNull(option);
        if (option.Disabled)
        {
            return;
        }

        _selected = option;
        _inputText = option.Label;
        _activeIndex = -1;
        _open = false;
        CancelQuery();
        RaiseAll();
        SelectionChanged?.Invoke(this, option);
    }

    /// <summary>Commit raw typed text in free-text mode (web <c>commitFreeText</c>); clears the structured selection.</summary>
    public void CommitFreeText(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        // web commitFreeText: onFreeTextCommit(text); onChange(null) — the typed text no longer matches a value.
        _selected = null;
        _activeIndex = -1;
        _open = false;
        CancelQuery();
        RaiseAll();
        FreeTextCommitted?.Invoke(this, text);
        SelectionChanged?.Invoke(this, null);
    }

    /// <summary>Commit the active option on Tab, else close without committing (web Tab, L454-L462).</summary>
    public void HandleTab()
    {
        if (_open && ActiveOption is { Disabled: false } option)
        {
            CommitOption(option);
        }
        else
        {
            Close();
        }
    }

    /// <summary>Close the listbox without committing, reverting the text to the selected option's label (web <c>closeWithoutCommit</c> / Esc).</summary>
    public void Close()
    {
        if (!_open)
        {
            return;
        }

        CloseInternal();
        RaiseAll();
    }

    /// <summary>Clear the selection + text, then open the listbox (web clear button <c>handleClear</c>).</summary>
    public void Clear() => _ = ClearAsync();

    /// <summary>Clear and refresh — the awaitable core of <see cref="Clear"/> (exposed for tests).</summary>
    public Task ClearAsync()
    {
        if (_disabled)
        {
            return Task.CompletedTask;
        }

        // web handleClear: onChange(null); updateInputText(''); setActiveIndex(-1); focus(); setOpen(true).
        bool hadSelection = _selected is not null;
        _selected = null;
        _inputText = string.Empty;
        _activeIndex = -1;
        _open = true;
        InputChanged?.Invoke(this, string.Empty);
        RaiseAll();
        if (hadSelection)
        {
            SelectionChanged?.Invoke(this, null);
        }

        return RefreshAsync();
    }

    /// <summary>
    /// Load (or re-filter) options for the current query and update the projection — the awaitable core the
    /// view triggers and tests await. Static sources resolve synchronously; async sources debounce, cancel
    /// the previous request on each keystroke, surface the in-flight spinner and drop superseded results.
    /// </summary>
    public async Task RefreshAsync()
    {
        if (!_source.IsAsync)
        {
            // web static branch: filter synchronously through the shared filter — no spinner, no debounce.
            ApplyOptions(LoadStaticUnchecked(_inputText));
            AnnounceResults();
            return;
        }

        // web async effect L237: don't fetch before the user opens the listbox with an empty query.
        if (!_open && _inputText.Length == 0)
        {
            return;
        }

        CancelQuery();
        var cts = new CancellationTokenSource();
        _queryCts = cts;
        CancellationToken token = cts.Token;
        string query = _inputText;

        try
        {
            if (_asyncDebounceMs > 0)
            {
                // web: the fetch is debounced; a newer keystroke cancels the timer before it fires.
                await Task.Delay(_asyncDebounceMs, token).ConfigureAwait(false);
            }

            token.ThrowIfCancellationRequested();

            SetLoading(true);
            IReadOnlyList<ComboOption> result = await _source.LoadAsync(query, token).ConfigureAwait(false);
            if (token.IsCancellationRequested)
            {
                return;
            }

            ApplyOptions(result);
            SetLoading(false);
            AnnounceResults();
        }
        catch (OperationCanceledException)
        {
            // web: a superseded keystroke aborted the request — keep the stale result out of the UI.
        }
        finally
        {
            if (ReferenceEquals(_queryCts, cts))
            {
                _queryCts = null;
                if (_loading)
                {
                    SetLoading(false);
                }
            }

            cts.Dispose();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancelQuery();
        GC.SuppressFinalize(this);
    }

    private async Task OpenAndRefresh()
    {
        _open = true;
        RaiseAll();
        await RefreshAsync().ConfigureAwait(false);
    }

    private void CloseInternal()
    {
        _open = false;
        _activeIndex = -1;
        CancelQuery();
        if (_loading)
        {
            SetLoading(false);
        }

        // web closeWithoutCommit: uncontrolled text reverts to the selected option's label (or empty).
        _inputText = _selected?.Label ?? string.Empty;
    }

    private IReadOnlyList<ComboOption> LoadStaticUnchecked(string query)
    {
        // The static source's LoadAsync completes synchronously; observe the result without blocking.
        return _source.LoadAsync(query, CancellationToken.None).GetAwaiter().GetResult();
    }

    private void ApplyOptions(IReadOnlyList<ComboOption> filtered)
    {
        _filtered = filtered ?? NoOptions;
        _visible = _filtered.Count > _maxVisibleOptions
            ? _filtered.Take(_maxVisibleOptions).ToArray()
            : _filtered;

        // web L312-L321: keep a still-valid active index, else default to the first option; -1 when closed/empty.
        if (!_open || _visible.Count == 0)
        {
            _activeIndex = -1;
        }
        else if (_activeIndex < 0 || _activeIndex >= _visible.Count)
        {
            _activeIndex = 0;
        }

        RaiseAll();
    }

    private void AnnounceResults()
    {
        // web L285-L299: announce the result count while open and not loading, de-duplicated.
        if (!_open || _loading)
        {
            return;
        }

        string message = ResultsAnnouncement;
        if (message == _lastAnnounced)
        {
            return;
        }

        _lastAnnounced = message;
        _announcer.Announce(message);
    }

    private void SetLoading(bool value)
    {
        if (_loading == value)
        {
            return;
        }

        _loading = value;
        RaiseAll();
    }

    private void CancelQuery()
    {
        CancellationTokenSource? cts = _queryCts;
        _queryCts = null;
        if (cts is null)
        {
            return;
        }

        try
        {
            cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // The request already completed and disposed its source; nothing to cancel.
        }
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
