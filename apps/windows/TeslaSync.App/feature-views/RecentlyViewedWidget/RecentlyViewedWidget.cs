using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Carries the route a <see cref="RecentlyViewedWidget"/> row asks the host to navigate to — the native
/// analogue of the web row's <c>&lt;Link to={entry.path}&gt;</c>
/// (web/src/features/dashboard/components/RecentlyViewedWidget.tsx). The dashboard host subscribes to
/// <see cref="RecentlyViewedWidget.NavigationRequested"/> and performs the navigation; the surface itself
/// stays a thin renderer.
/// </summary>
public sealed class RecentlyViewedNavigationEventArgs(string path) : EventArgs
{
    /// <summary>The route path to navigate to (web <c>entry.path</c>).</summary>
    public string Path { get; } = path;
}

/// <summary>
/// The native WinUI 3 Recently Viewed dashboard surface — a parity port of
/// web/src/features/dashboard/components/RecentlyViewedWidget.tsx. It reproduces the web's titled
/// <see cref="TsGlassPanel"/> (a Clock glyph + "Recently Viewed" heading) wrapping the top-N client-side
/// recent-page entries as a responsive grid of clickable rows: each row shows the kind icon, the page title
/// (truncated) and a compact relative-time label, and activating it raises
/// <see cref="NavigationRequested"/> with the entry's path (the web <c>&lt;Link&gt;</c>). When no pages have
/// been visited the body renders the web's deliberate non-actionable hint paragraph (not a CTA empty state)
/// so the panel is never a blank box. The surface updates live: a change to the bound
/// <see cref="IRecentlyViewedSource"/> re-projects through the shared <see cref="RecentlyViewedViewModel"/>
/// and re-renders. The view never reads the store directly. Every string resolves through the i18n facade,
/// the heading and every row carry a Narrator name, and the surface adds no custom motion (so reduced-motion
/// is honoured by construction).
/// </summary>
public sealed partial class RecentlyViewedWidget : ContentControl, IDisposable
{
    private const string AutomationIdRoot = "recently-viewed-widget";
    private const string AutomationIdEmpty = "recently-viewed-empty";

    private readonly RecentlyViewedViewModel _viewModel;
    private readonly RecentlyViewedDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new();
    private readonly Grid _root = new();
    private readonly TextBlock _titleText = new();
    private readonly ContentControl _bodyHost = new();

    private int _columns = 1;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its source, localizer, diagnostics, display cap and clock.</summary>
    public RecentlyViewedWidget(
        IRecentlyViewedSource source,
        ILocalizer localizer,
        RecentlyViewedDiagnostics? diagnostics = null,
        int limit = RecentlyViewedRegistration.DisplayLimit,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new RecentlyViewedDiagnostics();
        _viewModel = new RecentlyViewedViewModel(source, localizer, limit, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, AutomationIdRoot);

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>Raised when a row asks the host to navigate to its route (the web <c>&lt;Link&gt;</c> click).</summary>
    public event EventHandler<RecentlyViewedNavigationEventArgs>? NavigationRequested;

    /// <summary>
    /// Convenience factory wiring the process-wide <see cref="RecentlyViewedSource.Shared"/> store over the
    /// host's localizer — the surface the dashboard binds by default.
    /// </summary>
    public static RecentlyViewedWidget Create(
        ILocalizer localizer,
        RecentlyViewedDiagnostics? diagnostics = null,
        int limit = RecentlyViewedRegistration.DisplayLimit,
        Func<DateTimeOffset>? clock = null) =>
        new(RecentlyViewedSource.Shared, localizer, diagnostics, limit, clock);

    private void BuildChrome()
    {
        var clock = new FontIcon
        {
            Glyph = RecentlyViewedProjection.HeaderGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(clock, AccessibilityView.Raw);

        _titleText.Text = _viewModel.Title;
        _titleText.FontSize = 14;
        _titleText.FontWeight = FontWeights.SemiBold;
        _titleText.Foreground = DisplayTokens.TextPrimary;
        _titleText.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetHeadingLevel(_titleText, AutomationHeadingLevel.Level3);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(clock);
        header.Children.Add(_titleText);

        _bodyHost.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalContentAlignment = VerticalAlignment.Stretch;

        _root.Padding = new Thickness(16);
        _root.RowSpacing = 8;
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);

        _panel.Content = _root;
        Content = _panel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        // Refresh relative-time labels against the current clock now the surface is on screen.
        _viewModel.Refresh();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int columns = RecentlyViewedProjection.ColumnsForWidth(e.NewSize.Width);
        if (columns == _columns)
        {
            return;
        }

        _columns = columns;
        if (_viewModel.State == RecentlyViewedState.Ready)
        {
            ScheduleRender();
        }
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
        _viewModel.Dispose();
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
        AutomationProperties.SetName(this, _viewModel.Title);
        _bodyHost.Content = _viewModel.State == RecentlyViewedState.Ready
            ? BuildGrid(_viewModel.Display)
            : BuildEmpty();
    }

    private TextBlock BuildEmpty()
    {
        var hint = new TextBlock
        {
            Text = _viewModel.EmptyMessage,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 12, 0, 12),
        };
        AutomationProperties.SetAutomationId(hint, AutomationIdEmpty);
        AutomationProperties.SetName(hint, _viewModel.EmptyMessage);
        LiveRegion.Configure(hint);
        LiveRegion.Announce(hint);
        return hint;
    }

    private Grid BuildGrid(RecentlyViewedDisplay display)
    {
        int columns = Math.Max(1, _columns);
        int count = display.Rows.Count;
        int rows = (count + columns - 1) / columns;

        var grid = new Grid
        {
            ColumnSpacing = 8,
            RowSpacing = 4,
            HorizontalAlignment = HorizontalAlignment.Stretch,
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
            var row = BuildRow(display.Rows[i]);
            Grid.SetColumn(row, i % columns);
            Grid.SetRow(row, i / columns);
            grid.Children.Add(row);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private Button BuildRow(RecentlyViewedRow row)
    {
        var icon = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 13,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = row.Title,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var relative = new TextBlock
        {
            Text = row.RelativeText,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(relative, AccessibilityView.Raw);

        var content = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(title, 1);
        Grid.SetColumn(relative, 2);
        content.Children.Add(icon);
        content.Children.Add(title);
        content.Children.Add(relative);

        var button = new Button
        {
            Content = content,
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 6, 8, 6),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, row.AutomationName);
        AutomationProperties.SetAutomationId(button, $"recently-viewed-row-{row.Path}");

        string path = row.Path;
        button.Click += (_, _) => NavigationRequested?.Invoke(this, new RecentlyViewedNavigationEventArgs(path));
        return button;
    }
}
