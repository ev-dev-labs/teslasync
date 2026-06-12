using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The render state of the breadcrumb surface — the two outcomes the web source produces. The web
/// <c>Breadcrumbs</c> renderer returns <c>null</c> (an empty slot) when the resolved chain has one or zero items and
/// otherwise draws the trail; there is no loading / error / stale / offline state because the trail is derived
/// synchronously from the current route and the in-memory override map, with no data fetch (the same reason the peer
/// route-derived surfaces — <c>SkipToContent</c>, <c>RouteAnnouncer</c> — have none).
/// </summary>
public enum BreadcrumbState
{
    /// <summary>One or zero crumbs — a top-level page; the row renders an empty slot (web <c>return null</c>).</summary>
    Suppressed,

    /// <summary>Two or more crumbs — the Home link plus the chevron-separated trail render.</summary>
    Resolved,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LayoutBreadcrumbs"/> view — the native port of
/// <c>web/src/components/layout/LayoutBreadcrumbs.tsx</c> and the two data sources it composes
/// (<c>useBreadcrumbs</c> + <c>useBreadcrumbOverrides</c>). The web surface reads the merged per-page override map,
/// resolves the full parent chain for the current route, and feeds the trail to <c>Breadcrumbs</c>, which
/// self-suppresses on a one-or-zero-item chain. This holder reproduces that exactly: it resolves the
/// <see cref="NavLabel"/> and <see cref="HomeLabel"/> once through the <see cref="ILocalizer"/> facade (P1/S10), and
/// re-derives <see cref="Items"/> through <see cref="BreadcrumbResolver"/> from the matched-route seam
/// (<see cref="IBreadcrumbRouteContext"/>) and the override seam (<see cref="IBreadcrumbOverrideSource"/>) whenever
/// either changes — the native analogue of the web hook re-running on a route or override change. Because the trail
/// is synchronous there is no loading / error / stale / offline branch (the web source has none); the only states
/// are <see cref="BreadcrumbState.Suppressed"/> (the empty slot) and <see cref="BreadcrumbState.Resolved"/>, both
/// driven from <see cref="Items"/>. The view performs no routing, i18n or trail derivation of its own — it observes
/// this holder and renders. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LayoutBreadcrumbsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBreadcrumbRouteContext _route;
    private readonly IBreadcrumbOverrideSource _overrides;
    private readonly ILocalizer _localizer;
    private readonly ILayoutBreadcrumbNavigator _navigator;
    private readonly IReadOnlyDictionary<string, BreadcrumbRouteMeta> _routeMeta;
    private readonly LayoutBreadcrumbsDiagnostics _diagnostics;

    private IReadOnlyList<LayoutBreadcrumbItem> _items;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the matched-route + override + navigation seams and the i18n facade.</summary>
    /// <param name="route">The matched-route seam (web <c>useLocation</c> + <c>useParams</c> + match).</param>
    /// <param name="overrides">The per-page override seam (web <c>useBreadcrumbOverrides</c>).</param>
    /// <param name="localizer">The i18n facade labels resolve through (web <c>useTranslation</c>).</param>
    /// <param name="navigator">The navigation seam crumb / Home activations route through; defaults to an inert no-op.</param>
    /// <param name="routeMeta">The breadcrumb metadata lookup (web <c>ROUTE_META</c>); defaults to the app registry.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public LayoutBreadcrumbsViewModel(
        IBreadcrumbRouteContext route,
        IBreadcrumbOverrideSource overrides,
        ILocalizer localizer,
        ILayoutBreadcrumbNavigator? navigator = null,
        IReadOnlyDictionary<string, BreadcrumbRouteMeta>? routeMeta = null,
        LayoutBreadcrumbsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(route);
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(localizer);

        _route = route;
        _overrides = overrides;
        _localizer = localizer;
        _navigator = navigator ?? NullLayoutBreadcrumbNavigator.Instance;
        _routeMeta = routeMeta ?? DefaultBreadcrumbRouteMeta.Map;
        _diagnostics = diagnostics ?? new LayoutBreadcrumbsDiagnostics();

        NavLabel = LayoutBreadcrumbsRegistration.ResolveNavLabel(localizer);
        HomeLabel = LayoutBreadcrumbsRegistration.ResolveHomeLabel(localizer);
        _items = Resolve();

        _route.Changed += OnSourceChanged;
        _overrides.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The resolved breadcrumb trail in root-to-current order (web <c>useBreadcrumbs</c> result).</summary>
    public IReadOnlyList<LayoutBreadcrumbItem> Items => _items;

    /// <summary>True when the trail has one or zero crumbs — a top-level page (web <c>items.length &lt;= 1</c>).</summary>
    public bool IsSuppressed => _items.Count <= 1;

