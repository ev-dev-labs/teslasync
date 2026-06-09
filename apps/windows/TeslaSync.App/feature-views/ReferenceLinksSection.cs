using System.ComponentModel;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Reference Links surface — a parity port of
/// web/src/features/admin/components/devtools/ReferenceLinksSection.tsx. It reproduces the web component's
/// responsive card grid (one column, two at the small breakpoint, four at the large breakpoint) of Tesla Fleet
/// API reference links: each card is a glass panel wrapping a hyperlink that opens the destination in the
/// system browser, with a cyan accent icon tile, the localized title, and the verbatim URL beneath it. The web
/// component consumes no asynchronous data — only <c>useTranslation</c> over the static <c>REFERENCE_LINKS</c>
/// catalog — so the surface has just the two honest states the catalog can yield: the populated grid, or a
/// friendly empty surface when no links are available (never a blank box). The data is projected by the
/// UI-thread-free <see cref="ReferenceLinksViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade, every link carries a Narrator name, and the layout uses platform tokens (no ported
/// web styling). No custom animations are used, so the system "show animations" / reduced-motion preference is
/// honoured implicitly, and font sizes scale with the system text-scaling setting.
/// </summary>
public sealed partial class ReferenceLinksSection : ContentControl, IDisposable
{
    private const double SmallBreakpoint = 640;
    private const double LargeBreakpoint = 1024;
    private const double Gutter = 16;

    private readonly ReferenceLinksViewModel _viewModel;
    private readonly ReferenceLinksDiagnostics _diagnostics;
    private readonly Grid _host = new();
    private readonly List<FrameworkElement> _cards = new();

    private Grid? _cardsGrid;
    private int _currentColumns;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the localizer, an optional catalog and optional diagnostics.</summary>
    public ReferenceLinksSection(
        ILocalizer localizer,
        IReadOnlyList<ReferenceLink>? catalog = null,
        ReferenceLinksDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ReferenceLinksDiagnostics();
        _viewModel = new ReferenceLinksViewModel(localizer, catalog);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _host.SizeChanged += OnHostSizeChanged;
        AutomationProperties.SetName(_host, _viewModel.RegionName);
        AutomationProperties.SetLandmarkType(_host, AutomationLandmarkType.Custom);
        AutomationProperties.SetLocalizedLandmarkType(_host, _viewModel.RegionName);
        Content = _host;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface reports under (<c>ReferenceLinksSection</c>).</summary>
    public static string Slug => ReferenceLinksRegistration.Slug;

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// titles and accessibility copy update without reconstructing the surface (web react-i18next parity).
    /// </summary>
    public void Reload() => _viewModel.Reload();

    /// <summary>Detach from the view-model and layout events (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _host.SizeChanged -= OnHostSizeChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnHostSizeChanged(object sender, SizeChangedEventArgs e) => LayoutCards(e.NewSize.Width);

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (null or nameof(ReferenceLinksViewModel.Items)))
        {
            return;
        }

        AutomationProperties.SetName(_host, _viewModel.RegionName);
        AutomationProperties.SetLocalizedLandmarkType(_host, _viewModel.RegionName);
        Render();
    }

    private void Render()
    {
        _host.Children.Clear();

        if (_viewModel.State == ReferenceLinkState.Empty)
        {
            _cardsGrid = null;
            _cards.Clear();
            _host.Children.Add(BuildEmpty());
            return;
        }

        BuildCards();
        if (_cardsGrid is not null)
        {
            _host.Children.Add(_cardsGrid);
            LayoutCards(ActualWidth > 0 ? ActualWidth : _host.ActualWidth);
        }
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void BuildCards()
    {
        _cards.Clear();
        _cardsGrid = new Grid { ColumnSpacing = Gutter, RowSpacing = Gutter };
        foreach (var item in _viewModel.Items)
        {
            _cards.Add(BuildCard(item));
        }

        _currentColumns = 0;
    }

    private void LayoutCards(double width)
    {
        if (_cardsGrid is null || _cards.Count == 0)
        {
            return;
        }

        int columns = width >= LargeBreakpoint ? 4 : width >= SmallBreakpoint ? 2 : 1;
        columns = Math.Min(columns, _cards.Count);

        if (columns == _currentColumns && _cardsGrid.Children.Count == _cards.Count)
        {
            return;
        }

        _currentColumns = columns;
        _cardsGrid.Children.Clear();
        _cardsGrid.ColumnDefinitions.Clear();
        _cardsGrid.RowDefinitions.Clear();

        for (int c = 0; c < columns; c++)
        {
            _cardsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(_cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            _cardsGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _cards.Count; i++)
        {
            var card = _cards[i];
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            _cardsGrid.Children.Add(card);
        }
    }

    private static TsGlassPanel BuildCard(ReferenceLinkItem item)
    {
        var (background, ring, iconBrush) = AccentBrushes();

        var icon = new FontIcon
        {
            Glyph = item.Glyph,
            FontSize = 16,
            Foreground = iconBrush,
        };

        var iconTile = new Border
        {
            Width = 36,
            Height = 36,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = background,
            BorderBrush = ring,
            BorderThickness = new Thickness(1),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Child = icon,
        };
        AutomationProperties.SetAccessibilityView(iconTile, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = item.Title,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var url = new TextBlock
        {
            Text = item.Url,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            Margin = new Thickness(0, 2, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(url, AccessibilityView.Raw);

        var textColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(title);
        textColumn.Children.Add(url);

        var inner = new Grid { ColumnSpacing = 12 };
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(iconTile, 0);
        Grid.SetColumn(textColumn, 1);
        inner.Children.Add(iconTile);
        inner.Children.Add(textColumn);

        var link = new HyperlinkButton
        {
            Padding = new Thickness(16),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Top,
            Content = inner,
        };

        if (Uri.TryCreate(item.Url, UriKind.Absolute, out var uri))
        {
            link.NavigateUri = uri;
        }

        AutomationProperties.SetName(link, item.AutomationName);
        ToolTipService.SetToolTip(link, item.Url);

        return new TsGlassPanel
        {
            Padding = new Thickness(0),
            Content = link,
        };
    }

    private static (Brush Background, Brush Ring, Brush Icon) AccentBrushes()
    {
        // The cyan accent token (web ICON_COLOR_MAP.cyan): a ~11% fill, a ~25% ring, and the full-strength icon.
        Brush accent = DisplayTokens.Accent;
        if (accent is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return (
                new SolidColorBrush(Color.FromArgb(28, c.R, c.G, c.B)),
                new SolidColorBrush(Color.FromArgb(64, c.R, c.G, c.B)),
                new SolidColorBrush(c));
        }

        return (accent, accent, accent);
    }
}
