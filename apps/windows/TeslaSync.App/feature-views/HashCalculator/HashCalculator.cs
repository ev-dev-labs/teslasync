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
/// The native WinUI 3 HashCalculator surface — a parity port of
/// web/src/features/admin/components/devtools/tools/HashCalculator.tsx. It mirrors the web <c>ToolCard</c>
/// (a <see cref="TsGlassPanel"/> with a token-tinted header glyph, title and description) wrapping the tool
/// body: a labelled multi-line <see cref="TsTextarea"/> for the text to hash, a primary <see cref="TsButton"/>
/// carrying the Segoe Fluent "Hash" glyph that computes the SHA-256 digest and spins while it is in flight
/// (web <c>loading={computing}</c>), and a result tray that mirrors the web result block — the lowercase
/// monospace hex digest with a copy affordance on success, the localized "Hash Error" message on a fault, and
/// a friendly idle line before the first run so the region is never a blank box. All data and the digest flow
/// through the shared <see cref="HashCalculatorViewModel"/>; the view never computes a digest itself. Every
/// string resolves through the i18n facade, every interactive element carries a Narrator name, and each
/// settled run is announced through a polite live region.
/// </summary>
public sealed partial class HashCalculator : ContentControl, IDisposable
{
    private const double IconChipSize = 40;
    private const double InputMinHeight = 56;

    private readonly HashCalculatorViewModel _viewModel;
    private readonly HashCalculatorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsTextarea _input = new();
    private readonly TsButton _computeButton = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _suppressInput;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its digest seam, localizer and diagnostics.</summary>
    /// <param name="computer">The SHA-256 digest port (web <c>crypto.subtle.digest</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public HashCalculator(
        IHashComputer computer,
        ILocalizer localizer,
        HashCalculatorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(computer);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new HashCalculatorDiagnostics();
        _viewModel = new HashCalculatorViewModel(computer, localizer);
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

    /// <summary>The diagnostics surface slug this view registers under (<c>HashCalculator</c>).</summary>
    public static string Slug => HashCalculatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public HashCalculatorViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the on-device <see cref="Sha256HashComputer"/> over the host's localizer
    /// (the dev-tools host's only dependency for this purely local tool).
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static HashCalculator Create(
        ILocalizer localizer,
        HashCalculatorDiagnostics? diagnostics = null) =>
        new(new Sha256HashComputer(), localizer, diagnostics);

    private void BuildChrome()
    {
        var panel = new TsGlassPanel();

        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;
        _root.Padding = new Thickness(20);

        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildInputSection());
        _root.Children.Add(BuildActions());

        BuildResultHost();
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
            Width = IconChipSize,
            Height = IconChipSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            Background = AccentChip(HashCalculatorRegistration.AccentBrushKey),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var glyph = new FontIcon
        {
            Glyph = HashCalculatorRegistration.Glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(HashCalculatorRegistration.AccentBrushKey),
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

    private StackPanel BuildInputSection()
    {
        var label = new TextBlock
        {
            Text = _viewModel.InputLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };

        _input.Hint = _viewModel.InputHint;
        _input.MinHeight = InputMinHeight;
        _input.TextWrapping = TextWrapping.Wrap;
        _input.HorizontalAlignment = HorizontalAlignment.Stretch;
        _input.TextChanged += OnInputTextChanged;
        AutomationProperties.SetName(_input, _viewModel.InputLabel);

        var section = new StackPanel { Spacing = 6 };
        section.Children.Add(label);
        section.Children.Add(_input);
        return section;
    }

    private StackPanel BuildActions()
    {
        _computeButton.Variant = ButtonVariant.Primary;
        _computeButton.Size = ControlSize.Small;
        _computeButton.IconGlyph = HashCalculatorRegistration.Glyph;
        _computeButton.Text = _viewModel.ComputeLabel;
        _computeButton.Click += OnComputeClick;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_computeButton);
        return row;
    }

    private void BuildResultHost()
    {
        _resultHost.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10);
        _resultHost.Background = DisplayTokens.Surface;
        _resultHost.BorderThickness = new Thickness(1);
        _resultHost.Padding = new Thickness(12);
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

    /// <summary>Detach from the view-model and the input field, and cancel any in-flight digest (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _input.TextChanged -= OnInputTextChanged;
        _computeButton.Click -= OnComputeClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnInputTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressInput)
        {
            return;
        }

        _viewModel.InputText = _input.Text;
    }

    private void OnComputeClick(object sender, RoutedEventArgs e) => _ = _viewModel.ComputeAsync();

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
        if (!string.Equals(_input.Text, _viewModel.InputText, StringComparison.Ordinal))
        {
            _suppressInput = true;
            _input.Text = _viewModel.InputText;
            _suppressInput = false;
        }

        _computeButton.Text = _viewModel.ComputeLabel;
        _computeButton.IsLoading = _viewModel.IsComputing;
        _computeButton.IsEnabled = _viewModel.CanCompute;
        AutomationProperties.SetName(
            _computeButton,
            _viewModel.IsComputing ? _viewModel.ComputingLabel : _viewModel.ComputeActionName);

        _resultHost.BorderBrush = ResultBorderBrush(_viewModel.ResultTrayStatus);
        _resultHost.Child = BuildResultBody();

        UpdateAnnouncer();
    }

    private StackPanel BuildResultBody()
    {
        var column = new StackPanel { Spacing = 6 };

        var title = new TextBlock
        {
            Text = _viewModel.ResultLabel,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        headerRow.Children.Add(title);

        if (_viewModel.HasHash && _viewModel.HashResult is { } hash)
        {
            var copy = new TsCopyButton
            {
                Size = ControlSize.Small,
                ValueToCopy = hash,
                CopyLabel = _viewModel.CopyLabel,
                CopiedLabel = _viewModel.CopiedLabel,
                Text = _viewModel.CopyLabel,
            };
            AutomationProperties.SetName(copy, _viewModel.CopyLabel);
            Grid.SetColumn(copy, 1);
            headerRow.Children.Add(copy);
        }

        column.Children.Add(headerRow);
        column.Children.Add(BuildResultDetail());

        AutomationProperties.SetName(column, _viewModel.ResultLabel);
        return column;
    }

    private TextBlock BuildResultDetail()
    {
        if (_viewModel.HasHash && _viewModel.HashResult is { } hash)
        {
            return new TextBlock
            {
                Text = hash,
                FontSize = 12,
                FontFamily = new FontFamily("Consolas"),
                Foreground = DisplayTokens.Brush(HashCalculatorRegistration.AccentBrushKey),
                TextWrapping = TextWrapping.Wrap,
                IsTextSelectionEnabled = true,
            };
        }

        if (_viewModel.ShowError)
        {
            return new TextBlock
            {
                Text = _viewModel.HashErrorLabel,
                FontSize = 13,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                TextWrapping = TextWrapping.Wrap,
            };
        }

        return new TextBlock
        {
            Text = _viewModel.NoResultLabel,
            FontSize = 13,
            FontStyle = Windows.UI.Text.FontStyle.Italic,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        };
    }

    private static Brush ResultBorderBrush(StatusKind status) =>
        status == StatusKind.Neutral
            ? DisplayTokens.Border
            : DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }

    private void UpdateAnnouncer()
    {
        string? message = _viewModel.LastAnnouncement;
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
}
