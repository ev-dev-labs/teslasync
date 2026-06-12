using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetStatusGrid</c> widget primitive — a parity port of the web
/// <c>WidgetStatusGrid</c> (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx). It is a shared
/// building block that lays out a responsive grid of status chips, each a tinted rounded card with a leading
/// optional icon, a label, an optional value (hidden when compact) and a corner status dot whose colour
/// encodes ok / warning / error / inactive / unknown. It reproduces both web branches: the empty surface
/// (web L59-L61, mapped to <see cref="TsEmptyState"/>) and the populated grid (web L65-L101), and the
/// container-query column collapse (web L44-L50) by measuring its own width and asking
/// <see cref="WidgetStatusGridLayout"/> for the column count. All inputs flow through the shared
/// <see cref="WidgetStatusGridViewModel"/> (and the <see cref="IWidgetStatusGridSource"/> P1/S8 seam); the
/// view never performs HTTP and never re-derives — it renders the <see cref="WidgetStatusGridDisplay"/>
/// projection. Every chip carries a Narrator name (label, plus the value when shown), the status dot is marked
/// decorative, and the empty message resolves through the i18n facade.
/// </summary>
public sealed partial class WidgetStatusGrid : ContentControl, IDisposable
{
    private const double Gap = 8;
    private const double ChipCornerRadius = 8;
    private const double MinCellHeight = 44;
    private const double DotSize = 8;
    private const double DotInset = 8;
    private const double IconSize = 16;
    private const string LabelBrushKey = "TsColorTextSecondaryBrush";
    private const string ValueBrushKey = "TsColorTextPrimaryBrush";
    private const string IconBrushKey = "TsColorTextSecondaryBrush";

    private readonly WidgetStatusGridViewModel _viewModel;
    private readonly WidgetStatusGridDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly List<FrameworkElement> _cellBorders = [];
    private Grid? _grid;
    private int _arrangedColumns;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data seam, localizer and optional diagnostics collector.</summary>
    public WidgetStatusGrid(IWidgetStatusGridSource source, ILocalizer localizer, WidgetStatusGridDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new WidgetStatusGridDiagnostics();
        _viewModel = new WidgetStatusGridViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>WidgetStatusGrid</c>).</summary>
    public static string Slug => WidgetStatusGridRegistration.Slug;

    /// <summary>The view-model a host can observe for the current render state.</summary>
    public WidgetStatusGridViewModel ViewModel => _viewModel;

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WidgetStatusGridViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_viewModel.Display.IsPopulated)
        {
            ArrangeColumns(e.NewSize.Width);
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // A source change can arrive from a background callback; render on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        WidgetStatusGridDisplay display = _viewModel.Display;
        _grid = null;
        _cellBorders.Clear();
        _arrangedColumns = 0;

        if (display.State == WidgetStatusGridState.Empty)
        {
            AutomationProperties.SetName(this, display.EmptyMessage);
            Content = BuildEmpty(display);
            return;
        }

        // web L65-L101: a gap-2 grid of status chips; the column count collapses with the measured width.
        AutomationProperties.SetName(this, string.Empty);
        var grid = new Grid { ColumnSpacing = Gap, RowSpacing = Gap };
        foreach (WidgetStatusCellDisplay cell in display.Cells)
        {
            FrameworkElement chip = BuildCell(cell, display.Compact);
            _cellBorders.Add(chip);
            grid.Children.Add(chip);
        }

        _grid = grid;
        Content = grid;
        ArrangeColumns(ActualWidth);
    }

    private static TsEmptyState BuildEmpty(WidgetStatusGridDisplay display)
    {
        // web L59-L61: <EmptyState message={emptyMessage} icon={emptyIcon} />.
        var empty = new TsEmptyState { Message = display.EmptyMessage };
        if (display.HasEmptyIcon)
        {
            empty.IconGlyph = display.EmptyIconGlyph;
        }

        return empty;
    }

    private void ArrangeColumns(double width)
    {
        if (_grid is not { } grid)
        {
            return;
        }

        int count = _cellBorders.Count;
        if (count == 0)
        {
            return;
        }

        WidgetStatusGridDisplay display = _viewModel.Display;
        int columns = WidgetStatusGridLayout.ResolveColumns(display.RequestedColumns, display.Compact, width);
        if (columns == _arrangedColumns)
        {
            return;
        }

        _arrangedColumns = columns;
        int rows = (count + columns - 1) / columns;

        grid.ColumnDefinitions.Clear();
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        grid.RowDefinitions.Clear();
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            FrameworkElement chip = _cellBorders[i];
            Grid.SetColumn(chip, i % columns);
            Grid.SetRow(chip, i / columns);
        }
    }

    private static Border BuildCell(WidgetStatusCellDisplay cell, bool compact)
    {
        WidgetStatusPalette palette = cell.Palette;

        // web L72-L76: rounded-lg border chip; compact tightens the padding (px-2 py-1.5 vs px-3 py-2).
        var border = new Border
        {
            CornerRadius = new CornerRadius(ChipCornerRadius),
            BorderThickness = new Thickness(1),
            MinHeight = MinCellHeight,
            Padding = compact ? new Thickness(8, 6, 8, 6) : new Thickness(12, 8, 12, 8),
            Background = ResolveBackground(palette),
            BorderBrush = ResolveBorder(palette),
        };

        var root = new Grid();

        // web L78-L84: the corner status dot — decorative; the colour is the only status signal.
        var dot = new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = ResolveBrush(palette.DotBrushKey),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, DotInset, DotInset, 0),
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = Gap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (cell.HasIcon)
        {
            // web L86-L88: leading icon, shrink-0, text-secondary.
            var icon = new FontIcon
            {
                Glyph = cell.IconGlyph,
                FontSize = IconSize,
                Foreground = ResolveBrush(IconBrushKey),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
        }

        var textColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

        // web L91: truncated label, text-xs, text-secondary.
        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = ResolveBrush(LabelBrushKey),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        textColumn.Children.Add(label);

        if (cell.HasValue)
        {
            // web L92-L96: value, text-sm, font-medium, text-primary, truncated.
            var value = new TextBlock
            {
                Text = cell.Value,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                FontWeight = FontWeights.Medium,
                Foreground = ResolveBrush(ValueBrushKey),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
            textColumn.Children.Add(value);
        }

        row.Children.Add(textColumn);
        root.Children.Add(row);
        root.Children.Add(dot);
        border.Child = root;

        // The chip is a single Narrator stop carrying the visible text (label, plus value when shown).
        AutomationProperties.SetName(border, cell.AccessibleName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    private static Brush ResolveBackground(WidgetStatusPalette palette) =>
        palette.Tinted ? Tint(palette.BackgroundBrushKey, 0.10) : ResolveBrush(palette.BackgroundBrushKey);

    private static Brush ResolveBorder(WidgetStatusPalette palette) =>
        palette.Tinted ? Tint(palette.BorderBrushKey, 0.20) : ResolveBrush(palette.BorderBrushKey);

    private static Brush ResolveBrush(string key) =>
        TypographyTokens.Brush(key) ?? new SolidColorBrush(Microsoft.UI.Colors.Gray);

    private static SolidColorBrush Tint(string key, double alpha)
    {
        if (TypographyTokens.Brush(key) is SolidColorBrush brush)
        {
            Color color = brush.Color;
            return new SolidColorBrush(Color.FromArgb((byte)Math.Round(alpha * 255), color.R, color.G, color.B));
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }
}
