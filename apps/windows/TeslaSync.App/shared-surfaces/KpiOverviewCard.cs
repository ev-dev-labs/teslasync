using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.SharedSurfaces.KpiOverviewCardSurface;

/// <summary>
/// The native WinUI 3 <c>KpiOverviewCard</c> shared surface — a parity port of
/// web/src/components/data-display/KpiOverviewCard.tsx (which embeds
/// web/src/components/data-display/ComparisonHeader.tsx) in its cross-feature role as the consistent overview
/// section card every overview surface (Drives, Charging, Trips, …) is framed in. It composes the web
/// <c>GlassPanel</c> from the shared <see cref="TsGlassPanel"/> and lays out, top to bottom: the comparison
/// header (a <see cref="PanelTitle"/> heading + a muted <see cref="Caption"/> period strip on the left, and an
/// optional headline-delta + actions accessory on the right), a responsive KPI grid that reflows 2 / 3 / 6
/// columns across the web breakpoints (or a friendly <see cref="TsEmptyState"/> when there are no tiles so the
/// grid is never a blank box), an optional muted secondary stats line, and an optional footer slot. The card is
/// purely presentational: the page computes the values and supplies the visual slots, exactly like the web
/// component, and contains no fetch lifecycle (no loading / error / stale / offline chrome — the web source has
/// none, mirroring the other presentational shared surfaces such as <c>Delta</c> and <c>VisuallyHidden</c>).
/// Both web components are anonymous (zero <c>t()</c> calls); every visible string is supplied already-localized
/// through the slots, so the surface resolves no i18n keys of its own. All presentational state flows through
/// the shared <see cref="KpiOverviewCardViewModel"/> and its <see cref="IKpiOverviewCardSource"/> P1/S8 seam;
/// the view never performs HTTP and never recomputes — it renders the <see cref="KpiOverviewCardDisplay"/>
/// projection. The card carries no animation (so the reduced-motion contract is satisfied by construction), its
/// text uses the tokenized typography roles (so system font scaling and the high-contrast dictionary keep
/// working), the title is exposed as a level-3 heading and the card region carries a Narrator name, and the
/// surface emits the <c>view.opened</c> diagnostic exactly once when it is shown.
/// </summary>
public sealed partial class KpiOverviewCard : ContentControl, IDisposable
{
    private const double PanelPadding = 20;
    private const double SectionSpacing = 16;
    private const double GridGutter = 16;
    private const double AccessorySpacing = 12;
    private const double HeaderTextSpacing = 2;

    private readonly IKpiOverviewCardSource _source;
    private readonly KpiOverviewCardViewModel _viewModel;
    private readonly KpiOverviewCardSource? _mutableSource;
    private readonly KpiOverviewCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _column = new() { Spacing = SectionSpacing };
    private readonly Grid _header = new();
    private readonly StackPanel _headerText = new() { Spacing = HeaderTextSpacing, VerticalAlignment = VerticalAlignment.Top };
    private readonly PanelTitle _title = new();
    private readonly Caption _period = new();
    private readonly StackPanel _accessory = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = AccessorySpacing,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ContentPresenter _headlineDeltaHost = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentPresenter _actionsHost = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Grid _gridHost = new();
    private readonly Grid _kpiGrid = new() { ColumnSpacing = GridGutter, RowSpacing = GridGutter };
    private readonly TsEmptyState _emptyState = new() { Visibility = Visibility.Collapsed };
    private readonly ContentPresenter _secondaryHost = new() { Visibility = Visibility.Collapsed };
    private readonly ContentPresenter _footerHost = new() { Visibility = Visibility.Collapsed };

