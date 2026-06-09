using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Infrastructure;

/// <summary>
/// The native WinUI 3 Infrastructure feature view — a parity port of
/// web/src/features/admin/components/devtools/InfrastructureSection.tsx. It lays the five backend tool cards
/// (Db Stats / Migrations / MQTT publish / Env Check / Runtime) out in the web's responsive
/// <c>grid gap-4 lg:grid-cols-2</c> (two columns when wide, one when narrow), each card an on-demand runner
/// that mirrors the web <c>BackendTool</c>/<c>MqttTestTool</c>: an accent header, an optional topic/message
/// input pair, a Run/Send button, a Success/Failed badge and a ResultPanel that shows the pretty-printed
/// JSON (with a copy affordance), the server error, or the idle "No result yet". Every string resolves
/// through the i18n facade, every readout carries a Narrator name, and no HTTP touches the view — all data
/// flows through the shared <see cref="InfrastructureSectionViewModel"/>.
/// </summary>
public sealed partial class InfrastructureSection : ContentControl, IDisposable
{
    private const double WideColumnThreshold = 680; // ~ web lg breakpoint within a panel
    private const double CardGap = 16;              // web gap-4 (1rem)

    private readonly InfrastructureSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly InfrastructureSectionDiagnostics _diagnostics;

    private readonly Grid _grid = new() { ColumnSpacing = CardGap, RowSpacing = CardGap };
    private readonly List<InfrastructureToolCard> _cards = new();

    private int _columns;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the section over its view-model, localizer and diagnostics.</summary>
    public InfrastructureSection(
        InfrastructureSectionViewModel viewModel,
        ILocalizer localizer,
        InfrastructureSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = viewModel;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new InfrastructureSectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
    }

    /// <summary>The canonical surface id this view registers under (<c>infrastructure-section</c>).</summary>
    public static string RegistryId => InfrastructureSectionRegistration.Id;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="InfrastructureToolRunner"/> from the
    /// shared data layer (the dev-tools host's P2-core dependencies). None of the tools are vehicle-scoped.
    /// </summary>
    public static InfrastructureSection Create(
        IApiClient api,
        ILocalizer localizer,
        InfrastructureSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(localizer);
        var runner = new InfrastructureToolRunner(api);
        var viewModel = new InfrastructureSectionViewModel(runner, localizer);
        return new InfrastructureSection(viewModel, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(new SectionTitle { Value = _viewModel.Title });
        header.Children.Add(new Caption
        {
            Value = _localizer.GetString(
                "featureView.infrastructure.subtitle",
                "Run backend diagnostics and maintenance tools."),
        });

        foreach (var tool in _viewModel.Tools)
        {
            var card = new InfrastructureToolCard(tool, _localizer)
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Top,
            };
            _cards.Add(card);
        }

        var root = new StackPanel { Spacing = CardGap };
        root.Children.Add(header);
        root.Children.Add(_grid);
        Content = root;

        Reflow(force: true);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e) => Reflow(force: false);

    private void Reflow(bool force)
    {
        int columns = ActualWidth >= WideColumnThreshold ? 2 : 1;
        if (ActualWidth <= 0)
        {
            columns = 2; // initial layout before measure — match the web wide default
        }

        if (!force && columns == _columns && _grid.Children.Count == _cards.Count)
        {
            return;
        }

        _columns = columns;
        _grid.Children.Clear();
        _grid.ColumnDefinitions.Clear();
        _grid.RowDefinitions.Clear();

        for (int c = 0; c < columns; c++)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (_cards.Count + columns - 1) / columns;
        for (int r = 0; r < rows; r++)
        {
            _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _cards.Count; i++)
        {
            var card = _cards[i];
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            _grid.Children.Add(card);
        }
    }

    /// <summary>Detach every card from its view-model and dispose the holders (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (var card in _cards)
        {
            card.Dispose();
        }

        _viewModel.Dispose();
    }
}

