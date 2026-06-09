using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 timestamp developer tool — a parity port of
/// web/src/features/admin/components/devtools/tools/TimestampTool.tsx. It reproduces the web
/// <c>ToolCard</c> chrome (green clock chip + title + description) wrapping the tool body: a live row that
/// shows the current Unix seconds + ISO instant (refreshed every second by a <see cref="DispatcherTimer"/>,
/// the analogue of the web <c>setInterval</c>) with a "Now" button that fills both fields, and two
/// conversion fields — a Unix-timestamp field (Hash icon) and an ISO field (Clock icon) — each of which
/// reveals a derived ISO/Local/Relative (or Unix/Local/Relative) block when its input parses. Every
/// conversion flows through the pure <see cref="TimestampConverter"/> via the
/// <see cref="TimestampToolViewModel"/>; the view performs no I/O. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TimestampTool : ContentControl, IDisposable
{
    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly TimestampToolViewModel _viewModel;
    private readonly TimestampToolDiagnostics _diagnostics;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };

    private readonly Run _nowUnixRun = new();
    private readonly Run _nowIsoRun = new();
    private readonly TsButton _nowButton = new();

    private readonly TsInput _unixInput = new();
    private readonly StackPanel _unixBlock = new() { Spacing = 2 };
    private readonly Run _unixIsoValue = NewValueRun();
    private readonly Run _unixLocalValue = NewValueRun();
    private readonly Run _unixRelativeValue = NewValueRun();

    private readonly TsInput _isoInput = new();
    private readonly StackPanel _isoBlock = new() { Spacing = 2 };
    private readonly Run _isoUnixValue = NewValueRun();
    private readonly Run _isoLocalValue = NewValueRun();
    private readonly Run _isoRelativeValue = NewValueRun();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its localizer and (optional) PII-safe diagnostics sink.</summary>
    public TimestampTool(ILocalizer localizer, TimestampToolDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TimestampToolViewModel(localizer);
        _diagnostics = diagnostics ?? new TimestampToolDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        SyncFromViewModel();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _nowButton.Click += OnNowClick;
        _unixInput.TextChanged += OnUnixChanged;
        _isoInput.TextChanged += OnIsoChanged;
        _timer.Tick += OnTick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface id this view registers under (<c>timestamp</c>).</summary>
    public static string RegistryId => TimestampToolRegistration.Id;

    private TsGlassPanel BuildChrome()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildBody());

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    private StackPanel BuildHeader()
    {
        var iconChip = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = Translucent(TimestampToolRegistration.AccentColorKey, 0.12),
            BorderBrush = Translucent(TimestampToolRegistration.AccentColorKey, 0.25),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var icon = new FontIcon
        {
            Glyph = TimestampToolRegistration.IconGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(TimestampToolRegistration.AccentBrushKey),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        iconChip.Child = icon;

        var title = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };
        var description = new TextBlock
        {
            Text = _viewModel.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(title);
        heading.Children.Add(description);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
        };
        header.Children.Add(iconChip);
        header.Children.Add(heading);
        return header;
    }

    private StackPanel BuildBody()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(BuildNowRow());
        body.Children.Add(BuildInputsGrid());
        return body;
    }

    private Border BuildNowRow()
    {
        var clock = new FontIcon
        {
            Glyph = TimestampToolRegistration.IconGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(TimestampToolRegistration.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(clock, AccessibilityView.Raw);

        _nowUnixRun.Foreground = DisplayTokens.TextPrimary;
        _nowIsoRun.Foreground = DisplayTokens.TextSecondary;
        var nowText = new TextBlock
        {
            FontFamily = MonoFont,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        nowText.Inlines.Add(_nowUnixRun);
        nowText.Inlines.Add(new Run { Text = "  |  ", Foreground = DisplayTokens.TextMuted });
        nowText.Inlines.Add(_nowIsoRun);

        _nowButton.Text = _viewModel.NowLabel;
        _nowButton.Variant = ButtonVariant.Subtle;
        _nowButton.Size = ControlSize.Small;
        _nowButton.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_nowButton, _viewModel.NowAccessibleName);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(clock, 0);
        Grid.SetColumn(nowText, 1);
        Grid.SetColumn(_nowButton, 2);
        grid.Children.Add(clock);
        grid.Children.Add(nowText);
        grid.Children.Add(_nowButton);

        return new Border
        {
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 8, 12, 8),
            Child = grid,
        };
    }

    private Grid BuildInputsGrid()
    {
        var unixSection = BuildFieldSection(
            _viewModel.UnixInputLabel,
            TimestampToolRegistration.UnixIconGlyph,
            _unixInput,
            TimestampToolRegistration.UnixHint,
            _viewModel.UnixInputAccessibleName,
            BuildUnixConversionBlock());

        var isoSection = BuildFieldSection(
            _viewModel.IsoInputLabel,
            TimestampToolRegistration.IsoIconGlyph,
            _isoInput,
            TimestampToolRegistration.IsoHint,
            _viewModel.IsoInputAccessibleName,
            BuildIsoConversionBlock());

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(unixSection, 0);
        Grid.SetColumn(isoSection, 1);
        grid.Children.Add(unixSection);
        grid.Children.Add(isoSection);
        return grid;
    }

    private static StackPanel BuildFieldSection(
        string label,
        string glyph,
        TsInput input,
        string hint,
        string accessibleName,
        StackPanel conversionBlock)
    {
        var labelBlock = new TextBlock
        {
            Text = label,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        input.Hint = hint;
        input.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(input, accessibleName);

        var inputRow = new Grid { ColumnSpacing = 8 };
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(input, 1);
        inputRow.Children.Add(icon);
        inputRow.Children.Add(input);

        var section = new StackPanel { Spacing = 4 };
        section.Children.Add(labelBlock);
        section.Children.Add(inputRow);
        section.Children.Add(conversionBlock);
        return section;
    }

    private StackPanel BuildUnixConversionBlock()
    {
        _unixBlock.Children.Add(BuildConversionLine(_viewModel.IsoLabel, _unixIsoValue));
        _unixBlock.Children.Add(BuildConversionLine(_viewModel.LocalLabel, _unixLocalValue));
        _unixBlock.Children.Add(BuildConversionLine(_viewModel.RelativeLabel, _unixRelativeValue));
        AutomationProperties.SetName(_unixBlock, _viewModel.UnixInputLabel);
        return _unixBlock;
    }

    private StackPanel BuildIsoConversionBlock()
    {
        _isoBlock.Children.Add(BuildConversionLine(_viewModel.UnixLabel, _isoUnixValue));
        _isoBlock.Children.Add(BuildConversionLine(_viewModel.LocalLabel, _isoLocalValue));
        _isoBlock.Children.Add(BuildConversionLine(_viewModel.RelativeLabel, _isoRelativeValue));
        AutomationProperties.SetName(_isoBlock, _viewModel.IsoInputLabel);
        return _isoBlock;
    }

    private static TextBlock BuildConversionLine(string label, Run valueRun)
    {
        var line = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap };
        line.Inlines.Add(new Run
        {
            Text = label + ": ",
            Foreground = DisplayTokens.TextSecondary,
        });
        line.Inlines.Add(valueRun);
        return line;
    }

    private static Run NewValueRun() => new()
    {
        FontFamily = MonoFont,
        Foreground = DisplayTokens.Accent,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _timer.Start();

        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnTick(object? sender, object e) => _viewModel.Now = DateTimeOffset.UtcNow;

    private void OnNowClick(object sender, RoutedEventArgs e)
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        _unixInput.Text = TimestampConverter.ToUnixSeconds(now).ToString(CultureInfo.InvariantCulture);
        _isoInput.Text = TimestampConverter.ToIsoString(now);
    }

    private void OnUnixChanged(object sender, TextChangedEventArgs e) => _viewModel.Unix = _unixInput.Text;

    private void OnIsoChanged(object sender, TextChangedEventArgs e) => _viewModel.Iso = _isoInput.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        SyncFromViewModel();

    private void SyncFromViewModel()
    {
        _nowUnixRun.Text = _viewModel.NowUnixText;
        _nowIsoRun.Text = _viewModel.NowIsoText;

        _unixBlock.Visibility = _viewModel.HasUnixResult ? Visibility.Visible : Visibility.Collapsed;
        _unixIsoValue.Text = _viewModel.UnixIsoText;
        _unixLocalValue.Text = _viewModel.UnixLocalText;
        _unixRelativeValue.Text = _viewModel.UnixRelativeText;

        _isoBlock.Visibility = _viewModel.HasIsoResult ? Visibility.Visible : Visibility.Collapsed;
        _isoUnixValue.Text = _viewModel.IsoUnixText;
        _isoLocalValue.Text = _viewModel.IsoLocalText;
        _isoRelativeValue.Text = _viewModel.IsoRelativeText;
    }

    /// <summary>Stop the live timer and detach from the view-model and input handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _timer.Stop();
        _timer.Tick -= OnTick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _nowButton.Click -= OnNowClick;
        _unixInput.TextChanged -= OnUnixChanged;
        _isoInput.TextChanged -= OnIsoChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private static SolidColorBrush Translucent(string colorKey, double opacity)
    {
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue(colorKey, out object? value) &&
            value is Windows.UI.Color color)
        {
            return new SolidColorBrush(color) { Opacity = opacity };
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }
}
