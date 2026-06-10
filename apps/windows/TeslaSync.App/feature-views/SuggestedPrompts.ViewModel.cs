using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SuggestedPrompts"/> view — the native port of the
/// web <c>SuggestedPrompts</c> (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). The web
/// component binds a single hook (<c>useTranslation</c>) and maps the static <c>getChatSuggestions()</c> list,
/// so this holder performs no HTTP: it projects the injected catalog through
/// <see cref="SuggestedPromptsProjection"/> into the localized <see cref="Items"/> and decides the
/// <see cref="State"/> (<see cref="SuggestedPromptState.Ready"/> vs the defensive
/// <see cref="SuggestedPromptState.Empty"/>). <see cref="Reload"/> re-resolves every label — the native
/// analogue of react-i18next re-rendering the chips when the active language changes. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SuggestedPromptsViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<ChatSuggestion> _catalog;

    private IReadOnlyList<SuggestedPromptItem> _items;
    private SuggestedPromptState _state;

    /// <summary>
    /// Creates the holder over its localizer and (optional) catalog. A <see langword="null"/> catalog falls
    /// back to <see cref="ChatSuggestionCatalog.Default"/> — the four canonical chat suggestions.
    /// </summary>
    public SuggestedPromptsViewModel(ILocalizer localizer, IReadOnlyList<ChatSuggestion>? catalog = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _catalog = catalog ?? ChatSuggestionCatalog.Default;
        _items = SuggestedPromptsProjection.Project(_catalog, _localizer);
        _state = _items.Count > 0 ? SuggestedPromptState.Ready : SuggestedPromptState.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SuggestedPromptState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, localized, render-ready chips (empty in the <see cref="SuggestedPromptState.Empty"/> state).</summary>
    public IReadOnlyList<SuggestedPromptItem> Items
    {
        get => _items;
        private set
        {
            _items = value;
            Raise(nameof(Items));
            Raise(nameof(HasSuggestions));
        }
    }

    /// <summary>True when at least one suggestion is available (web parity: the chip strip renders).</summary>
    public bool HasSuggestions => _items.Count > 0;

    /// <summary>The localized Narrator landmark name for the chip strip (web <c>aria-label</c>).</summary>
    public string RegionName => SuggestedPromptsRegistration.RegionName(_localizer);

    /// <summary>The localized friendly empty-state message shown when no suggestions are available.</summary>
    public string EmptyMessage => SuggestedPromptsRegistration.EmptyMessage(_localizer);

    /// <summary>
    /// Re-resolve every label from the localizer and re-derive the state — the native analogue of
    /// react-i18next re-rendering the chips after the active language changes. Raises change notifications so
    /// the view re-renders without being reconstructed.
    /// </summary>
    public void Reload()
    {
        Items = SuggestedPromptsProjection.Project(_catalog, _localizer);
        State = _items.Count > 0 ? SuggestedPromptState.Ready : SuggestedPromptState.Empty;
        Raise(nameof(RegionName));
        Raise(nameof(EmptyMessage));
    }

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
