using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;
using Windows.UI.Text;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetChartSummary</c> widget primitive — a parity port of
/// web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx. It is the shared building block many dashboard
/// widgets compose: a compact row of labelled stat figures above a chart slot. It is purely presentational and
/// driven entirely by props — it reads no query and performs no fetch — so it reproduces exactly the branches the
/// web source has and (like the peer presentational surfaces <c>Spinner</c> and <c>EmptyStateThreshold</c>) has no
/// loading / error / stale / offline chrome of its own; the parent widget owns those states and flips this
/// primitive into its single empty branch via <c>isEmpty</c>.
///
/// <para>
/// Reproduced branches: the early empty branch (web <c>if (isEmpty) return &lt;EmptyState … /&gt;</c>) renders the
/// shared <see cref="TsEmptyState"/> with the resolved message and the optional caller glyph (web <c>emptyIcon</c>);
/// the populated branch renders the stat row (web <c>{stats.length &gt; 0 &amp;&amp; …}</c>) above the chart slot
/// (web <c>{!compact &amp;&amp; …}</c>). The stat row reproduces the web responsive rule: a mobile-safe 2-column grid
/// by default, relaxing into a horizontal row once the control is at least
/// <see cref="WidgetChartSummaryRegistration.HorizontalBreakpointDip"/> DIPs wide (web container query <c>@sm</c>),
/// and always forced to the 2-column grid in compact mode.
/// </para>
///
/// <para>
/// All state flows through <see cref="WidgetChartSummaryViewModel"/> and the P1/S8
/// <see cref="IWidgetChartSummarySource"/> props seam; the view performs no I/O and reads no query itself. The chart
/// is a live <see cref="UIElement"/> slot the caller supplies (web <c>chart</c>). Each stat cell carries a composed
/// "label, value unit" Narrator reading while its raw text blocks are hidden from the accessibility tree; the empty
/// branch's <see cref="TsEmptyState"/> is itself a polite status region (web <c>role="status"</c>). It emits the
/// <c>view.opened</c> diagnostic once when it is shown.
/// </para>
/// </summary>
public sealed partial class WidgetChartSummary : ContentControl, IDisposable
{
    private readonly WidgetChartSummaryViewModel _viewModel;
    private readonly WidgetChartSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly TsEmptyState _emptyHost = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _contentColumn = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _statsHost = new() { Visibility = Visibility.Collapsed };

    private readonly ContentPresenter _chartHost = new()
    {
        Visibility = Visibility.Collapsed,
        Margin = new Thickness(0, WidgetChartSummaryRegistration.ChartTopMargin, 0, 0),
        HorizontalContentAlignment = HorizontalAlignment.Stretch,
        VerticalContentAlignment = VerticalAlignment.Stretch,
    };

    private IReadOnlyList<StatCellDisplay> _stats = Array.Empty<StatCellDisplay>();
    private bool _compact;
    private bool _showStats;
    private bool _horizontal;
    private UIElement? _chart;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no inputs (the designer / parameterless host entry point): it renders the default
    /// empty state for an empty section. Strings resolve through the passthrough facade; supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="IWidgetChartSummarySource"/> via the other constructors to
    /// drive i18n and props from the composition root.
    /// </summary>
    public WidgetChartSummary()
        : this(PassthroughLocalizer.Instance, new StaticWidgetChartSummarySource(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade and a bound props seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetChartSummary(
        ILocalizer localizer,
        IWidgetChartSummarySource source,
        WidgetChartSummaryDiagnostics? diagnostics = null)
        : this(new WidgetChartSummaryViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetChartSummary(
        WidgetChartSummaryViewModel viewModel,
        WidgetChartSummaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new WidgetChartSummaryDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // web "flex h-full flex-col": the stat row takes its natural height at the top, the chart fills the rest
        // (web flex-1 min-h-0).
        _contentColumn.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _contentColumn.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_statsHost, 0);
        Grid.SetRow(_chartHost, 1);
        _contentColumn.Children.Add(_statsHost);
        _contentColumn.Children.Add(_chartHost);

        _root.Children.Add(_contentColumn);
        _root.Children.Add(_emptyHost);
        Content = _root;

        AutomationProperties.SetAutomationId(this, WidgetChartSummaryRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        SizeChanged += OnSizeChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>WidgetChartSummary</c>).</summary>
    public static string Slug => WidgetChartSummaryRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public WidgetChartSummaryViewModel ViewModel => _viewModel;

    /// <summary>
    /// The chart element rendered below the stat row (web <c>chart</c> slot). Setting a non-null element hosts it;
    /// clearing it (null) empties the slot. The slot is only shown when the primitive is not in compact mode
    /// (web <c>{!compact &amp;&amp; …}</c>) and a chart is present.
    /// </summary>
    public UIElement? Chart
    {
        get => _chart;
        set
        {
            _chart = value;
            _chartHost.Content = value;
            UpdateChartVisibility(_viewModel.ShowChart);
        }
    }

    /// <summary>
    /// The accessible name the automation peer reports: the empty message when the primitive is in its empty branch
    /// (the web <c>EmptyState</c> status text), otherwise empty so Narrator reads the individual stat cells.
    /// </summary>
    internal string AccessibleName => _viewModel.IsEmpty ? _viewModel.EmptyMessage : string.Empty;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new WidgetChartSummaryAutomationPeer(this);

    private static FontWeight Weight(double value) => new() { Weight = (ushort)value };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // The control now has a measured width; re-evaluate the responsive stat layout.
        LayoutStats();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_disposed || !_showStats || _compact)
        {
            return;
        }

        bool horizontal = e.NewSize.Width >= WidgetChartSummaryRegistration.HorizontalBreakpointDip;
        if (horizontal != _horizontal)
        {
            LayoutStats();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WidgetChartSummaryViewModel.Display))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        WidgetChartSummaryDisplay display = _viewModel.Display;
        _compact = display.Compact;

        if (display.IsEmpty)
        {
            // web L28-L29: if (isEmpty) return <EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />
            _emptyHost.Message = display.EmptyMessage;
            _emptyHost.IconGlyph = display.EmptyIconGlyph ?? string.Empty; // web {icon && …}: no glyph → no icon
            _emptyHost.Visibility = Visibility.Visible;
            _contentColumn.Visibility = Visibility.Collapsed;
        }
        else
        {
            _emptyHost.Visibility = Visibility.Collapsed;
            _contentColumn.Visibility = Visibility.Visible;

            _stats = display.Stats;
            _showStats = display.ShowStats;
            _statsHost.Visibility = display.ShowStats ? Visibility.Visible : Visibility.Collapsed;
            LayoutStats();

            UpdateChartVisibility(display.ShowChart);
        }

        AutomationProperties.SetName(this, AccessibleName);
    }

