using System.Collections.Generic;
using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Windows.UI.Text;

namespace TeslaSync.App.SharedSurfaces.BreadcrumbsSurface;

/// <summary>
/// The native WinUI 3 <c>Breadcrumbs</c> shared surface — a parity port of
/// web/src/components/layout/Breadcrumbs.tsx. It is the layout-chrome breadcrumb trail: a navigation landmark
/// (the web <c>&lt;nav aria-label="Breadcrumb"&gt;</c>) hosting a leading Home icon link followed by
/// chevron-separated crumbs, where the trailing crumb is the non-interactive current page (secondary colour,
/// medium weight), any earlier crumb with an href is a muted link, and a first crumb without an href is muted
/// text. The trail is horizontally scrollable with no scrollbar (web <c>overflow-x-auto scrollbar-none</c>),
/// each label truncates at 200px (web <c>truncate max-w-[200px]</c>), and on a narrow viewport the middle
/// crumbs collapse and a per-crumb <c>…</c> indicator is shown instead (web <c>hidden sm:inline</c> /
/// <c>sm:hidden</c>). It binds the <see cref="BreadcrumbsViewModel"/> — which resolves the two a11y labels over
/// the <see cref="ILocalizer"/> facade, projects the input items, and routes navigation + prefetch through the
/// <see cref="IBreadcrumbNavigator"/> seam — and this view owns only the WinUI wiring: it lays out the row,
/// reacts to <see cref="FrameworkElement.SizeChanged"/> for the responsive collapse, and rebuilds when the
/// trail changes. Because the web source has no data fetch there is no loading / empty / error / stale /
/// offline chrome; the surface's states are the collapsed trail (≤1 crumb, where the web returns <c>null</c>
/// and this surface hides itself) and the populated trail with its per-crumb link / current / middle branches.
/// The Home link carries the localized accessible name, the landmark is named and typed
/// <see cref="AutomationLandmarkType.Navigation"/>, the <c>…</c> indicators are hidden from the accessibility
/// tree (web <c>aria-hidden</c>), and the surface emits the <c>view.opened</c> diagnostic once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Breadcrumbs : ContentControl, IDisposable
{
    private const double LinkMinHeight = 0.0;

    private readonly BreadcrumbsViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = BreadcrumbsRegistration.RowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ScrollViewer _scroller;
    private readonly List<FrameworkElement> _middleElements = new();
    private readonly List<FrameworkElement> _collapsedIndicators = new();
    private bool _narrow;
    private bool _disposed;

    /// <summary>Creates the surface with no composition root (the designer / parameterless host entry point).</summary>
    public Breadcrumbs()
        : this(new BreadcrumbsViewModel(PassthroughLocalizer.Instance))
    {
    }

    /// <summary>Creates the surface over the i18n facade and a navigation seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the labels resolve through (web <c>useTranslation</c>).</param>
    /// <param name="navigator">The navigation seam crumb links route through (web <c>PrefetchLink</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="homeHref">Destination of the leading Home link; defaults to <c>/</c> (web <c>homeHref</c>).</param>
    /// <param name="homeAriaLabel">Accessible name override for the Home link (web <c>homeAriaLabel</c>).</param>
    public Breadcrumbs(
        ILocalizer localizer,
        IBreadcrumbNavigator navigator,
        BreadcrumbsDiagnostics? diagnostics = null,
        string? homeHref = null,
        string? homeAriaLabel = null)
        : this(new BreadcrumbsViewModel(localizer, navigator, diagnostics, homeHref, homeAriaLabel))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public Breadcrumbs(BreadcrumbsViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _scroller = new ScrollViewer
        {
            HorizontalScrollMode = ScrollMode.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = _row,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _scroller;

        // The web <nav aria-label="Breadcrumb">: a named navigation landmark.
        AutomationProperties.SetName(this, _viewModel.NavLabel);
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Navigation);
        AutomationProperties.SetLocalizedLandmarkType(this, _viewModel.NavLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        SizeChanged += OnSizeChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Rebuild();
    }

    /// <summary>The canonical surface slug (<c>Breadcrumbs</c>).</summary>
    public static string Slug => BreadcrumbsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public BreadcrumbsViewModel ViewModel => _viewModel;

    /// <summary>Replace the trail's input items (web <c>items</c> prop change).</summary>
    /// <param name="items">The breadcrumb input items.</param>
    public void SetItems(IReadOnlyList<BreadcrumbItem> items) => _viewModel.SetItems(items);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.MarkOpened();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(BreadcrumbsViewModel.Trail) ||
            e.PropertyName == nameof(BreadcrumbsViewModel.IsVisible))
        {
            Marshal(Rebuild);
        }
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        bool narrow = BreadcrumbResponsive.IsNarrow(e.NewSize.Width, BreadcrumbsRegistration.CollapseWidthThreshold);
        if (narrow == _narrow)
        {
            return;
        }

        _narrow = narrow;
        ApplyResponsive();
    }

    private void Rebuild()
    {
        _row.Children.Clear();
        _middleElements.Clear();
        _collapsedIndicators.Clear();

        BreadcrumbTrailView trail = _viewModel.Trail;

        // web: `if (items.length <= 1) return null` — top-level pages render an empty slot.
        if (!trail.Visible)
        {
            Visibility = Visibility.Collapsed;
            return;
        }

        Visibility = Visibility.Visible;
        _row.Children.Add(BuildHomeLink());

        foreach (BreadcrumbCrumb crumb in trail.Crumbs)
        {
            _row.Children.Add(BuildSeparator());

            FrameworkElement element = crumb.IsLink ? BuildLink(crumb) : BuildText(crumb);
            if (crumb.IsMiddle)
            {
                _middleElements.Add(element);
            }

            _row.Children.Add(element);

            if (crumb.IsMiddle)
            {
                FrameworkElement indicator = BuildCollapsedIndicator();
                _collapsedIndicators.Add(indicator);
                _row.Children.Add(indicator);
            }
        }

        _narrow = BreadcrumbResponsive.IsNarrow(ActualWidth, BreadcrumbsRegistration.CollapseWidthThreshold);
        ApplyResponsive();
    }

    private void ApplyResponsive()
    {
        Visibility middleVisibility = _narrow ? Visibility.Collapsed : Visibility.Visible;
        Visibility indicatorVisibility = _narrow ? Visibility.Visible : Visibility.Collapsed;

        foreach (FrameworkElement element in _middleElements)
        {
            element.Visibility = middleVisibility;
        }

        foreach (FrameworkElement indicator in _collapsedIndicators)
        {
            indicator.Visibility = indicatorVisibility;
        }
    }

    private HyperlinkButton BuildHomeLink()
    {
        var icon = new FontIcon
        {
            Glyph = BreadcrumbsRegistration.HomeGlyph,
            FontSize = BreadcrumbsRegistration.HomeIconSize,
            Foreground = DisplayTokens.TextMuted,
        };

        var link = NewLinkButton();
        link.Content = icon;
        AutomationProperties.SetName(link, _viewModel.HomeLabel);
        link.Click += (_, _) => _viewModel.NavigateHome();
        link.PointerEntered += (_, _) => _viewModel.PrefetchHome();
        link.GotFocus += (_, _) => _viewModel.PrefetchHome();
        return link;
    }

    private static FontIcon BuildSeparator() => new()
    {
        Glyph = BreadcrumbsRegistration.SeparatorGlyph,
        FontSize = BreadcrumbsRegistration.SeparatorIconSize,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private HyperlinkButton BuildLink(BreadcrumbCrumb crumb)
    {
        TextBlock label = NewLabelBlock(crumb.Label);
        label.Foreground = DisplayTokens.TextMuted;

        var link = NewLinkButton();
        link.Content = label;
        AutomationProperties.SetName(link, crumb.Label);

        string href = crumb.Href ?? string.Empty;
        link.Click += (_, _) => _viewModel.Navigate(href);
        link.PointerEntered += (_, _) => _viewModel.Prefetch(href);
        link.GotFocus += (_, _) => _viewModel.Prefetch(href);
        return link;
    }

    private static TextBlock BuildText(BreadcrumbCrumb crumb)
    {
        TextBlock block = NewLabelBlock(crumb.Label);
        if (crumb.IsLast)
        {
            // web: current page — secondary colour, font-medium.
            block.Foreground = DisplayTokens.TextSecondary;
            block.FontWeight = new FontWeight { Weight = BreadcrumbsRegistration.CurrentLabelWeight };
        }
        else
        {
            block.Foreground = DisplayTokens.TextMuted;
        }

        return block;
    }

    private static TextBlock BuildCollapsedIndicator()
    {
        var block = new TextBlock
        {
            Text = BreadcrumbsRegistration.CollapsedIndicator,
            FontSize = BreadcrumbsRegistration.LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web: aria-hidden="true" — the indicator is decorative, hidden from assistive technology.
        AutomationProperties.SetAccessibilityView(block, AccessibilityView.Raw);
        return block;
    }

    private static TextBlock NewLabelBlock(string text) => new()
    {
        Text = text,
        FontSize = BreadcrumbsRegistration.LabelFontSize,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        MaxWidth = BreadcrumbsRegistration.MaxLabelWidth,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static HyperlinkButton NewLinkButton() => new()
    {
        Padding = new Thickness(2, 0, 2, 0),
        MinWidth = 0,
        MinHeight = LinkMinHeight,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}
