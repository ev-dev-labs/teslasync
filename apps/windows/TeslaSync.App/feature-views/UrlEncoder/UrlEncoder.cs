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
/// The native WinUI 3 URL-encoder developer tool — a parity port of
/// web/src/features/admin/components/devtools/tools/UrlEncoder.tsx. It reproduces the web <c>ToolCard</c>
/// chrome (cyan icon chip + title + description) wrapping the tool body: an Encode/Decode mode toggle, a
/// multi-line input field, and a conditional output panel with a copy affordance. The tool is a pure
/// client-side codec — all conversion flows through the shared <see cref="UrlEncoderViewModel"/> +
/// <see cref="UrlCodec"/>; the view performs no I/O. Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class UrlEncoder : ContentControl, IDisposable
{
    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly UrlEncoderViewModel _viewModel;
    private readonly UrlEncoderDiagnostics _diagnostics;

    private readonly TsButton _encodeButton = new();
    private readonly TsButton _decodeButton = new();
    private readonly TsTextarea _input = new();
    private readonly Border _outputPanel = new();
    private readonly TextBlock _outputText = new();
    private readonly TsCopyButton _copyButton = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its localizer and (optional) PII-safe diagnostics sink.</summary>
    public UrlEncoder(ILocalizer localizer, UrlEncoderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new UrlEncoderViewModel(localizer);
        _diagnostics = diagnostics ?? new UrlEncoderDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        SyncFromViewModel();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _encodeButton.Click += OnEncodeClick;
        _decodeButton.Click += OnDecodeClick;
        _input.TextChanged += OnInputChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface id this view registers under (<c>url</c>).</summary>
    public static string RegistryId => UrlEncoderRegistration.Id;

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
            Background = Translucent(UrlEncoderRegistration.AccentColorKey, 0.12),
            BorderBrush = Translucent(UrlEncoderRegistration.AccentColorKey, 0.25),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var icon = new FontIcon
        {
            Glyph = UrlEncoderRegistration.IconGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(UrlEncoderRegistration.AccentBrushKey),
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
        body.Children.Add(BuildModeToggle());
        body.Children.Add(BuildInputSection());
        body.Children.Add(BuildOutputPanel());
        return body;
    }

    private StackPanel BuildModeToggle()
    {
        _encodeButton.Text = _viewModel.EncodeLabel;
        _encodeButton.Size = ControlSize.Small;
        AutomationProperties.SetName(_encodeButton, _viewModel.EncodeAccessibleName);

        _decodeButton.Text = _viewModel.DecodeLabel;
        _decodeButton.Size = ControlSize.Small;
        AutomationProperties.SetName(_decodeButton, _viewModel.DecodeAccessibleName);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(_encodeButton);
        row.Children.Add(_decodeButton);
        return row;
    }

    private StackPanel BuildInputSection()
    {
        var label = new TextBlock
        {
            Text = _viewModel.InputLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        _input.MinHeight = 56; // web rows={2}
        _input.Hint = _viewModel.InputHint;
        AutomationProperties.SetName(_input, _viewModel.InputAccessibleName);

        var section = new StackPanel { Spacing = 4 };
        section.Children.Add(label);
        section.Children.Add(_input);
        return section;
    }

    private Border BuildOutputPanel()
    {
        var outputLabel = new TextBlock
        {
            Text = _viewModel.OutputLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        _copyButton.ValueToCopy = _viewModel.Output;
        _copyButton.CopyLabel = _viewModel.CopyLabel;
        _copyButton.CopiedLabel = _viewModel.CopiedLabel;
        _copyButton.Size = ControlSize.Small;
        AutomationProperties.SetName(_copyButton, _viewModel.CopyAccessibleName);

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(outputLabel, 0);
        Grid.SetColumn(_copyButton, 1);
        headerRow.Children.Add(outputLabel);
        headerRow.Children.Add(_copyButton);

        _outputText.FontFamily = MonoFont;
        _outputText.FontSize = 14;
        _outputText.Foreground = DisplayTokens.Accent; // web text-cyan-300
        _outputText.TextWrapping = TextWrapping.Wrap;
        _outputText.IsTextSelectionEnabled = true;

        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(headerRow);
        stack.Children.Add(_outputText);

        _outputPanel.CornerRadius = new CornerRadius(8);
        _outputPanel.Background = DisplayTokens.Surface;
        _outputPanel.BorderBrush = DisplayTokens.Border;
        _outputPanel.BorderThickness = new Thickness(1);
        _outputPanel.Padding = new Thickness(12);
        _outputPanel.Child = stack;
        AutomationProperties.SetName(_outputPanel, _viewModel.OutputLabel);
        return _outputPanel;
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

    private void OnEncodeClick(object sender, RoutedEventArgs e) => _viewModel.Mode = UrlEncoderMode.Encode;

    private void OnDecodeClick(object sender, RoutedEventArgs e) => _viewModel.Mode = UrlEncoderMode.Decode;

    private void OnInputChanged(object sender, TextChangedEventArgs e) => _viewModel.Input = _input.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        SyncFromViewModel();

    private void SyncFromViewModel()
    {
        _encodeButton.Variant = _viewModel.IsEncode ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _decodeButton.Variant = _viewModel.IsDecode ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _input.Hint = _viewModel.InputHint;

        _outputText.Text = _viewModel.Output;
        _copyButton.ValueToCopy = _viewModel.Output;
        _outputPanel.Visibility = _viewModel.HasOutput ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Detach from the view-model and input handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _encodeButton.Click -= OnEncodeClick;
        _decodeButton.Click -= OnDecodeClick;
        _input.TextChanged -= OnInputChanged;
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
