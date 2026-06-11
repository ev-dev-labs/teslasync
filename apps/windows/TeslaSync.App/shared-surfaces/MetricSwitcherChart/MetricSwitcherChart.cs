using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>MetricSwitcherChart</c> shared surface — a parity port of
/// web/src/components/charts/MetricSwitcherChart.tsx. It is a controlled, presentational chart with a pill row above
/// it for switching the displayed metric. Bound to an <see cref="IMetricSwitcherChartSource"/> (the P1/S8 seam
/// standing in for the web <c>series</c> / <c>metrics</c> / <c>activeMetric</c> / <c>onMetricChange</c> props), it
/// frames a <see cref="TsChartContainer"/> with the localized title and the chart's accessible name, slots a
/// <see cref="TsPillFilterBar"/> (the native <c>PillFilterBar</c>) into the container's header actions, and draws the
/// active metric's points as a bar / area / line series in a hosted <see cref="TsComposedChart"/>. When the active
/// metric has no points the container switches to its empty body and shows the caller's empty message — the native
/// analogue of the web <c>projected.length === 0 ? &lt;EmptyState/&gt; : &lt;chart/&gt;</c> branch — while the pill
/// row stays visible. There is no loading / error / stale / offline chrome because the web source is a controlled
/// component with no data fetch; its only states are the empty active series and the populated active series. All
/// state lives in the UI-thread-free <see cref="MetricSwitcherChartViewModel"/>; this view only owns the WinUI wiring
/// — it observes the holder, marshals re-renders onto its captured <see cref="DispatcherQueue"/> (the source may
/// mutate from a background callback) and emits the <c>view.opened</c> diagnostic once on load.
/// </summary>
public sealed partial class MetricSwitcherChart : ContentControl, IDisposable
{
    private readonly MetricSwitcherChartViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsChartContainer _container = new();
    private readonly TsComposedChart _chart = new() { ShowLegend = false };
    private readonly TsPillFilterBar _switcher = new();

    private bool _renderQueued;
    private bool _opened;
    private bool _disposed;
    private bool _suppressSelection;

    /// <summary>Creates the surface over its controlled-input seam, the localizer and an optional diagnostics collector.</summary>
    /// <param name="source">The controlled-input seam (P1/S8) the chart binds to.</param>
    /// <param name="localizer">The i18n facade the pill-row accessible name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MetricSwitcherChart(
        IMetricSwitcherChartSource source,
        ILocalizer localizer,
        MetricSwitcherChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MetricSwitcherChartViewModel(source, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _container;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MetricSwitcherChart</c>).</summary>
    public static string Slug => MetricSwitcherChartRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public MetricSwitcherChartViewModel ViewModel => _viewModel;

    /// <summary>Detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _switcher.SelectionChanged -= OnSwitcherSelectionChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MetricSwitcherChartAutomationPeer(this);

    private void BuildChrome()
    {
        _switcher.SelectionChanged += OnSwitcherSelectionChanged;
        _container.Actions = _switcher;
        _container.Body = _chart;
        AutomationProperties.SetAutomationId(this, MetricSwitcherChartRegistration.RootAutomationId);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void OnSwitcherSelectionChanged(object? sender, string? key)
    {
        if (_suppressSelection || string.IsNullOrEmpty(key))
        {
            return;
        }

        // web onMetricChange(key)
        _viewModel.Select(key);
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
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
        _container.Title = _viewModel.Title;
        _container.AccessibleSummary = _viewModel.AccessibleName;
        _container.EmptyMessage = _viewModel.EmptyMessage;

        AutomationProperties.SetName(this, _viewModel.AccessibleName);
        AutomationProperties.SetName(_switcher, _viewModel.SwitcherLabel);

        // web: the pill row is built from items = metrics.map(...).
        _switcher.Options = BuildOptions(_viewModel.Items);
        _suppressSelection = true;
        _switcher.SelectedValue = _viewModel.ActiveMetric;
        _suppressSelection = false;

        _chart.MinHeight = _viewModel.Height;
        _chart.Series = _viewModel.ActiveSeries;

        // web: projected.length === 0 ? <EmptyState/> : <chart/> — the container's empty body is the EmptyState.
        _container.State = _viewModel.IsEmpty ? ChartState.Empty : ChartState.Ready;
    }

    private static List<ComboOption> BuildOptions(IReadOnlyList<MetricSwitcherPill> pills)
    {
        var options = new List<ComboOption>(pills.Count);
        foreach (var pill in pills)
        {
            options.Add(new ComboOption(pill.Key, pill.Label));
        }

        return options;
    }

    /// <summary>
    /// Exposes the surface as an accessible group whose name is the chart's accessible label, so Narrator announces
    /// the metric-switcher chart region (the web container's labelled region).
    /// </summary>
    private sealed class MetricSwitcherChartAutomationPeer : FrameworkElementAutomationPeer
    {
        public MetricSwitcherChartAutomationPeer(MetricSwitcherChart owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((MetricSwitcherChart)Owner).ViewModel.AccessibleName : name;
        }
    }
}
