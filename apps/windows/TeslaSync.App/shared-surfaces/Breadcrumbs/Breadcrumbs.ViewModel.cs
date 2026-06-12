using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Breadcrumbs"/> view — the native port of the web
/// component (web/src/components/layout/Breadcrumbs.tsx). The web component resolves two localized labels
/// through <c>useTranslation</c> (the <c>Breadcrumb</c> landmark name and the <c>Dashboard</c> Home-link
/// name), self-suppresses when the trail has one crumb or fewer, and renders a leading Home link plus the
/// chevron-separated crumbs, delegating every link's navigation + hover/focus prefetch to <c>PrefetchLink</c>.
/// This holder reproduces that exactly: it resolves <see cref="NavLabel"/> and <see cref="HomeLabel"/> once
/// through the <see cref="ILocalizer"/> facade (P1/S10) — honouring an explicit <c>homeAriaLabel</c> override
/// like the web prop — projects the input items into a <see cref="Trail"/> via
/// <see cref="BreadcrumbProjection"/> (exposing <see cref="IsVisible"/>, the web <c>items.length &gt; 1</c>
/// guard), and routes <see cref="NavigateHome"/> / <see cref="Navigate"/> / <see cref="PrefetchHome"/> /
/// <see cref="Prefetch"/> through the <see cref="IBreadcrumbNavigator"/> seam (P1/S8). Because the surface has
/// no data fetch there is no loading / error / stale / offline branch to model (the web source has none); the
/// states are the collapsed trail (≤1 crumb) and the populated trail, both driven by <see cref="Trail"/>. The
/// view performs no i18n, projection or routing of its own — it binds to this holder. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BreadcrumbsViewModel : INotifyPropertyChanged
{
    private readonly IBreadcrumbNavigator _navigator;
    private readonly BreadcrumbsDiagnostics _diagnostics;
    private BreadcrumbTrailView _trail;
    private bool _opened;

    /// <summary>Creates the holder over the i18n facade, the navigation seam and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the labels resolve through (web <c>useTranslation</c>).</param>
    /// <param name="navigator">The navigation seam crumb links route through; defaults to an inert no-op (web <c>PrefetchLink</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="homeHref">Destination of the leading Home link; defaults to <c>/</c> (web <c>homeHref</c>).</param>
    /// <param name="homeAriaLabel">Accessible name override for the Home link; defaults to the localized <c>Dashboard</c> (web <c>homeAriaLabel</c>).</param>
    public BreadcrumbsViewModel(
        ILocalizer localizer,
        IBreadcrumbNavigator? navigator = null,
        BreadcrumbsDiagnostics? diagnostics = null,
        string? homeHref = null,
        string? homeAriaLabel = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _navigator = navigator ?? NullBreadcrumbNavigator.Instance;
        _diagnostics = diagnostics ?? new BreadcrumbsDiagnostics();

        NavLabel = BreadcrumbsRegistration.ResolveNavLabel(localizer);
        HomeLabel = string.IsNullOrEmpty(homeAriaLabel)
            ? BreadcrumbsRegistration.ResolveHomeLabel(localizer)
            : homeAriaLabel;
        HomeHref = string.IsNullOrEmpty(homeHref) ? BreadcrumbsRegistration.DefaultHomeHref : homeHref;

        _trail = BreadcrumbProjection.Build(Array.Empty<BreadcrumbItem>());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized landmark name (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c>).</summary>
    public string NavLabel { get; }

    /// <summary>The Home link's accessible name — the override or the localized <c>Dashboard</c>.</summary>
    public string HomeLabel { get; }

    /// <summary>The Home link's destination route (web <c>homeHref</c>, default <c>/</c>).</summary>
    public string HomeHref { get; }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Breadcrumbs</c>).</summary>
    public static string Slug => BreadcrumbsRegistration.Slug;

    /// <summary>The current projected trail (the leading Home link is added by the view, not part of this).</summary>
    public BreadcrumbTrailView Trail
    {
        get => _trail;
        private set
        {
            _trail = value;
            Raise(nameof(Trail));
            Raise(nameof(IsVisible));
        }
    }

    /// <summary>True when the trail has more than one crumb and should render (web <c>items.length &gt; 1</c>).</summary>
    public bool IsVisible => _trail.Visible;

    /// <summary>
    /// Replace the trail from the supplied input items (web <c>items</c> prop change), re-projecting them and
    /// notifying the view to rebuild.
    /// </summary>
    /// <param name="items">The breadcrumb input items.</param>
    public void SetItems(IReadOnlyList<BreadcrumbItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        Trail = BreadcrumbProjection.Build(items);
    }

    /// <summary>Navigate to the Home destination (web Home <c>PrefetchLink</c> activation).</summary>
    public void NavigateHome()
    {
        _navigator.Navigate(HomeHref);
        _diagnostics.RecordNavigated();
    }

    /// <summary>Prefetch the Home destination (web Home <c>PrefetchLink</c> hover/focus prefetch).</summary>
    public void PrefetchHome()
    {
        _navigator.Prefetch(HomeHref);
        _diagnostics.RecordPrefetched();
    }

    /// <summary>
    /// Navigate to a crumb's destination (web crumb <c>PrefetchLink</c> activation). An empty href is a safe
    /// no-op (a non-link crumb is never wired to this).
    /// </summary>
    /// <param name="href">The crumb's destination route.</param>
    public void Navigate(string href)
    {
        if (string.IsNullOrEmpty(href))
        {
            return;
        }

        _navigator.Navigate(href);
        _diagnostics.RecordNavigated();
    }

    /// <summary>
    /// Prefetch a crumb's destination (web crumb <c>PrefetchLink</c> hover/focus prefetch). An empty href is a
    /// safe no-op.
    /// </summary>
    /// <param name="href">The crumb's destination route.</param>
    public void Prefetch(string href)
    {
        if (string.IsNullOrEmpty(href))
        {
            return;
        }

        _navigator.Prefetch(href);
        _diagnostics.RecordPrefetched();
    }

    /// <summary>
    /// Record the surface opening exactly once (web component mount), emitting the <c>view.opened</c>
    /// diagnostic. Idempotent — a second call is a no-op — so repeated <c>Loaded</c> events never double-count.
    /// </summary>
    public void MarkOpened()
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