/// <summary>
/// One tool card — the native composition of the web <c>ToolCard</c> + <c>BackendTool</c>/<c>MqttTestTool</c>
/// body. It renders the accent header, the optional MQTT topic/message inputs, the Run/Send button with its
/// Success/Failed badge, and the ResultPanel, and re-renders the dynamic regions (button busy state, badge,
/// result body) from its <see cref="InfrastructureToolViewModel"/>'s change notifications — coalesced onto
/// the UI thread. The view never performs HTTP.
/// </summary>
internal sealed partial class InfrastructureToolCard : ContentControl, IDisposable
{
    private const string PlayGlyph = "\uE768";  // Segoe Fluent — Play
    private const double ResultMaxHeight = 256; // web max-h-64

    private readonly InfrastructureToolViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _runButton = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        IconGlyph = PlayGlyph,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private readonly TsBadge _badge = new() { Dot = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _badgeText = new();

    private readonly Border _resultBorder = new()
    {
        CornerRadius = new CornerRadius(8),
        Padding = new Thickness(12),
    };

    private readonly Caption _resultTitle = new();
    private readonly TsCopyButton _copyButton = new() { Size = ControlSize.Small };
    private readonly ContentControl _resultBody = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private TsInput? _topicInput;
    private TsTextarea? _messageInput;

    private bool _renderQueued;
    private bool _syncingInputs;
    private bool _disposed;

    public InfrastructureToolCard(InfrastructureToolViewModel viewModel, ILocalizer localizer)
    {
        _viewModel = viewModel;
        _localizer = localizer;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        Content = BuildCard();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    private TsGlassPanel BuildCard()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildHeader());

        if (_viewModel is MqttTestToolViewModel mqtt)
        {
            column.Children.Add(BuildMqttInputs(mqtt));
        }

        column.Children.Add(BuildActionRow());
        column.Children.Add(BuildResultPanel());

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    private StackPanel BuildHeader()
    {
        var accent = AccentBrush(_viewModel.AccentBrushKey);

        var tile = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = Tint(accent, 0.14),
            Child = new FontIcon
            {
                Glyph = _viewModel.Glyph,
                FontSize = 20,
                Foreground = accent,
            },
        };
        AutomationProperties.SetAccessibilityView(tile, AccessibilityView.Raw);

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(new PanelTitle { Value = _viewModel.Title });
        titleStack.Children.Add(new Caption { Value = _viewModel.Description });

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(tile);
        row.Children.Add(titleStack);
        return row;
    }

    private StackPanel BuildMqttInputs(MqttTestToolViewModel mqtt)
    {
        _topicInput = new TsInput { Hint = mqtt.TopicHint, Text = mqtt.Topic };
        AutomationProperties.SetName(_topicInput, mqtt.TopicLabel);
        _topicInput.TextChanged += (_, _) =>
        {
            if (!_syncingInputs)
            {
                mqtt.Topic = _topicInput!.Text;
            }
        };

        _messageInput = new TsTextarea { Hint = mqtt.MessageHint, Text = mqtt.Message, MinHeight = 72 };
        AutomationProperties.SetName(_messageInput, mqtt.MessageLabel);
        _messageInput.TextChanged += (_, _) =>
        {
            if (!_syncingInputs)
            {
                mqtt.Message = _messageInput!.Text;
            }
        };

        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(LabeledField(mqtt.TopicLabel, _topicInput));
        stack.Children.Add(LabeledField(mqtt.MessageLabel, _messageInput));
        return stack;
    }

