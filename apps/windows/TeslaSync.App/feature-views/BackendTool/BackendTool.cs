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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 BackendTool surface — a parity port of
/// web/src/features/admin/components/devtools/BackendTool.tsx. It mirrors the web <c>ToolCard</c>
/// (a <see cref="TsGlassPanel"/> with a token-tinted header glyph, title and description, plus any caller
/// content) wrapping a Run action: a primary <see cref="TsButton"/> carrying the Segoe Fluent "Play" glyph
/// that fires the descriptor's dev-tools run and spins while it is in flight (web <c>loading={isPending}</c>),
/// an outcome <see cref="TsBadge"/> that appears once a run settles (green "Success" / danger "Failed", web
/// <c>{mutation.data &amp;&amp; &lt;Badge/&gt;}</c>), and a result tray that mirrors the web <c>ResultPanel</c>
/// — the pretty-printed JSON payload with a copy affordance on success, the failure message on error, and a
/// friendly idle line ("No result yet") before the first run so the region is never a blank box. All data and
/// the run flow through the shared <see cref="BackendToolViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade, every interactive element carries a Narrator name, and each
/// settled run is announced through a polite live region.
/// </summary>
public sealed partial class BackendTool : ContentControl, IDisposable
{
    private const string PlayGlyph = "\uE768"; // Segoe Fluent — Play (web Lucide Play)

    private readonly BackendToolViewModel _viewModel;
    private readonly BackendToolDiagnostics _diagnostics;
    private readonly UIElement? _childContent;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsButton _runButton = new();
    private readonly TsBadge _badge = new();
    private readonly TextBlock _badgeText = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private string? _announced;

    /// <summary>Creates the surface over its mutation runner, localizer, descriptor, diagnostics and optional caller content.</summary>
    public BackendTool(
        IBackendToolRunner runner,
        ILocalizer localizer,
        BackendToolDescriptor descriptor,
        BackendToolDiagnostics? diagnostics = null,
        UIElement? childContent = null)
    {
        ArgumentNullException.ThrowIfNull(runner);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(descriptor);

        _diagnostics = diagnostics ?? new BackendToolDiagnostics();
        _childContent = childContent;
        _viewModel = new BackendToolViewModel(runner, localizer, descriptor);
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

    /// <summary>The diagnostics surface slug this view registers under (<c>BackendTool</c>).</summary>
    public static string Slug => BackendToolRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BackendToolRunner"/> over the shared
    /// contract client (the dev-tools host's P2-core dependency).
    /// </summary>
    public static BackendTool Create(
        IApiClient api,
        ILocalizer localizer,
        BackendToolDescriptor descriptor,
        BackendToolDiagnostics? diagnostics = null,
        UIElement? childContent = null) =>
        new(new BackendToolRunner(api), localizer, descriptor, diagnostics, childContent);

    private void BuildChrome()
    {
        var panel = new TsGlassPanel();

        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;
        _root.Padding = new Thickness(20);

        _root.Children.Add(BuildHeader());

        if (_childContent is not null)
        {
            _root.Children.Add(_childContent);
        }

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
            Glyph = _viewModel.Glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(_viewModel.AccentBrushKey),
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

    private StackPanel BuildActions()
    {
        _runButton.Variant = ButtonVariant.Primary;
        _runButton.Size = ControlSize.Small;
        _runButton.IconGlyph = PlayGlyph;
        _runButton.Text = _viewModel.RunLabel;
        _runButton.Click += OnRunClick;

        _badge.Status = StatusKind.Success;
        _badge.Dot = true;
        _badge.Content = _badgeText;
        _badge.Visibility = Visibility.Collapsed;

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

    /// <summary>Detach from the view-model and cancel any in-flight run (idempotent).</summary>
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
        _runButton.Text = _viewModel.RunLabel;
        _runButton.IsLoading = _viewModel.IsRunning;
        AutomationProperties.SetName(_runButton, _viewModel.IsRunning ? _viewModel.RunningLabel : _viewModel.RunActionName);

        _badge.Visibility = _viewModel.ShowBadge ? Visibility.Visible : Visibility.Collapsed;
        _badge.Status = _viewModel.BadgeStatus;
        _badgeText.Text = _viewModel.BadgeText;
        AutomationProperties.SetName(_badge, _viewModel.BadgeText);

        _resultHost.BorderBrush = ResultBorderBrush(_viewModel.ResultTrayStatus);
        _resultHost.Child = BuildResultBody();

        UpdateAnnouncer();
    }

    private StackPanel BuildResultBody()
    {
        var column = new StackPanel { Spacing = 6 };

        var title = new TextBlock
        {
            Text = _viewModel.ResultTitle,
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

        if (_viewModel.HasResultData && _viewModel.ResultJson is { } json)
        {
            var copy = new TsCopyButton
            {
                Size = ControlSize.Small,
                ValueToCopy = json,
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

        AutomationProperties.SetName(column, _viewModel.ResultTitle);
        return column;
    }

    private UIElement BuildResultDetail()
    {
        if (_viewModel.ResultError is { } error)
        {
            return new TextBlock
            {
                Text = error,
                FontSize = 13,
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                TextWrapping = TextWrapping.Wrap,
            };
        }

        if (_viewModel.HasResultData && _viewModel.ResultJson is { } json)
        {
            var body = new TextBlock
            {
                Text = json,
                FontSize = 12,
                FontFamily = new FontFamily("Consolas"),
                Foreground = DisplayTokens.TextPrimary,
                TextWrapping = TextWrapping.NoWrap,
                IsTextSelectionEnabled = true,
            };
            return new ScrollViewer
            {
                MaxHeight = 256,
                HorizontalScrollMode = ScrollMode.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = body,
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