    private IReadOnlyList<UIElement> _kpis = Array.Empty<UIElement>();
    private UIElement? _headlineDelta;
    private UIElement? _actions;
    private object? _secondary;
    private UIElement? _footer;
    private string? _emptyStateMessage;
    private int _laidOutColumns;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over a fresh in-memory source (the common host path).</summary>
    public KpiOverviewCard()
        : this(new KpiOverviewCardSource(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over an explicit input seam and an optional PII-safe diagnostics collector.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public KpiOverviewCard(IKpiOverviewCardSource source, KpiOverviewCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);

        _source = source;
        _viewModel = new KpiOverviewCardViewModel(source);
        _mutableSource = source as KpiOverviewCardSource;
        _diagnostics = diagnostics ?? new KpiOverviewCardDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildLayout();
        Content = new TsGlassPanel { Content = _column, Padding = new Thickness(PanelPadding) };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _kpiGrid.SizeChanged += OnKpiGridSizeChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>KpiOverviewCard</c>).</summary>
    public static string Slug => KpiOverviewCardRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public KpiOverviewCardViewModel ViewModel => _viewModel;

    /// <summary>
    /// The KPI tiles laid out in the responsive grid (web <c>kpis</c>). Setting the list repopulates the grid,
    /// updates the tile count on the bound source (so the empty state resolves) and re-renders.
    /// </summary>
    public IReadOnlyList<UIElement>? Kpis
    {
        get => _kpis;
        set
        {
            _kpis = value ?? Array.Empty<UIElement>();
            _mutableSource?.SetKpiCount(_kpis.Count);
            PopulateKpis();
            ScheduleRender();
        }
    }

    /// <summary>The optional headline delta shown on the right of the header (web <c>header.delta</c>).</summary>
    public UIElement? HeadlineDelta
    {
        get => _headlineDelta;
        set
        {
            _headlineDelta = value;
            _mutableSource?.SetHasHeadlineDelta(value is not null);
            ScheduleRender();
        }
    }

    /// <summary>The optional right-aligned header actions (web <c>header.actions</c>).</summary>
    public UIElement? Actions
    {
        get => _actions;
        set
        {
            _actions = value;
            _mutableSource?.SetHasActions(value is not null);
            ScheduleRender();
        }
    }

    /// <summary>
    /// The optional muted secondary stats line (web <c>secondary</c>). A string is rendered as a muted
    /// <see cref="Caption"/> (the web muted-text treatment); a <see cref="UIElement"/> is hosted as supplied so
    /// callers can mix icons and spans freely.
    /// </summary>
    public object? Secondary
    {
        get => _secondary;
        set
        {
            _secondary = value;
            _mutableSource?.SetHasSecondary(HasContent(value));
            ScheduleRender();
        }
    }

    /// <summary>The optional footer slot, typically an actionable callout (web <c>footer</c>).</summary>
    public UIElement? Footer
    {
        get => _footer;
        set
        {
            _footer = value;
            _mutableSource?.SetHasFooter(value is not null);
            ScheduleRender();
        }
    }

    /// <summary>
    /// The localized message shown in the empty state when there are no KPI tiles. Supplied already-localized by
    /// the host; when empty the empty state shows its neutral icon alone, never English boilerplate.
    /// </summary>
    public string? EmptyStateMessage
    {
        get => _emptyStateMessage;
        set
        {
            _emptyStateMessage = value;
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
        _kpiGrid.SizeChanged -= OnKpiGridSizeChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static bool HasContent(object? content) =>
        content is string text ? !string.IsNullOrEmpty(text) : content is not null;

    private void BuildLayout()
    {
        AutomationProperties.SetHeadingLevel(_title, AutomationHeadingLevel.Level3);

        _headerText.Children.Add(_title);
        _headerText.Children.Add(_period);

        _accessory.Children.Add(_headlineDeltaHost);
        _accessory.Children.Add(_actionsHost);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_headerText, 0);
        Grid.SetColumn(_accessory, 1);
        _header.Children.Add(_headerText);
        _header.Children.Add(_accessory);

        _kpiGrid.HorizontalAlignment = HorizontalAlignment.Stretch;
        _gridHost.Children.Add(_kpiGrid);
        _gridHost.Children.Add(_emptyState);

        _column.Children.Add(_header);
        _column.Children.Add(_gridHost);
        _column.Children.Add(_secondaryHost);
        _column.Children.Add(_footerHost);
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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(KpiOverviewCardViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void OnKpiGridSizeChanged(object sender, SizeChangedEventArgs e) => LayoutKpiGrid();

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
        {
            return;
        }

        _renderQueued = true;

        // A source change can be raised from a background settings/state callback; render on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        var display = _viewModel.Display;

        AutomationProperties.SetName(this, display.AccessibleName);
        ApplyAutomationId();

        _title.Value = display.Title;
        _title.Visibility = string.IsNullOrEmpty(display.Title) ? Visibility.Collapsed : Visibility.Visible;

        _period.Value = display.PeriodText;
        _period.Visibility = string.IsNullOrEmpty(display.PeriodText) ? Visibility.Collapsed : Visibility.Visible;

        _headlineDeltaHost.Content = _headlineDelta;
        _headlineDeltaHost.Visibility =
            display.ShowHeadlineDelta && _headlineDelta is not null ? Visibility.Visible : Visibility.Collapsed;

        _actionsHost.Content = _actions;
        _actionsHost.Visibility =
            display.ShowActions && _actions is not null ? Visibility.Visible : Visibility.Collapsed;

        _accessory.Visibility = display.ShowHeaderAccessory ? Visibility.Visible : Visibility.Collapsed;

        if (display.ShowEmptyState)
        {
            _emptyState.Message = _emptyStateMessage ?? string.Empty;
            _emptyState.Visibility = Visibility.Visible;
            _kpiGrid.Visibility = Visibility.Collapsed;
        }
        else
        {
            _emptyState.Visibility = Visibility.Collapsed;
            _kpiGrid.Visibility = Visibility.Visible;
            _laidOutColumns = 0;
            LayoutKpiGrid();
        }

        _secondaryHost.Content = BuildSecondary();
        _secondaryHost.Visibility = display.ShowSecondary ? Visibility.Visible : Visibility.Collapsed;

        _footerHost.Content = _footer;
        _footerHost.Visibility = display.ShowFooter && _footer is not null ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyAutomationId()
    {
        string? testId = _source.Input.TestId;
        if (!string.IsNullOrEmpty(testId))
        {
            AutomationProperties.SetAutomationId(this, testId);
            AutomationProperties.SetAutomationId(_kpiGrid, testId + "-kpis");
        }
    }

    private UIElement? BuildSecondary()
    {
        return _secondary switch
        {
            string text when !string.IsNullOrEmpty(text) => new Caption { Value = text },
            string => null,
            UIElement element => element,
            _ => null,
        };
    }

    private void PopulateKpis()
    {
        _kpiGrid.Children.Clear();
        foreach (UIElement tile in _kpis)
        {
            if (tile is FrameworkElement element)
            {
                element.HorizontalAlignment = HorizontalAlignment.Stretch;
            }

            _kpiGrid.Children.Add(tile);
        }

        _laidOutColumns = 0;
        LayoutKpiGrid();
    }

    private void LayoutKpiGrid()
    {
        int count = _kpiGrid.Children.Count;
        if (count == 0)
        {
            _kpiGrid.ColumnDefinitions.Clear();
            _kpiGrid.RowDefinitions.Clear();
            return;
        }

        int columns = _viewModel.Display.ResolveColumnCount(_kpiGrid.ActualWidth);
        columns = Math.Clamp(columns, 1, count);
        int rows = (count + columns - 1) / columns;

        if (columns != _laidOutColumns || _kpiGrid.ColumnDefinitions.Count != columns || _kpiGrid.RowDefinitions.Count != rows)
        {
            _kpiGrid.ColumnDefinitions.Clear();
            for (int c = 0; c < columns; c++)
            {
                _kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            _kpiGrid.RowDefinitions.Clear();
            for (int r = 0; r < rows; r++)
            {
                _kpiGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            _laidOutColumns = columns;
        }

        for (int i = 0; i < count; i++)
        {
            if (_kpiGrid.Children[i] is FrameworkElement tile)
            {
                Grid.SetColumn(tile, i % columns);
                Grid.SetRow(tile, i / columns);
            }
        }
    }
}
