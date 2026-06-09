using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 ColorConverter surface — a parity port of
/// web/src/features/admin/components/devtools/tools/ColorConverter.tsx. It mirrors the web <c>ToolCard</c>
/// (a <see cref="TsGlassPanel"/> with a token-tinted header glyph, title and description) wrapping the tool's
/// body: a labelled hex field (the web <c>&lt;Input label={t('Hex Color')} /&gt;</c>, here a shared
/// <see cref="TsInput"/>) beside a live colour preview swatch (the web
/// <c>&lt;div style={{ backgroundColor: hex }} /&gt;</c>, here a <see cref="Border"/> tinted from the parsed
/// channels), above the result region. When the hex parses to a colour the region shows the three result
/// tiles — RGB, HSL and HEX — each a token-surfaced cell with a monospace value and a shared
/// <see cref="TsCopyButton"/> (the web <c>{parsed &amp;&amp; ...}</c> grid); when it does not, the region
/// shows a friendly <see cref="TsEmptyState"/> rather than collapsing to a blank box. All data and the
/// projection flow through the shared <see cref="ColorConverterViewModel"/>; the view never performs HTTP and
/// holds no business logic. Every string resolves through the i18n facade, the field and every copy button
/// carry a Narrator name, the swatch is named for the current colour, and each settled conversion is
/// announced through a polite live region. The surface adds no custom motion, so the reduced-motion setting
/// is honoured by construction.
/// </summary>
public sealed partial class ColorConverter : ContentControl, IDisposable
{
    private const double SmallBreakpoint = 640;     // web sm: -> 3-column result grid
    private const double SwatchSize = 40;           // web h-10 w-10
    private const double FieldWidth = 220;

    private readonly ColorConverterViewModel _viewModel;
    private readonly ColorConverterDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsInput _input = new();
    private readonly Border _swatch = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private int _columns = 1;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its localizer and optional PII-safe diagnostics collector.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public ColorConverter(ILocalizer localizer, ColorConverterDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ColorConverterDiagnostics();
        _viewModel = new ColorConverterViewModel(localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _input.TextChanged += OnInputTextChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>ColorConverter</c>).</summary>
    public static string Slug => ColorConverterRegistration.Slug;

    private void BuildChrome()
    {
        var panel = new TsGlassPanel();

        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;
        _root.Padding = new Thickness(20);

        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildInputRow());

        _resultHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _root.Children.Add(_resultHost);

        _announcer.FontSize = 11;
        _announcer.Foreground = DisplayTokens.TextMuted;
        _announcer.TextWrapping = TextWrapping.Wrap;
        _announcer.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_announcer);
        _root.Children.Add(_announcer);

        panel.Content = _root;
        Content = panel;
    }

    private StackPanel BuildHeader()
    {
        var iconHost = new Border
        {
            Width = SwatchSize,
            Height = SwatchSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var glyph = new FontIcon
        {
            Glyph = ColorConverterRegistration.Glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(ColorConverterRegistration.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        iconHost.Child = glyph;

        var titleText = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };
        var descriptionText = new TextBlock
        {
            Text = _viewModel.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(titleText);
        textColumn.Children.Add(descriptionText);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        header.Children.Add(iconHost);
        header.Children.Add(textColumn);
        return header;
    }

    private StackPanel BuildInputRow()
    {
        var label = new TextBlock
        {
            Text = _viewModel.HexLabel,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        _input.Hint = ColorConverterRegistration.DefaultHex;
        _input.Text = _viewModel.Hex;
        _input.Width = FieldWidth;
        AutomationProperties.SetName(_input, _viewModel.HexLabel);

        var inputColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
        inputColumn.Children.Add(label);
        inputColumn.Children.Add(_input);

        _swatch.Width = SwatchSize;
        _swatch.Height = SwatchSize;
        _swatch.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10);
        _swatch.BorderBrush = DisplayTokens.Border;
        _swatch.BorderThickness = new Thickness(1);
        _swatch.VerticalAlignment = VerticalAlignment.Bottom;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
        };
        row.Children.Add(inputColumn);
        row.Children.Add(_swatch);
        return row;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the hex field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _input.TextChanged -= OnInputTextChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
        GC.SuppressFinalize(this);
    }

    private void OnInputTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.Hex = _input.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int columns = ColumnsForWidth(e.NewSize.Width);
        if (columns != _columns)
        {
            _columns = columns;
            if (_viewModel.State == ColorConverterState.Ready)
            {
                ScheduleRender();
            }
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
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
        _swatch.Background = _viewModel.Swatch is { } rgb ? ColorToBrush(rgb) : DisplayTokens.Surface;
        AutomationProperties.SetName(_swatch, _viewModel.SwatchName);

        _resultHost.Child = _viewModel.State == ColorConverterState.Empty ? BuildEmpty() : BuildCells();

        UpdateAnnouncer();
    }

    private Grid BuildCells()
    {
        var cells = _viewModel.Cells;
        int columns = Math.Clamp(_columns, 1, 3);
        int count = cells.Count;
        int rows = (count + columns - 1) / columns;

        var grid = new Grid
        {
            ColumnSpacing = 8,
            RowSpacing = 8,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            var cell = BuildCell(cells[i]);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private Border BuildCell(ColorConverterCell cell)
    {
        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
        };
        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = 14,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.NoWrap,
            IsTextSelectionEnabled = true,
        };

        var copy = new TsCopyButton
        {
            Size = ControlSize.Small,
            ValueToCopy = cell.Value,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Text = _viewModel.CopyLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(copy, _viewModel.CopyName(cell));

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(label);
        column.Children.Add(value);
        column.Children.Add(copy);

        return new Border
        {
            Background = DisplayTokens.Brush("TsSurfaceOverlayBrush"),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Padding = new Thickness(12, 8, 12, 8),
            Child = column,
        };
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = ColorConverterRegistration.Glyph,
            Message = _viewModel.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        return empty;
    }

    private void UpdateAnnouncer()
    {
        // The empty surface is its own live region (TsEmptyState announces its message), so the polite
        // announcer carries only the settled conversion result.
        string? message = _viewModel.LastAnnouncement;
        if (_viewModel.State != ColorConverterState.Ready || string.IsNullOrEmpty(message))
        {
            _announcer.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _announcer.Text = message;
        _announcer.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_announcer, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_announcer);
        }
    }

    private static SolidColorBrush ColorToBrush(RgbColor rgb)
    {
        var color = Windows.UI.Color.FromArgb(
            255,
            (byte)Math.Clamp(rgb.R, 0, 255),
            (byte)Math.Clamp(rgb.G, 0, 255),
            (byte)Math.Clamp(rgb.B, 0, 255));
        return new SolidColorBrush(color);
    }

    private static int ColumnsForWidth(double width) => width >= SmallBreakpoint ? 3 : 1;
}
