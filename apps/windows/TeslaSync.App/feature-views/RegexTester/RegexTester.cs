using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Regex Tester developer tool — a parity port of
/// web/src/features/admin/components/devtools/tools/RegexTester.tsx. It reproduces the web
/// <c>ToolCard</c> chrome (red icon chip + title + description) wrapping the tool body: a pattern field
/// and a flags drop-down on a responsive two-up row (the web <c>sm:grid-cols-2</c>), a multi-line test
/// string field, a match-count badge whose tone tracks whether anything matched, and — when there is at
/// least one match — a list of result rows, each carrying an ordinal chip, the matched text in red
/// monospace and an "At Index N" caption. The tool is a pure client-side evaluator: all matching flows
/// through the shared <see cref="RegexTesterViewModel"/> + <see cref="RegexEvaluator"/>; the view
/// performs no I/O. Every string resolves through the i18n facade, every interactive element carries a
/// Narrator name, and the badge announces match-count changes politely. The tool's only render states
/// are the two the web source has — empty (no matches, the list is hidden) and matched (the list is
/// shown); both are reproduced.
/// </summary>
public sealed partial class RegexTester : ContentControl, IDisposable
{
    private const double TwoColumnBreakpoint = 640; // web sm: -> grid-cols-2

    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly RegexTesterViewModel _viewModel;
    private readonly RegexTesterDiagnostics _diagnostics;

    private readonly TsInput _patternInput = new();
    private readonly TsSelect _flagsSelect = new();
    private readonly TsTextarea _testInput = new();
    private readonly TsBadge _badge = new();
    private readonly StackPanel _matchesHost = new() { Spacing = 4 };

    private readonly Grid _inputGrid = new() { ColumnSpacing = 12, RowSpacing = 12 };
    private StackPanel _patternSection = new();
    private StackPanel _flagsSection = new();

    private bool _twoColumn;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its localizer and (optional) PII-safe diagnostics sink.</summary>
    public RegexTester(ILocalizer localizer, RegexTesterDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RegexTesterViewModel(localizer);
        _diagnostics = diagnostics ?? new RegexTesterDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        LayoutInputs(0);
        SyncFromViewModel();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _patternInput.TextChanged += OnPatternChanged;
        _flagsSelect.SelectionChanged += OnFlagsChanged;
        _testInput.TextChanged += OnTestStringChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
    }

    /// <summary>The canonical surface id this view registers under (<c>regex</c>).</summary>
    public static string RegistryId => RegexTesterRegistration.Id;

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
            Background = Translucent(RegexTesterRegistration.AccentColorKey, 0.12),
            BorderBrush = Translucent(RegexTesterRegistration.AccentColorKey, 0.25),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var icon = new FontIcon
        {
            Glyph = RegexTesterRegistration.IconGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(RegexTesterRegistration.AccentBrushKey),
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

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        header.Children.Add(iconChip);
        header.Children.Add(heading);
        return header;
    }

    private StackPanel BuildBody()
    {
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(BuildInputGrid());
        body.Children.Add(BuildTestStringSection());
        body.Children.Add(BuildBadgeRow());
        body.Children.Add(_matchesHost);
        return body;
    }

    private Grid BuildInputGrid()
    {
        _patternInput.Hint = _viewModel.PatternHint;
        AutomationProperties.SetName(_patternInput, _viewModel.PatternAccessibleName);
        _patternSection = BuildFieldSection(_viewModel.PatternLabel, _patternInput);

        PopulateFlags();
        AutomationProperties.SetName(_flagsSelect, _viewModel.FlagsAccessibleName);
        _flagsSection = BuildFieldSection(_viewModel.FlagsLabel, _flagsSelect);

        _inputGrid.Children.Add(_patternSection);
        _inputGrid.Children.Add(_flagsSection);
        return _inputGrid;
    }

    private void PopulateFlags()
    {
        _flagsSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        foreach (RegexFlagChoice choice in _viewModel.FlagOptions)
        {
            var item = new ComboBoxItem { Content = choice.Label, Tag = choice.Value };
            AutomationProperties.SetName(item, choice.Label);
            _flagsSelect.Items.Add(item);

            if (string.Equals(choice.Value, _viewModel.Flags, StringComparison.Ordinal))
            {
                _flagsSelect.SelectedItem = item;
            }
        }
    }

