using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>A template edit (new text + caret to restore) raised when a token is inserted or a preset applied.</summary>
public readonly record struct TemplateEdit(string Text, int Caret);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AlertMessageEditor"/> view — the native port
/// of the web <c>AlertMessageEditor</c>'s hook composition
/// (web/src/features/notifications/components/AlertMessageEditor.tsx). It owns the editor's working state
/// (template body, include-title toggle, autocomplete cursor, preset filter, preview cache), composes the
/// three data sources (insert-token catalog, preset gallery, live preview), and exposes the mutually
/// exclusive catalog/preview states plus the derived, display-ready collections so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AlertMessageEditorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMessageTokenSource _tokenSource;
    private readonly IMessagePresetSource _presetSource;
    private readonly IMessagePreviewSource _previewSource;
    private readonly ILocalizer _localizer;
    private readonly Func<CancellationToken, Task> _previewDelay;

    private AlertRuleDraft _draft;
    private string _msgTemplate;
    private bool _includeTitle;

    // Token catalog (autocomplete source).
    private IReadOnlyList<MessageToken> _allTokens = Array.Empty<MessageToken>();
    private IReadOnlySet<string> _availableKeys = new HashSet<string>(StringComparer.Ordinal);
    private AlertMessageCatalogState _tokensState = AlertMessageCatalogState.Loading;
    private string? _tokensError;

    // Autocomplete popover.
    private bool _autocompleteOpen;
    private int _triggerIndex = -1;
    private int _lastCaret;
    private string _autocompleteFilter = string.Empty;
    private int _cursor;
    private IReadOnlyList<MessageToken> _filteredTokens = Array.Empty<MessageToken>();
    private IReadOnlyList<MessageTokenGroup> _filteredTokenGroups = Array.Empty<MessageTokenGroup>();

    // Preset gallery.
    private IReadOnlyList<MessagePreset> _allPresets = Array.Empty<MessagePreset>();
    private AlertMessageCatalogState _presetsState = AlertMessageCatalogState.Loading;
    private string? _presetsError;
    private bool _presetGalleryOpen;
    private string? _activeTag;
    private AlertMessageCatalogState _presetsBaseState = AlertMessageCatalogState.Loading;
    private IReadOnlyList<MessagePreset> _filteredPresets = Array.Empty<MessagePreset>();
    private IReadOnlyList<string> _presetTags = Array.Empty<string>();

    // Live preview.
    private AlertMessagePreviewState _previewState = AlertMessagePreviewState.Empty;
    private MessagePreviewResult? _previewResult;
    private string? _previewError;
    private string? _lastPreviewKey;

    private CancellationTokenSource? _tokensCts;
    private CancellationTokenSource? _presetsCts;
    private CancellationTokenSource? _previewCts;
    private bool _disposed;

    /// <summary>Creates the holder over its three data sources, the localizer and the initial editor state.</summary>
    /// <param name="tokenSource">Insert-token catalog source (autocomplete).</param>
    /// <param name="presetSource">Preset gallery source.</param>
    /// <param name="previewSource">Live preview render source.</param>
    /// <param name="localizer">i18n facade.</param>
    /// <param name="draft">The rule draft fed to the preview + token endpoints.</param>
    /// <param name="msgTemplate">The initial template body (<c>""</c> means "use default").</param>
    /// <param name="includeTitle">The initial include-title toggle.</param>
    /// <param name="previewDelay">Debounce delay for the preview render (default 150 ms; pass a no-op in tests).</param>
    public AlertMessageEditorViewModel(
        IMessageTokenSource tokenSource,
        IMessagePresetSource presetSource,
        IMessagePreviewSource previewSource,
        ILocalizer localizer,
        AlertRuleDraft draft,
        string msgTemplate = "",
        bool includeTitle = true,
        Func<CancellationToken, Task>? previewDelay = null)
    {
        ArgumentNullException.ThrowIfNull(tokenSource);
        ArgumentNullException.ThrowIfNull(presetSource);
        ArgumentNullException.ThrowIfNull(previewSource);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(draft);

        _tokenSource = tokenSource;
        _presetSource = presetSource;
        _previewSource = previewSource;
        _localizer = localizer;
        _draft = draft;
        _msgTemplate = msgTemplate ?? string.Empty;
        _includeTitle = includeTitle;
        _previewDelay = previewDelay ?? (ct => Task.Delay(150, ct));
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a token insertion or preset application rewrites the template + caret.</summary>
    public event EventHandler<TemplateEdit>? TemplateEdited;

    /// <summary>The i18n facade (the view composes static labels through <see cref="AlertMessageEditorText"/>).</summary>
    public ILocalizer Localizer => _localizer;

    // ──────────────── Editor inputs ────────────────

    /// <summary>The current template body.</summary>
    public string MsgTemplate
    {
        get => _msgTemplate;
        private set => Set(ref _msgTemplate, value);
    }

    /// <summary>The current include-title toggle.</summary>
    public bool IncludeTitle
    {
        get => _includeTitle;
        private set
        {
            if (Set(ref _includeTitle, value))
            {
                Raise(nameof(ShowPreviewTitle));
            }
        }
    }

    /// <summary>The rule draft fed to the preview + token endpoints. Reassigning re-derives preset op-validity.</summary>
    public AlertRuleDraft Draft
    {
        get => _draft;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (ReferenceEquals(_draft, value))
            {
                return;
            }

            _draft = value;
            Raise(nameof(Draft));
            RecomputePresets();
        }
    }

    // ──────────────── Token catalog / autocomplete ────────────────

    /// <summary>The token catalog load state (drives the autocomplete loading/empty/error surfaces).</summary>
    public AlertMessageCatalogState TokensState
    {
        get => _tokensState;
        private set => Set(ref _tokensState, value);
    }

    /// <summary>Localized error for a failed token catalog load.</summary>
    public string? TokensError
    {
        get => _tokensError;
        private set => Set(ref _tokensError, value);
    }

    /// <summary>True while the token catalog has no rows and is still loading (web token query loading flag).</summary>
    public bool TokensLoading => _tokensState == AlertMessageCatalogState.Loading;

    /// <summary>Whether the autocomplete popover is open.</summary>
    public bool AutocompleteOpen
    {
        get => _autocompleteOpen;
        private set => Set(ref _autocompleteOpen, value);
    }

    /// <summary>The highlighted index within <see cref="FilteredTokens"/> (keyboard navigation).</summary>
    public int Cursor
    {
        get => _cursor;
        private set => Set(ref _cursor, value);
    }

    /// <summary>The filtered, flat token list the popover shows (web token-filter memo).</summary>
    public IReadOnlyList<MessageToken> FilteredTokens
    {
        get => _filteredTokens;
        private set
        {
            _filteredTokens = value;
            Raise(nameof(FilteredTokens));
            Raise(nameof(HasFilteredTokens));
        }
    }

    /// <summary>The filtered tokens grouped for the popover render (web <c>grouped</c>).</summary>
    public IReadOnlyList<MessageTokenGroup> FilteredTokenGroups
    {
        get => _filteredTokenGroups;
        private set => Set(ref _filteredTokenGroups, value);
    }

    /// <summary>True when the popover has at least one suggestion.</summary>
    public bool HasFilteredTokens => _filteredTokens.Count > 0;

    /// <summary>The currently-highlighted token, or <see langword="null"/> when the list is empty.</summary>
    public MessageToken? HighlightedToken =>
        _filteredTokens.Count == 0 ? null : _filteredTokens[Math.Clamp(_cursor, 0, _filteredTokens.Count - 1)];

    // ──────────────── Preset gallery ────────────────

    /// <summary>The preset catalog load state (drives the gallery loading/empty/error surfaces).</summary>
    public AlertMessageCatalogState PresetsState
    {
        get => _presetsState;
        private set => Set(ref _presetsState, value);
    }

    /// <summary>Localized error for a failed preset catalog load.</summary>
    public string? PresetsError
    {
        get => _presetsError;
        private set => Set(ref _presetsError, value);
    }

    /// <summary>Whether the preset gallery modal is open.</summary>
    public bool PresetGalleryOpen
    {
        get => _presetGalleryOpen;
        private set => Set(ref _presetGalleryOpen, value);
    }

    /// <summary>The active tag filter chip (null = "All").</summary>
    public string? ActiveTag
    {
        get => _activeTag;
        private set => Set(ref _activeTag, value);
    }

    /// <summary>The op-valid, tag-filtered presets the gallery shows (web <c>filteredPresets</c>).</summary>
    public IReadOnlyList<MessagePreset> FilteredPresets
    {
        get => _filteredPresets;
        private set
        {
            _filteredPresets = value;
            Raise(nameof(FilteredPresets));
            Raise(nameof(HasPresets));
        }
    }

    /// <summary>The tag chips for the gallery (web <c>presetTags</c>).</summary>
    public IReadOnlyList<string> PresetTags
    {
        get => _presetTags;
        private set => Set(ref _presetTags, value);
    }

    /// <summary>True when the gallery has at least one preset under the active filter.</summary>
    public bool HasPresets => _filteredPresets.Count > 0;

    // ──────────────── Live preview ────────────────

    /// <summary>The preview pane state.</summary>
    public AlertMessagePreviewState PreviewState
    {
        get => _previewState;
        private set => Set(ref _previewState, value);
    }

    /// <summary>The rendered preview title (empty until a render arrives).</summary>
    public string PreviewTitle => _previewResult?.Title ?? string.Empty;

    /// <summary>
    /// The rendered preview body, or the localized "title carries the alert" note when the render produced
    /// an empty body (web parity: the <c>&lt;em&gt;</c> fallback).
    /// </summary>
    public string PreviewBody =>
        _previewResult is { } r && !string.IsNullOrEmpty(r.Body)
            ? r.Body
            : AlertMessageEditorText.PreviewEmptyBody(_localizer);

    /// <summary>True when the rendered body was empty and the localized note is shown instead.</summary>
    public bool PreviewBodyIsEmptyNote => _previewResult is { } r && string.IsNullOrEmpty(r.Body);

    /// <summary>Localized preview error message.</summary>
    public string? PreviewError
    {
        get => _previewError;
        private set => Set(ref _previewError, value);
    }

    /// <summary>True when the preview title row should render (web parity: <c>includeTitle &amp;&amp; preview.title</c>).</summary>
    public bool ShowPreviewTitle => _includeTitle && _previewResult is { } r && !string.IsNullOrEmpty(r.Title);

    // ──────────────── Lifecycle ────────────────

    /// <summary>
    /// Start the editor: load the token catalog (for the current draft) and the preset gallery (for the
    /// draft kind) as cache-then-network streams, and fire the first preview render.
    /// </summary>
    public Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var tokens = ReloadTokensAsync(cancellationToken);
        var presets = ReloadPresetsAsync(cancellationToken);
        SchedulePreviewRefresh();
        return Task.WhenAll(tokens, presets);
    }

    /// <summary>(Re)load the token catalog for the current draft.</summary>
    public async Task ReloadTokensAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _tokensCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (_allTokens.Count == 0)
        {
            TokensState = AlertMessageCatalogState.Loading;
        }

        try
        {
            await foreach (var result in _tokenSource.StreamAsync(MessageTokenQuery.FromDraft(_draft), cts.Token)
                .ConfigureAwait(false))
            {
                ApplyTokens(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently.
        }
    }

    /// <summary>(Re)load the preset gallery for the current draft kind.</summary>
    public async Task ReloadPresetsAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _presetsCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (_allPresets.Count == 0)
        {
            PresetsState = AlertMessageCatalogState.Loading;
        }

        try
        {
            await foreach (var result in _presetSource.StreamAsync(_draft.Kind, cts.Token).ConfigureAwait(false))
            {
                ApplyPresets(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently.
        }
    }

    // ──────────────── Template editing + autocomplete ────────────────

    /// <summary>
    /// Handle a textarea edit: adopt the new <paramref name="text"/>, run the <c>{{</c> autocomplete scan at
    /// <paramref name="caret"/>, and schedule a debounced preview refresh (web <c>handleTextareaChange</c>).
    /// </summary>
    public void OnTemplateChanged(string text, int caret)
    {
        ArgumentNullException.ThrowIfNull(text);
        MsgTemplate = text;
        _lastCaret = Math.Clamp(caret, 0, text.Length);

        var hit = TemplateLogic.Scan(text, caret);
        if (hit.Open)
        {
            _triggerIndex = hit.TriggerIndex;
            _autocompleteFilter = hit.Filter;
            AutocompleteOpen = true;
            Cursor = 0;
            RecomputeFilteredTokens();
        }
        else
        {
            CloseAutocomplete();
        }

        SchedulePreviewRefresh();
    }

    /// <summary>Move the autocomplete highlight down one (wrapping), matching the web ArrowDown handler.</summary>
    public void MoveCursorDown()
    {
        if (!_autocompleteOpen || _filteredTokens.Count == 0)
        {
            return;
        }

        Cursor = (_cursor + 1) % _filteredTokens.Count;
    }

    /// <summary>Move the autocomplete highlight up one (wrapping), matching the web ArrowUp handler.</summary>
    public void MoveCursorUp()
    {
        if (!_autocompleteOpen || _filteredTokens.Count == 0)
        {
            return;
        }

        Cursor = ((_cursor - 1) + _filteredTokens.Count) % _filteredTokens.Count;
    }

    /// <summary>Accept the highlighted suggestion (web Enter/Tab handler). No-op when the list is empty.</summary>
    public void AcceptHighlighted()
    {
        if (_autocompleteOpen && HighlightedToken is { } token)
        {
            InsertToken(token);
        }
    }

    /// <summary>
    /// Splice <paramref name="token"/> into the template at the active trigger window and close the popover
    /// (web token-insertion handler). Raises <see cref="TemplateEdited"/> so the view restores the caret.
    /// </summary>
    public void InsertToken(MessageToken token)
    {
        ArgumentNullException.ThrowIfNull(token);
        if (_triggerIndex < 0)
        {
            return;
        }

        int caret = Math.Clamp(_lastCaret, _triggerIndex, _msgTemplate.Length);
        var edit = TemplateLogic.InsertToken(_msgTemplate, _triggerIndex, caret, token.Key);
        MsgTemplate = edit.Text;
        CloseAutocomplete();
        TemplateEdited?.Invoke(this, new TemplateEdit(edit.Text, edit.Caret));
        SchedulePreviewRefresh();
    }

    /// <summary>Close the autocomplete popover and reset its cursor/trigger (web <c>closeAutocomplete</c>).</summary>
    public void CloseAutocomplete()
    {
        AutocompleteOpen = false;
        _triggerIndex = -1;
        _autocompleteFilter = string.Empty;
        Cursor = 0;
        FilteredTokens = Array.Empty<MessageToken>();
        FilteredTokenGroups = Array.Empty<MessageTokenGroup>();
    }

    // ──────────────── Include-title + preset gallery ────────────────

    /// <summary>Toggle the include-title flag and refresh the preview (web <c>onIncludeTitleChange</c>).</summary>
    public void SetIncludeTitle(bool value)
    {
        IncludeTitle = value;
        SchedulePreviewRefresh();
    }

    /// <summary>Open the preset gallery modal.</summary>
    public void OpenPresetGallery() => PresetGalleryOpen = true;

    /// <summary>Close the preset gallery modal.</summary>
    public void ClosePresetGallery() => PresetGalleryOpen = false;

    /// <summary>Set the active tag filter (null = "All") and re-derive the filtered presets.</summary>
    public void SetActiveTag(string? tag)
    {
        // Guard against a tag that the current op-valid gallery no longer offers (web reset effect).
        string? next = tag is not null && !_presetTags.Contains(tag, StringComparer.Ordinal) ? null : tag;
        ActiveTag = next;
        RecomputeFilteredPresets();
    }

    /// <summary>
    /// Apply <paramref name="preset"/>'s template, close the gallery and refresh the preview
    /// (web <c>applyPreset</c>). Raises <see cref="TemplateEdited"/> so the view updates the textarea.
    /// </summary>
    public void ApplyPreset(MessagePreset preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        MsgTemplate = preset.Template;
        PresetGalleryOpen = false;
        CloseAutocomplete();
        TemplateEdited?.Invoke(this, new TemplateEdit(preset.Template, preset.Template.Length));
        SchedulePreviewRefresh();
    }

    // ──────────────── Preview ────────────────

    /// <summary>Schedule a debounced preview refresh, superseding any pending one (web 150 ms debounce).</summary>
    public void SchedulePreviewRefresh()
    {
        if (_disposed)
        {
            return;
        }

        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _previewCts, cts);
        previous?.Cancel();
        previous?.Dispose();
        _ = DebouncedPreviewAsync(cts.Token);
    }

    /// <summary>
    /// Render the preview immediately (bypassing the debounce) and fold the outcome into the preview state.
    /// Skips the round-trip when the inputs are unchanged since the last render (web <c>previewKey</c> memo).
    /// </summary>
    public async Task RefreshPreviewNowAsync(CancellationToken cancellationToken = default)
    {
        var request = MessagePreviewRequest.From(_draft, _msgTemplate, _includeTitle);
        string key = request.DebounceKey();
        if (string.Equals(key, _lastPreviewKey, StringComparison.Ordinal) && _previewResult is not null)
        {
            return;
        }

        if (_previewResult is null)
        {
            PreviewState = AlertMessagePreviewState.Loading;
        }

        var outcome = await _previewSource.PreviewAsync(request, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        _lastPreviewKey = key;

        if (outcome.Success && outcome.Result is { } result)
        {
            _previewResult = result;
            PreviewError = null;
            Raise(nameof(PreviewTitle));
            Raise(nameof(PreviewBody));
            Raise(nameof(PreviewBodyIsEmptyNote));
            Raise(nameof(ShowPreviewTitle));
            PreviewState = AlertMessagePreviewState.Rendered;
        }
        else
        {
            PreviewError = ErrorTextFor(outcome.Error);
            PreviewState = AlertMessagePreviewState.Error;
        }
    }

    private async Task DebouncedPreviewAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _previewDelay(cancellationToken).ConfigureAwait(false);
            await RefreshPreviewNowAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer edit — drop silently.
        }
    }

    // ──────────────── Stream folding ────────────────

    private void ApplyTokens(RepositoryResult<IReadOnlyList<MessageToken>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (_allTokens.Count == 0)
                {
                    TokensState = AlertMessageCatalogState.Loading;
                }

                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                SetTokens(result.Value!, result.IsStale ? AlertMessageCatalogState.Stale : AlertMessageCatalogState.Loaded, null);
                break;

            case LoadStatus.Loaded:
                SetTokens(result.Value!, AlertMessageCatalogState.Loaded, null);
                break;

            case LoadStatus.Empty:
                SetTokens(Array.Empty<MessageToken>(), AlertMessageCatalogState.Empty, null);
                break;

            case LoadStatus.Offline:
                SetTokens(result.Value!, AlertMessageCatalogState.Offline, ErrorTextFor(result.Error));
                break;

            default:
                _allTokens = Array.Empty<MessageToken>();
                _availableKeys = new HashSet<string>(StringComparer.Ordinal);
                TokensError = ErrorTextFor(result.Error);
                TokensState = AlertMessageCatalogState.Error;
                RecomputeFilteredTokens();
                RecomputePresets();
                break;
        }
    }

    private void SetTokens(IReadOnlyList<MessageToken> tokens, AlertMessageCatalogState state, string? error)
    {
        _allTokens = tokens;
        _availableKeys = PresetGallery.AvailableKeys(tokens);
        TokensError = error;
        TokensState = tokens.Count == 0 && state == AlertMessageCatalogState.Loaded
            ? AlertMessageCatalogState.Empty
            : state;
        RecomputeFilteredTokens();
        RecomputePresets();
    }

    private void ApplyPresets(RepositoryResult<IReadOnlyList<MessagePreset>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (_allPresets.Count == 0)
                {
                    _presetsBaseState = AlertMessageCatalogState.Loading;
                    RecomputePresets();
                }

                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                SetPresets(result.Value!, result.IsStale ? AlertMessageCatalogState.Stale : AlertMessageCatalogState.Loaded, null);
                break;

            case LoadStatus.Loaded:
                SetPresets(result.Value!, AlertMessageCatalogState.Loaded, null);
                break;

            case LoadStatus.Empty:
                SetPresets(Array.Empty<MessagePreset>(), AlertMessageCatalogState.Empty, null);
                break;

            case LoadStatus.Offline:
                SetPresets(result.Value!, AlertMessageCatalogState.Offline, ErrorTextFor(result.Error));
                break;

            default:
                _allPresets = Array.Empty<MessagePreset>();
                PresetsError = ErrorTextFor(result.Error);
                _presetsBaseState = AlertMessageCatalogState.Error;
                RecomputePresets();
                break;
        }
    }

    private void SetPresets(IReadOnlyList<MessagePreset> presets, AlertMessageCatalogState state, string? error)
    {
        _allPresets = presets;
        PresetsError = error;
        _presetsBaseState = state;
        RecomputePresets();
    }

    // ──────────────── Derived recomputation ────────────────

    private void RecomputeFilteredTokens()
    {
        var filtered = TokenCatalog.Filter(_allTokens, _autocompleteFilter);
        FilteredTokens = filtered;
        FilteredTokenGroups = TokenCatalog.Group(filtered);

        // Re-clamp the cursor (web useEffect): a shrunken list may leave it past the end.
        if (filtered.Count == 0)
        {
            Cursor = 0;
        }
        else if (_cursor > filtered.Count - 1)
        {
            Cursor = filtered.Count - 1;
        }
    }

    private void RecomputePresets()
    {
        var opValid = PresetGallery.OpValid(_allPresets, _availableKeys, _draft.Op, TokensLoading);
        var tags = PresetGallery.Tags(opValid);
        PresetTags = tags;

        // Drop a now-empty tag filter back to "All" (web useEffect).
        if (_activeTag is not null && !tags.Contains(_activeTag, StringComparer.Ordinal))
        {
            ActiveTag = null;
        }

        // Collapse a loaded-but-empty gallery to the empty state.
        PresetsState = _allPresets.Count == 0 && _presetsBaseState == AlertMessageCatalogState.Loaded
            ? AlertMessageCatalogState.Empty
            : _presetsBaseState;

        RecomputeFilteredPresets();
    }

    private void RecomputeFilteredPresets()
    {
        var opValid = PresetGallery.OpValid(_allPresets, _availableKeys, _draft.Op, TokensLoading);
        FilteredPresets = PresetGallery.FilterByTag(opValid, _activeTag);
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "common.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "common.error.offline",
            _ => "common.error.generic",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to continue",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing cached data",
            _ => error?.Message is { Length: > 0 } m ? m : "Something went wrong",
        };

        return _localizer.GetString(key, fallback);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _tokensCts);
        Cancel(ref _presetsCts);
        Cancel(ref _previewCts);
        GC.SuppressFinalize(this);
    }

    private static void Cancel(ref CancellationTokenSource? cts)
    {
        var current = Interlocked.Exchange(ref cts, null);
        current?.Cancel();
        current?.Dispose();
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
