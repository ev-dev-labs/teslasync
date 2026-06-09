using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ReferenceLinksSection"/> view — the native port of
/// the web <c>ReferenceLinksSection</c> (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx).
/// The web component binds a single hook (<c>useTranslation</c>) and maps the static <c>REFERENCE_LINKS</c>
/// catalog, so this holder performs no HTTP: it projects the injected catalog through
/// <see cref="ReferenceLinksProjection"/> into the localized <see cref="Items"/> and decides the
/// <see cref="State"/> (<see cref="ReferenceLinkState.Ready"/> vs the defensive
/// <see cref="ReferenceLinkState.Empty"/>). <see cref="Reload"/> re-resolves every label — the native analogue
/// of react-i18next re-rendering the titles when the active language changes. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ReferenceLinksViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<ReferenceLink> _catalog;

    private IReadOnlyList<ReferenceLinkItem> _items;
    private ReferenceLinkState _state;

    /// <summary>
    /// Creates the holder over its localizer and (optional) catalog. A <see langword="null"/> catalog falls
    /// back to <see cref="ReferenceLinkCatalog.Default"/> — the four canonical Fleet API references.
    /// </summary>
    public ReferenceLinksViewModel(ILocalizer localizer, IReadOnlyList<ReferenceLink>? catalog = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _catalog = catalog ?? ReferenceLinkCatalog.Default;
        _items = ReferenceLinksProjection.Project(_catalog, _localizer);
        _state = _items.Count > 0 ? ReferenceLinkState.Ready : ReferenceLinkState.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ReferenceLinkState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, localized, render-ready links (empty in the <see cref="ReferenceLinkState.Empty"/> state).</summary>
    public IReadOnlyList<ReferenceLinkItem> Items
    {
        get => _items;
        private set
        {
            _items = value;
            Raise(nameof(Items));
            Raise(nameof(HasLinks));
        }
    }

    /// <summary>True when at least one link is available (web parity: the grid renders).</summary>
    public bool HasLinks => _items.Count > 0;

    /// <summary>The localized Narrator landmark name for the whole section.</summary>
    public string RegionName => ReferenceLinksRegistration.RegionName(_localizer);

    /// <summary>The localized friendly empty-state message shown when no links are available.</summary>
    public string EmptyMessage => ReferenceLinksRegistration.EmptyMessage(_localizer);

    /// <summary>
    /// Re-resolve every label from the localizer and re-derive the state — the native analogue of
    /// react-i18next re-rendering the titles after the active language changes. Raises change notifications so
    /// the view re-renders without being reconstructed.
    /// </summary>
    public void Reload()
    {
        Items = ReferenceLinksProjection.Project(_catalog, _localizer);
        State = _items.Count > 0 ? ReferenceLinkState.Ready : ReferenceLinkState.Empty;
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
