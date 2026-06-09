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
/// The native WinUI 3 UuidGenerator surface — a parity port of
/// web/src/features/admin/components/devtools/tools/UuidGenerator.tsx. It mirrors the web <c>ToolCard</c>
/// (a <see cref="TsGlassPanel"/> with a token-tinted purple <c>Fingerprint</c> glyph, title and description)
/// wrapping the tool's body: a primary "Generate" action with a refresh glyph (the web
/// <c>&lt;Button variant="primary" icon={&lt;RefreshCw /&gt;} /&gt;</c>) above the result region. When at
/// least one UUID has been generated the region shows the capped, newest-first list — each row a
/// token-surfaced cell with a monospace value and a shared <see cref="TsCopyButton"/> (the web
/// <c>{uuids.length &gt; 0 &amp;&amp; uuids.map(...)}</c> rows); before the first generate it shows a friendly
/// <see cref="TsEmptyState"/> rather than collapsing to a blank box. All data and the projection flow through
/// the shared <see cref="UuidGeneratorViewModel"/>; the view never performs I/O and holds no business logic.
/// Every string resolves through the i18n facade, the generate action and every copy button carry a Narrator
/// name, and each new value is announced through a polite live region. The surface adds no custom motion, so
/// the reduced-motion setting is honoured by construction.
/// </summary>
public sealed partial class UuidGenerator : ContentControl, IDisposable
{
    private const double ChipSize = 40;                 // web h-10 w-10 icon chip
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent "Refresh" — web Lucide RefreshCw

    private static readonly FontFamily MonoFont = new("Consolas");

    private readonly UuidGeneratorViewModel _viewModel;
    private readonly UuidGeneratorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsButton _generateButton = new();
    private readonly Border _resultsHost = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its localizer, optional diagnostics collector and generation seam.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="factory">Optional UUID generation seam; defaults to <see cref="GuidUuidFactory"/>.</param>
    public UuidGenerator(
        ILocalizer localizer,
        UuidGeneratorDiagnostics? diagnostics = null,
        IUuidFactory? factory = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new UuidGeneratorDiagnostics();
        _viewModel = new UuidGeneratorViewModel(localizer, factory);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _generateButton.Click += OnGenerateClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>UuidGenerator</c>).</summary>
    public static string Slug => UuidGeneratorRegistration.Slug;

    private void BuildChrome()
    {
        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;

        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildGenerateButton());

        _resultsHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _root.Children.Add(_resultsHost);

        _announcer.FontSize = 11;
        _announcer.Foreground = DisplayTokens.TextMuted;
        _announcer.TextWrapping = TextWrapping.Wrap;
        _announcer.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_announcer);
        _root.Children.Add(_announcer);

        Content = new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = _root,
        };
    }

    private StackPanel BuildHeader()
    {
        var chip = new Border
        {
            Width = ChipSize,
            Height = ChipSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            Background = Translucent(UuidGeneratorRegistration.AccentColorKey, 0.12),
            BorderBrush = Translucent(UuidGeneratorRegistration.AccentColorKey, 0.25),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var glyph = new FontIcon
        {
            Glyph = UuidGeneratorRegistration.Glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(UuidGeneratorRegistration.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        chip.Child = glyph;

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
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        header.Children.Add(chip);
        header.Children.Add(heading);
        return header;
    }

    private TsButton BuildGenerateButton()
    {
        _generateButton.Text = _viewModel.GenerateLabel;
        _generateButton.Variant = ButtonVariant.Primary;
        _generateButton.Size = ControlSize.Small;
        _generateButton.IconGlyph = RefreshGlyph;
        _generateButton.HorizontalAlignment = HorizontalAlignment.Left;
        AutomationProperties.SetName(_generateButton, _viewModel.GenerateAccessibleName);
        return _generateButton;
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

    /// <summary>Detach from the view-model and the generate action (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _generateButton.Click -= OnGenerateClick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnGenerateClick(object sender, RoutedEventArgs e) => _viewModel.Generate();

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
        _resultsHost.Child = _viewModel.State == UuidGeneratorState.Ready ? BuildList() : BuildEmpty();
        UpdateAnnouncer();
    }

    private StackPanel BuildList()
    {
        var list = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (string uuid in _viewModel.Uuids)
        {
            list.Children.Add(BuildRow(uuid));
        }

        return list;
    }

    private Border BuildRow(string uuid)
    {
        var code = new TextBlock
        {
            Text = uuid,
            FontFamily = MonoFont,
            FontSize = 13,
            Foreground = DisplayTokens.Accent,
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var copy = new TsCopyButton
        {
            Size = ControlSize.Small,
            ValueToCopy = uuid,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Text = _viewModel.CopyLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(copy, _viewModel.CopyName(uuid));

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(code, 0);
        Grid.SetColumn(copy, 1);
        grid.Children.Add(code);
        grid.Children.Add(copy);

        return new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Padding = new Thickness(12, 6, 8, 6),
            Child = grid,
        };
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = UuidGeneratorRegistration.Glyph,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private void UpdateAnnouncer()
    {
        string? message = _viewModel.LastAnnouncement;
        if (_viewModel.State != UuidGeneratorState.Ready || string.IsNullOrEmpty(message))
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