    private static StackPanel LabeledField(string label, FrameworkElement field)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = label });
        stack.Children.Add(field);
        return stack;
    }

    private StackPanel BuildActionRow()
    {
        _runButton.Text = _viewModel.RunButtonText;
        _runButton.Click += OnRunClick;

        _badge.Content = _badgeText;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_runButton);
        row.Children.Add(_badge);
        return row;
    }

    private Border BuildResultPanel()
    {
        _copyButton.CopyLabel = _viewModel.CopyLabel;
        _copyButton.CopiedLabel = _viewModel.CopiedLabel;
        _copyButton.Text = _viewModel.CopyLabel;

        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _resultTitle.Value = _viewModel.Title;
        _resultTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_resultTitle, 0);
        Grid.SetColumn(_copyButton, 1);
        headerGrid.Children.Add(_resultTitle);
        headerGrid.Children.Add(_copyButton);

        var stack = new StackPanel { Spacing = 6 };
        stack.Children.Add(headerGrid);
        stack.Children.Add(_resultBody);
        _resultBorder.Child = stack;

        LiveRegion.Configure(_resultBorder);
        return _resultBorder;
    }

    private void OnRunClick(object sender, RoutedEventArgs e) => _ = _viewModel.RunAsync();

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

        _runButton.Text = _viewModel.RunButtonText;
        _runButton.IsLoading = _viewModel.IsRunning;

        _badge.Visibility = _viewModel.ShowBadge ? Visibility.Visible : Visibility.Collapsed;
        if (_viewModel.ShowBadge)
        {
            _badge.Status = _viewModel.BadgeStatus;
            _badgeText.Text = _viewModel.BadgeText;
        }

        _resultBorder.Background = ToneBrush(_viewModel.ResultTone);
        _copyButton.Visibility = _viewModel.HasResult ? Visibility.Visible : Visibility.Collapsed;
        _copyButton.ValueToCopy = _viewModel.ResultJson ?? string.Empty;
        _resultBody.Content = BuildResultBody();

        AutomationProperties.SetName(_resultBorder, _viewModel.AutomationName);
        LiveRegion.Announce(_resultBorder);
    }

    private void SyncInputs()
    {
        if (_viewModel is not MqttTestToolViewModel mqtt)
        {
            return;
        }

        _syncingInputs = true;
        if (_topicInput is { } topic && topic.Text != mqtt.Topic)
        {
            topic.Text = mqtt.Topic;
        }

        if (_messageInput is { } message && message.Text != mqtt.Message)
        {
            message.Text = mqtt.Message;
        }

        _syncingInputs = false;
    }

    private UIElement BuildResultBody()
    {
        if (_viewModel.HasError)
        {
            return new TextBlock
            {
                Text = _viewModel.ErrorMessage ?? string.Empty,
                TextWrapping = TextWrapping.Wrap,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            };
        }

        if (_viewModel.HasResult)
        {
            return new ScrollViewer
            {
                HorizontalScrollMode = ScrollMode.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollMode = ScrollMode.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                MaxHeight = ResultMaxHeight,
                Content = new TextBlock
                {
                    Text = _viewModel.ResultJson ?? string.Empty,
                    FontFamily = new FontFamily("Cascadia Mono, Consolas, Courier New, monospace"),
                    FontSize = 12,
                    IsTextSelectionEnabled = true,
                    TextWrapping = TextWrapping.NoWrap,
                    Foreground = DisplayTokens.TextPrimary,
                },
            };
        }

        return new TextBlock
        {
            Text = _viewModel.IdleMessage,
            FontStyle = Windows.UI.Text.FontStyle.Italic,
            Foreground = DisplayTokens.TextMuted,
        };
    }

    private static Brush AccentBrush(string key) => DisplayTokens.Brush(key);

    private static SolidColorBrush Tint(Brush source, double opacity) =>
        source is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = opacity }
            : new SolidColorBrush(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush ToneBrush(InfrastructureResultTone tone)
    {
        var key = tone switch
        {
            InfrastructureResultTone.Success => "TsColorSuccessBrush",
            InfrastructureResultTone.Error => "TsColorDangerBrush",
            _ => "TsColorSurfaceBrush",
        };

        double opacity = tone == InfrastructureResultTone.Idle ? 0.5 : 0.08;
        return Tint(DisplayTokens.Brush(key), opacity);
    }

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
    }
}