    private void UpdateChartVisibility(bool showChart)
    {
        bool show = showChart && _chart is not null;
        _chartHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private void LayoutStats()
    {
        _statsHost.Children.Clear();
        _statsHost.ColumnDefinitions.Clear();
        _statsHost.RowDefinitions.Clear();

        if (!_showStats || _stats.Count == 0)
        {
            return;
        }

        // web: default grid-cols-2; @sm relaxes to a horizontal flex row (one column per stat); compact forces
        // the 2-column grid regardless of width.
        _horizontal = !_compact && ActualWidth >= WidgetChartSummaryRegistration.HorizontalBreakpointDip;
        double gap = _horizontal ? WidgetChartSummaryRegistration.WideGap : WidgetChartSummaryRegistration.CompactGap;
        _statsHost.ColumnSpacing = gap;
        _statsHost.RowSpacing = gap;

        int count = _stats.Count;
        int columns = _horizontal ? count : WidgetChartSummaryRegistration.DefaultColumns;
        int rows = (int)Math.Ceiling(count / (double)columns);

        for (int c = 0; c < columns; c++)
        {
            _statsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            _statsHost.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            StackPanel cell = BuildStatCell(_stats[i]);
            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            _statsHost.Children.Add(cell);
        }
    }

    private static StackPanel BuildStatCell(StatCellDisplay stat)
    {
        // web L46: <div className="flex min-w-0 flex-col"> — a column that can shrink so the text truncates.
        var panel = new StackPanel { Orientation = Orientation.Vertical, MinWidth = 0 };

        // web L47: <span className="truncate text-[10px] text-[var(--text-muted)]">{label}</span>
        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = WidgetChartSummaryRegistration.MicroFontSize,
            FontWeight = Weight(WidgetChartSummaryRegistration.MutedFontWeight),
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        // web L48-L55: <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{value}{unit?…}</span>
        var value = new TextBlock
        {
            FontSize = WidgetChartSummaryRegistration.ValueFontSize,
            FontWeight = Weight(WidgetChartSummaryRegistration.ValueFontWeight),
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        value.Inlines.Add(new Run { Text = stat.Value });
        if (stat.HasUnit)
        {
            // web L51-L53: <span className="ml-0.5 text-[10px] font-normal text-[var(--text-muted)]">{unit}</span>
            value.Inlines.Add(new Run
            {
                Text = "\u2009" + stat.Unit, // thin space ≈ web ml-0.5 gap before the unit
                FontSize = WidgetChartSummaryRegistration.MicroFontSize,
                FontWeight = Weight(WidgetChartSummaryRegistration.MutedFontWeight),
                Foreground = DisplayTokens.TextMuted,
            });
        }

        panel.Children.Add(label);
        panel.Children.Add(value);

        // Read the cell as one coherent figure; hide the raw spans so Narrator does not read them twice.
        AutomationProperties.SetName(panel, stat.AccessibleName);
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        return panel;
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class WidgetChartSummaryAutomationPeer : FrameworkElementAutomationPeer
    {
        public WidgetChartSummaryAutomationPeer(WidgetChartSummary owner)
            : base(owner)
        {
        }

        private WidgetChartSummary Surface => (WidgetChartSummary)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
