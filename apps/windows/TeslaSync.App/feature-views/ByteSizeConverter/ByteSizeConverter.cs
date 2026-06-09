using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 ByteSizeConverter surface — a parity port of
/// web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx. It mirrors the web
/// <c>ToolCard</c> (a <see cref="TsGlassPanel"/> with a token-tinted HardDrive header glyph, title and
/// description) wrapping the converter body: a two-up row of a <see cref="TsInput"/> value field
/// (example value "1024", web <c>Input</c>) and a <see cref="TsSelect"/> unit picker over B/KB/MB/GB/TB
/// (web <c>Select</c>), beneath which the five-unit conversion grid renders once the value parses (web
/// <c>{conversions &amp;&amp; &lt;grid/&gt;}</c>), the chosen unit's cell highlighted with the info accent
/// token (web <c>bg-neon-cyan/10 ring-neon-cyan/30</c>). Before a valid number is entered the same region
/// shows a friendly empty hint rather than a blank box. All state and the conversion math flow through the
/// shared <see cref="ByteSizeConverterViewModel"/> + the pure <see cref="ByteSizeProjection"/> adapter; the
/// view never computes inline. Every string resolves through the i18n facade, every interactive element
/// carries a Narrator name, and each settled conversion is announced through a polite live region. The
/// surface uses no animation, so the reduced-motion contract is satisfied by construction.
/// </summary>
public sealed partial class ByteSizeConverter : ContentControl, IDisposable
{
    private const string HardDriveGlyph = "\uEDA2";          // Segoe Fluent — MapDrive (hard drive), web Lucide HardDrive
    private const string AccentBrushKey = "TsColorInfoBrush"; // cyan/info accent (web ToolCard color="cyan"), semantic token
    private const string AccentColorKey = "TsColorInfoColor"; // the matching color token, tinted for the active cell fill
    private const byte ActiveFillAlpha = 30;                  // ~12% — the web bg-neon-cyan/10 active-cell wash

    private readonly ByteSizeConverterViewModel _viewModel;
    private readonly ByteSizeConverterDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsInput _valueInput = new();
    private readonly TsSelect _unitSelect = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its localizer and optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public ByteSizeConverter(ILocalizer localizer, ByteSizeConverterDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ByteSizeConverterDiagnostics();
        _viewModel = new ByteSizeConverterViewModel(localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>ByteSizeConverter</c>).</summary>
    public static string Slug => ByteSizeConverterRegistration.Slug;

    private void BuildChrome()
    {
        var panel = new TsGlassPanel();

        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;
        _root.Padding = new Thickness(20);

        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildInputs());

        _resultHost.MinHeight = 64;
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
            Width = 40,
            Height = 40,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var glyph = new FontIcon
        {
            Glyph = HardDriveGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(AccentBrushKey),
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

    private Grid BuildInputs()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        _valueInput.Header = _viewModel.ValueLabel;
        _valueInput.Hint = _viewModel.ValueHint;
        _valueInput.Text = _viewModel.Value;
        AutomationProperties.SetName(_valueInput, _viewModel.ValueLabel);
        _valueInput.TextChanged += OnValueChanged;
        Grid.SetColumn(_valueInput, 0);
        grid.Children.Add(_valueInput);

        _unitSelect.Header = _viewModel.UnitLabel;
        _unitSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _unitSelect.ItemsSource = _viewModel.UnitOptions;
        _unitSelect.SelectedItem = _viewModel.Unit;
        AutomationProperties.SetName(_unitSelect, _viewModel.UnitLabel);
        _unitSelect.SelectionChanged += OnUnitChanged;
        Grid.SetColumn(_unitSelect, 1);
        grid.Children.Add(_unitSelect);

        return grid;
    }

    private void OnValueChanged(object sender, TextChangedEventArgs e) => _viewModel.Value = _valueInput.Text;

    private void OnUnitChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_unitSelect.SelectedItem is string unit)
        {
            _viewModel.Unit = unit;
        }
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

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        SyncInputs();

        _resultHost.Child = _viewModel.HasConversions ? BuildGrid() : BuildEmpty();

        UpdateAnnouncer();
    }

    private void SyncInputs()
    {
        if (!string.Equals(_valueInput.Text, _viewModel.Value, StringComparison.Ordinal))
        {
            _valueInput.Text = _viewModel.Value;
        }

        _valueInput.HasError = _viewModel.IsInvalidInput;

        if (_unitSelect.SelectedItem as string != _viewModel.Unit)
        {
            _unitSelect.SelectedItem = _viewModel.Unit;
        }
    }

    private Grid BuildGrid()
    {
        var grid = new Grid { ColumnSpacing = 8 };
        var conversions = _viewModel.Conversions ?? [];
        for (int i = 0; i < conversions.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var cell = BuildCell(conversions[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        AutomationProperties.SetName(grid, _viewModel.ResultAnnouncement ?? _viewModel.Title);
        return grid;
    }

    private static Border BuildCell(ByteConversion conversion)
    {
        var unitText = new TextBlock
        {
            Text = conversion.Unit,
            FontSize = 12,
            Foreground = conversion.IsActive ? DisplayTokens.Brush(AccentBrushKey) : DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        var valueText = new TextBlock
        {
            Text = conversion.Value,
            FontSize = 13,
            FontFamily = TypographyMono(),
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(unitText);
        column.Children.Add(valueText);

        var cell = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Padding = new Thickness(8, 6, 8, 6),
            Background = conversion.IsActive ? ActiveCellFill() : DisplayTokens.Surface,
            BorderBrush = conversion.IsActive ? DisplayTokens.Brush(AccentBrushKey) : DisplayTokens.Border,
            BorderThickness = new Thickness(conversion.IsActive ? 1 : 0),
            Child = column,
        };
        AutomationProperties.SetName(cell, $"{conversion.Unit}: {conversion.Value}");
        return cell;
    }

    private Border BuildEmpty()
    {
        var title = new TextBlock
        {
            Text = _viewModel.EmptyTitle,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        var message = new TextBlock
        {
            Text = _viewModel.EmptyMessage,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(title);
        column.Children.Add(message);

        var host = new Border { Padding = new Thickness(12, 8, 12, 8), Child = column };
        AutomationProperties.SetName(host, $"{_viewModel.EmptyTitle}. {_viewModel.EmptyMessage}");
        return host;
    }

    private void UpdateAnnouncer()
    {
        string? message = _viewModel.ResultAnnouncement;
        if (string.IsNullOrEmpty(message))
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

    private static FontFamily? TypographyMono() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("TsTypeFontFamilyMono", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Consolas");

    private static Brush ActiveCellFill()
    {
        if (Application.Current?.Resources is { } res
            && res.TryGetValue(AccentColorKey, out object? value)
            && value is Color color)
        {
            color.A = ActiveFillAlpha;
            return new SolidColorBrush(color);
        }

        return DisplayTokens.Surface;
    }
}