    private StackPanel BuildTestStringSection()
    {
        _testInput.Hint = _viewModel.TestStringHint;
        _testInput.MinHeight = 84; // web rows={3}
        AutomationProperties.SetName(_testInput, _viewModel.TestStringAccessibleName);
        return BuildFieldSection(_viewModel.TestStringLabel, _testInput);
    }

    private StackPanel BuildBadgeRow()
    {
        _badge.HorizontalAlignment = HorizontalAlignment.Left;
        AutomationProperties.SetLiveSetting(_badge, AutomationLiveSetting.Polite);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_badge);
        return row;
    }

    private static StackPanel BuildFieldSection(string labelText, FrameworkElement field)
    {
        var label = new TextBlock
        {
            Text = labelText,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        var section = new StackPanel { Spacing = 4 };
        section.Children.Add(label);
        section.Children.Add(field);
        return section;
    }

    private void SyncFromViewModel()
    {
        _badge.Status = _viewModel.BadgeStatus;
        _badge.Content = _viewModel.BadgeText;
        AutomationProperties.SetName(_badge, _viewModel.MatchesAccessibleName);
        RebuildMatches();
    }

    private void RebuildMatches()
    {
        _matchesHost.Children.Clear();

        IReadOnlyList<RegexTesterMatch> matches = _viewModel.Matches;
        if (matches.Count == 0)
        {
            // Web parity: the result list renders only behind `{matches.length > 0 && (…)}`.
            _matchesHost.Visibility = Visibility.Collapsed;
            return;
        }

        _matchesHost.Visibility = Visibility.Visible;
        foreach (RegexTesterMatch match in matches)
        {
            _matchesHost.Children.Add(BuildMatchRow(match));
        }
    }

    private Border BuildMatchRow(RegexTesterMatch match)
    {
        RegexMatchDisplay display = _viewModel.DescribeMatch(match);

        var ordinal = new TsBadge
        {
            Status = StatusKind.Info,
            Content = display.Ordinal,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(ordinal, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = display.Value,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = DisplayTokens.Brush(RegexTesterRegistration.AccentBrushKey),
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var indexText = new TextBlock
        {
            Text = display.IndexCaption,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(indexText, AccessibilityView.Raw);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(ordinal);
        row.Children.Add(value);
        row.Children.Add(indexText);

        var border = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(12, 4, 12, 4), // web px-3 py-1
            Child = row,
        };
        AutomationProperties.SetName(border, display.AccessibleName);
        return border;
    }

    private void LayoutInputs(double width)
    {
        bool twoColumn = width >= TwoColumnBreakpoint;
        if (twoColumn == _twoColumn && _inputGrid.ColumnDefinitions.Count > 0)
        {
            return;
        }

        _twoColumn = twoColumn;
        _inputGrid.ColumnDefinitions.Clear();
        _inputGrid.RowDefinitions.Clear();

        if (twoColumn)
        {
            _inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _inputGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetColumn(_patternSection, 0);
            Grid.SetRow(_patternSection, 0);
            Grid.SetColumn(_flagsSection, 1);
            Grid.SetRow(_flagsSection, 0);
        }
        else
        {
            _inputGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _inputGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _inputGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetColumn(_patternSection, 0);
            Grid.SetRow(_patternSection, 0);
            Grid.SetColumn(_flagsSection, 0);
            Grid.SetRow(_flagsSection, 1);
        }
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e) => LayoutInputs(e.NewSize.Width);

    private void OnPatternChanged(object sender, TextChangedEventArgs e) => _viewModel.Pattern = _patternInput.Text;

    private void OnTestStringChanged(object sender, TextChangedEventArgs e) => _viewModel.TestString = _testInput.Text;

    private void OnFlagsChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_flagsSelect.SelectedItem is ComboBoxItem { Tag: string value })
        {
            _viewModel.Flags = value;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        SyncFromViewModel();

    /// <summary>Detach from the view-model and input handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _patternInput.TextChanged -= OnPatternChanged;
        _flagsSelect.SelectionChanged -= OnFlagsChanged;
        _testInput.TextChanged -= OnTestStringChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
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