    /// <summary>True when the trail renders (two or more crumbs).</summary>
    public bool HasCrumbs => !IsSuppressed;

    /// <summary>The current render state (web <c>return null</c> vs. the drawn trail).</summary>
    public BreadcrumbState State => IsSuppressed ? BreadcrumbState.Suppressed : BreadcrumbState.Resolved;

    /// <summary>The localized nav landmark label (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c>).</summary>
    public string NavLabel { get; }

    /// <summary>The localized Home link accessible name (web <c>t('a11y.breadcrumbHome', 'Dashboard')</c>).</summary>
    public string HomeLabel { get; }

    /// <summary>The Home link destination (web <c>homeHref = '/'</c>).</summary>
    public static string HomeHref => LayoutBreadcrumbsRegistration.HomeHref;

    /// <summary>The Home affordance glyph (web <c>&lt;Home /&gt;</c>).</summary>
    public static string HomeGlyph => LayoutBreadcrumbsRegistration.HomeGlyph;

    /// <summary>The crumb separator glyph (web <c>&lt;ChevronRight /&gt;</c>).</summary>
    public static string SeparatorGlyph => LayoutBreadcrumbsRegistration.SeparatorGlyph;

    /// <summary>The collapsed-middle indicator shown on a narrow row (web <c>…</c>).</summary>
    public static string CollapseIndicator => LayoutBreadcrumbsRegistration.CollapseIndicator;

    /// <summary>The maximum rendered crumb-label width before truncation (web <c>max-w-[200px]</c>).</summary>
    public static double MaxLabelWidth => LayoutBreadcrumbsRegistration.MaxLabelWidth;

    /// <summary>The row width below which middle crumbs collapse to the indicator (web <c>sm</c> breakpoint).</summary>
    public static double CompactThreshold => LayoutBreadcrumbsRegistration.CompactThreshold;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LayoutBreadcrumbs</c>).</summary>
    public static string Slug => LayoutBreadcrumbsRegistration.Slug;

    /// <summary>
    /// Record the surface opening exactly once (web component mount), emitting the <c>view.opened</c> diagnostic and
    /// the initial trail outcome. Idempotent — a second call is a no-op — so repeated <c>Loaded</c> events never
    /// double-count.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened || _disposed)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
        EmitStateDiagnostic();
    }

    /// <summary>
    /// Activate a crumb (web breadcrumb link click): when the crumb is an interactive ancestor link, navigate to its
    /// href through the navigation seam and record the activation; the current (leaf) crumb is non-interactive and
    /// activating it is a safe no-op (web renders it as a plain <c>span</c>).
    /// </summary>
    /// <param name="item">The crumb that was activated.</param>
    /// <returns>True when navigation occurred; false for the non-interactive current crumb.</returns>
    public bool Activate(LayoutBreadcrumbItem item)
    {
        if (_disposed || !item.IsLink || item.Href is null)
        {
            return false;
        }

        _navigator.Navigate(item.Href);
        _diagnostics.RecordNavigated();
        return true;
    }

    /// <summary>
    /// Activate the leading Home link (web Home icon click): navigate to the Home href through the navigation seam and
    /// record the activation.
    /// </summary>
    public void NavigateHome()
    {
        if (_disposed)
        {
            return;
        }

        _navigator.Navigate(HomeHref);
        _diagnostics.RecordNavigated();
    }

    /// <summary>Detach from the route + override seams and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _route.Changed -= OnSourceChanged;
        _overrides.Changed -= OnSourceChanged;
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        IReadOnlyList<LayoutBreadcrumbItem> next = Resolve();
        if (ItemsEqual(_items, next))
        {
            return;
        }

        _items = next;
        Raise(nameof(Items));
        Raise(nameof(IsSuppressed));
        Raise(nameof(HasCrumbs));
        Raise(nameof(State));

        if (_opened)
        {
            EmitStateDiagnostic();
        }
    }

    private IReadOnlyList<LayoutBreadcrumbItem> Resolve() =>
        BreadcrumbResolver.Resolve(
            _route.MatchedPattern,
            _route.Parameters,
            _overrides.OverrideLabels,
            _routeMeta,
            _localizer);

    private void EmitStateDiagnostic()
    {
        if (IsSuppressed)
        {
            _diagnostics.RecordSuppressed();
        }
        else
        {
            _diagnostics.RecordResolved();
        }
    }

    private static bool ItemsEqual(IReadOnlyList<LayoutBreadcrumbItem> a, IReadOnlyList<LayoutBreadcrumbItem> b)
    {
        if (a.Count != b.Count)
        {
            return false;
        }

        for (int i = 0; i < a.Count; i++)
        {
            if (!a[i].Equals(b[i]))
            {
                return false;
            }
        }

        return true;
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
