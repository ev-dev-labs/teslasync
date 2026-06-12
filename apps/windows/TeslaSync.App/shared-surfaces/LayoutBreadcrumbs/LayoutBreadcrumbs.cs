using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>LayoutBreadcrumbs</c> shared surface — a parity port of
/// <c>web/src/components/layout/LayoutBreadcrumbs.tsx</c> and the <c>Breadcrumbs</c> renderer it composes
/// (<c>web/src/components/layout/Breadcrumbs.tsx</c>). It is the single canonical breadcrumb row mounted in the
/// global shell chrome: a horizontal, horizontally-scrollable trail of a leading Home icon link, then a
/// chevron-separated chain of ancestor links ending in the non-interactive current-page label. All trail derivation,
/// override merging, label resolution and the one-or-zero-item suppression live in the UI-thread-free
/// <see cref="LayoutBreadcrumbsViewModel"/>; this view owns only the WinUI wiring — it builds the row from native
/// Fluent primitives (a <see cref="ScrollViewer"/> over a horizontal <see cref="StackPanel"/> of
/// <see cref="HyperlinkButton"/> links, <see cref="FontIcon"/> chevrons and <see cref="TextBlock"/> labels), tints
/// them with the W1 text tokens, exposes the navigation landmark and per-link accessible names, collapses the middle
/// crumbs to an ellipsis on a narrow row (the web <c>hidden sm:inline</c> / <c>sm:hidden</c> responsive pair), routes
/// activation through the holder, and re-renders when the holder's trail changes. The reveal carries no animation, so
/// it is reduce-motion-safe by construction, and the labels honour the system font scale through the Fluent text
/// primitives. There is no loading / error / stale / offline chrome because the web source has no data fetch; the
/// states are the suppressed empty slot (a top-level page) and the rendered trail, both driven by the holder. The
/// surface emits the <c>view.opened</c> diagnostic once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class LayoutBreadcrumbs : ContentControl, IDisposable
{
    private const double HomeIconSize = 14.0;
    private const double SeparatorIconSize = 12.0;
    private const double LabelFontSize = 14.0;
    private const double RowSpacing = 4.0;

    private readonly LayoutBreadcrumbsViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _row;
    private readonly List<CollapsibleCrumb> _middles = [];
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds an inert
    /// matched-route context, an empty override source, a passthrough localizer and an inert navigator, so the surface
    /// renders its suppressed (empty-slot) state. Supply the seams via the other constructor to drive the trail from
    /// the shell.
    /// </summary>
    public LayoutBreadcrumbs()
        : this(new LayoutBreadcrumbsViewModel(
            EmptyBreadcrumbRouteContext.Instance,
            new StaticBreadcrumbOverrideSource(),
            PassthroughLocalizer.Instance))
    {
    }

    /// <summary>Creates the surface over the matched-route + override + navigation seams and the i18n facade (production).</summary>
    /// <param name="route">The matched-route seam (web <c>useLocation</c> + <c>useParams</c> + match).</param>
    /// <param name="overrides">The per-page override seam (web <c>useBreadcrumbOverrides</c>).</param>
    /// <param name="localizer">The i18n facade labels resolve through (web <c>useTranslation</c>).</param>
    /// <param name="navigator">The navigation seam crumb / Home activations route through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public LayoutBreadcrumbs(
        IBreadcrumbRouteContext route,
        IBreadcrumbOverrideSource overrides,
        ILocalizer localizer,
        ILayoutBreadcrumbNavigator? navigator = null,
        LayoutBreadcrumbsDiagnostics? diagnostics = null)
        : this(new LayoutBreadcrumbsViewModel(route, overrides, localizer, navigator, routeMeta: null, diagnostics))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (hosting / tests). The view owns the holder's lifetime.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public LayoutBreadcrumbs(LayoutBreadcrumbsViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        _row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        Content = new ScrollViewer
        {
            Content = _row,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollMode = ScrollMode.Disabled,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The breadcrumb row is a navigation landmark named for assistive technology (web `<nav aria-label=…>`).
        AutomationProperties.SetName(this, _viewModel.NavLabel);
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Navigation);
        AutomationProperties.SetLocalizedLandmarkType(this, _viewModel.NavLabel);
        AutomationProperties.SetAutomationId(this, LayoutBreadcrumbsRegistration.NavAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        ActualThemeChanged += OnActualThemeChanged;

        Rebuild();
    }

    /// <summary>The canonical surface slug (<c>LayoutBreadcrumbs</c>).</summary>
    public static string Slug => LayoutBreadcrumbsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public LayoutBreadcrumbsViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
        ActualThemeChanged -= OnActualThemeChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.MarkOpened();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e) => ApplyCompactState();

    private void OnActualThemeChanged(FrameworkElement sender, object args) => Marshal(Rebuild);

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(LayoutBreadcrumbsViewModel.Items))
        {
            Marshal(Rebuild);
        }
    }

    private void Rebuild()
    {
        if (_disposed)
        {
            return;
        }

        _row.Children.Clear();
        _middles.Clear();

        IReadOnlyList<LayoutBreadcrumbItem> items = _viewModel.Items;
        if (items.Count <= 1)
        {
            // Suppressed: a top-level page renders an empty slot (web `return null`).
            return;
        }

        _row.Children.Add(BuildHomeLink());

        for (int i = 0; i < items.Count; i++)
        {
            LayoutBreadcrumbItem item = items[i];
            bool isLast = i == items.Count - 1;
            bool isMiddle = i > 0 && !isLast;

            _row.Children.Add(BuildSeparator());

            FrameworkElement crumb = item.IsCurrent || !item.IsLink
                ? BuildCurrentLabel(item, isCurrent: isLast)
                : BuildCrumbLink(item);
            _row.Children.Add(crumb);

            if (isMiddle)
            {
                FrameworkElement indicator = BuildCollapseIndicator();
                _row.Children.Add(indicator);
                _middles.Add(new CollapsibleCrumb(crumb, indicator));
            }
        }

        ApplyCompactState();
    }

    private HyperlinkButton BuildHomeLink()
    {
        var icon = new FontIcon { Glyph = LayoutBreadcrumbsViewModel.HomeGlyph, FontSize = HomeIconSize };
        ApplyForeground(icon, "TsColorTextMutedBrush");

        var link = new HyperlinkButton
        {
            Content = icon,
            Padding = new Thickness(2, 0, 2, 0),
            MinWidth = 0,
            MinHeight = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyForeground(link, "TsColorTextMutedBrush");

        AutomationProperties.SetName(link, _viewModel.HomeLabel);
        AutomationProperties.SetAutomationId(link, LayoutBreadcrumbsRegistration.HomeAutomationId);
        link.Click += OnHomeClick;
        return link;
    }

    private static FontIcon BuildSeparator()
    {
        var separator = new FontIcon
        {
            Glyph = LayoutBreadcrumbsViewModel.SeparatorGlyph,
            FontSize = SeparatorIconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyForeground(separator, "TsColorTextMutedBrush");
        // Decorative — Narrator reads the crumb labels, not the separators (web aria-hidden chevrons).
        AutomationProperties.SetAccessibilityView(separator, AccessibilityView.Raw);
        return separator;
    }

    private HyperlinkButton BuildCrumbLink(LayoutBreadcrumbItem item)
    {
        var text = new TextBlock
        {
            Text = item.Label,
            FontSize = LabelFontSize,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = LayoutBreadcrumbsViewModel.MaxLabelWidth,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var link = new HyperlinkButton
        {
            Content = text,
            Padding = new Thickness(2, 0, 2, 0),
            MinWidth = 0,
            MinHeight = 0,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ApplyForeground(link, "TsColorTextMutedBrush");

        AutomationProperties.SetName(link, item.Label);
        link.Click += (_, _) => _viewModel.Activate(item);
        return link;
    }

    private static TextBlock BuildCurrentLabel(LayoutBreadcrumbItem item, bool isCurrent)
    {
        var text = new TextBlock
        {
            Text = item.Label,
            FontSize = LabelFontSize,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxWidth = LayoutBreadcrumbsViewModel.MaxLabelWidth,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The current crumb is emphasised (web `text-secondary font-medium`); other plain crumbs stay muted.
        if (isCurrent)
        {
            text.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
            ApplyForeground(text, "TsColorTextSecondaryBrush");
        }
        else
        {
            ApplyForeground(text, "TsColorTextMutedBrush");
        }

        return text;
    }

    private static TextBlock BuildCollapseIndicator()
    {
        var indicator = new TextBlock
        {
            Text = LayoutBreadcrumbsViewModel.CollapseIndicator,
            FontSize = LabelFontSize,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        ApplyForeground(indicator, "TsColorTextMutedBrush");
        // Decorative collapse affordance (web `aria-hidden` ellipsis).
        AutomationProperties.SetAccessibilityView(indicator, AccessibilityView.Raw);
        return indicator;
    }

    private void OnHomeClick(object sender, RoutedEventArgs e) => _viewModel.NavigateHome();

    private void ApplyCompactState()
    {
        if (_middles.Count == 0)
        {
            return;
        }

        // Below the sm breakpoint the middle crumbs collapse to the ellipsis (web hidden sm:inline / sm:hidden).
        bool compact = ActualWidth >= 1 && ActualWidth < LayoutBreadcrumbsViewModel.CompactThreshold;
        foreach (CollapsibleCrumb middle in _middles)
        {
            middle.Label.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
            middle.Indicator.Visibility = compact ? Visibility.Visible : Visibility.Collapsed;
        }
    }

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

    private static void ApplyForeground(TextBlock element, string brushKey)
    {
        if (TryGetBrush(brushKey, out Brush brush))
        {
            element.Foreground = brush;
        }
    }

    private static void ApplyForeground(IconElement element, string brushKey)
    {
        if (TryGetBrush(brushKey, out Brush brush))
        {
            element.Foreground = brush;
        }
    }

    private static void ApplyForeground(Control element, string brushKey)
    {
        if (TryGetBrush(brushKey, out Brush brush))
        {
            element.Foreground = brush;
        }
    }

    private static bool TryGetBrush(string key, out Brush brush)
    {
        if (Application.Current.Resources.TryGetValue(key, out object? value) && value is Brush resolved)
        {
            brush = resolved;
            return true;
        }

        brush = null!;
        return false;
    }

    /// <summary>A middle crumb and the ellipsis that replaces it when the row is too narrow to show every label.</summary>
    private readonly record struct CollapsibleCrumb(FrameworkElement Label, FrameworkElement Indicator);
}
