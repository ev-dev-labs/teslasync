using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.SharedSurfaces.ChartHiddenSeriesContextSurface;

/// <summary>
/// The native WinUI 3 context bridge for URL-persisted hidden-series state — a parity port of
/// <c>web/src/components/charts/ChartHiddenSeriesContext.tsx</c> in its role as the prop-drilling-free channel
/// between a <c>ChartContainer chartKey="…"</c> and the legend buried inside it. The web module exports a React
/// context whose value is a <see cref="HiddenSeriesState"/> or <c>null</c> (the chart did not opt into legend
/// toggling); a legend deep in the tree reads it with <c>useChartHiddenSeries()</c> without receiving it as a prop.
/// WinUI has no React context, so the nearest-ancestor lookup is reproduced with an attached
/// <see cref="StateProperty"/> set by the provider and the tree-walking reader <see cref="GetNearest"/> — the exact
/// semantics of <c>useContext</c> (nearest provider, else <c>null</c>). Because the state is a synchronous
/// in-process query-string read (the web <c>useSearchParams</c> is synchronous, never a network fetch), this
/// surface has no loading / error / stale / offline chrome — the same rationale the sibling
/// <see cref="TeslaSync.App.SharedSurfaces.VisuallyHiddenSurface.VisuallyHidden"/> surface documents; its only
/// states are not-opted-in (<c>null</c>), empty (no series hidden) and active (one or more hidden).
/// </summary>
public static class ChartHiddenSeriesContext
{
    /// <summary>
    /// The attached state the provider sets on itself (the React context value). Read the nearest ancestor's value
    /// with <see cref="GetNearest"/> rather than this raw accessor, which returns only an element's own local value.
    /// </summary>
    public static readonly DependencyProperty StateProperty = DependencyProperty.RegisterAttached(
        "State",
        typeof(HiddenSeriesState),
        typeof(ChartHiddenSeriesContext),
        new PropertyMetadata(null));

    /// <summary>Set the provided hidden-series state on <paramref name="element"/> (the provider sets this on itself).</summary>
    /// <param name="element">The element that provides the context (the provider).</param>
    /// <param name="value">The hidden-series state to provide, or <c>null</c> when the chart did not opt in.</param>
    public static void SetState(DependencyObject element, HiddenSeriesState? value)
    {
        ArgumentNullException.ThrowIfNull(element);
        element.SetValue(StateProperty, value);
    }

    /// <summary>Read an element's own provided state (its local attached value); <c>null</c> when it provides none.</summary>
    /// <param name="element">The element to read the local provided value from.</param>
    public static HiddenSeriesState? GetState(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);
        return (HiddenSeriesState?)element.GetValue(StateProperty);
    }

    /// <summary>
    /// Read the hidden-series state from the nearest ancestor provider (web <c>useChartHiddenSeries()</c> →
    /// <c>useContext(ChartHiddenSeriesContext)</c>). Walks up the visual tree, falling back to the logical parent,
    /// and returns the first provided state — or <c>null</c> when no provider is in scope (the web default context
    /// value) or the nearest provider's chart did not opt into toggling.
    /// </summary>
    /// <param name="element">The element reading the context (e.g. a legend inside the chart container).</param>
    public static HiddenSeriesState? GetNearest(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);

        DependencyObject? current = element;
        while (current is not null)
        {
            if (GetState(current) is { } state)
            {
                return state;
            }

            current = GetParentObject(current);
        }

        return null;
    }

    private static DependencyObject? GetParentObject(DependencyObject element)
    {
        DependencyObject? parent = VisualTreeHelper.GetParent(element);
        if (parent is not null)
        {
            return parent;
        }

        // Before the element is in the live visual tree, fall back to the logical parent so the lookup still
        // resolves the provider (e.g. during template realisation or in a detached subtree).
        return element is FrameworkElement frameworkElement ? frameworkElement.Parent : null;
    }
}

/// <summary>
/// The native WinUI 3 hidden-series provider — the parity port of the web <c>ChartHiddenSeriesProvider</c>
/// (<c>web/src/components/charts/ChartHiddenSeriesContext.tsx</c>). It wraps a chart's content and provides the
/// URL-backed <see cref="HiddenSeriesState"/> via <see cref="ChartHiddenSeriesContext"/> so a nested legend reads
/// it with <see cref="ChartHiddenSeriesContext.GetNearest"/>. Mirroring the web source's only conditional branch,
/// when <see cref="ChartKey"/> is null or empty the provided value is <c>null</c> (the chart did not adopt
/// toggling); otherwise a state holder is created over the query store (web <c>useHiddenSeries(chartKey)</c>). The
/// provider contributes no accessible node of its own (web bare fragment): it is an
/// <see cref="AccessibilityView.Raw"/> structural wrapper, so Narrator traverses straight to the hosted chart. It
/// emits the <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/> and disposes its
/// state on <see cref="FrameworkElement.Unloaded"/>.
/// </summary>
public sealed partial class ChartHiddenSeriesProvider : ContentControl, IDisposable
{
    /// <summary>The chart identifier (web <c>chartKey</c> prop). A null/empty value provides <c>null</c> state.</summary>
    public static readonly DependencyProperty ChartKeyProperty = DependencyProperty.Register(
        nameof(ChartKey),
        typeof(string),
        typeof(ChartHiddenSeriesProvider),
        new PropertyMetadata(null, OnChartKeyChanged));

    private readonly IHiddenSeriesQueryStore _store;
    private readonly ChartHiddenSeriesDiagnostics _diagnostics;
    private HiddenSeriesState? _state;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the provider over the process-wide query store (the web shared URL).</summary>
    public ChartHiddenSeriesProvider()
        : this(HiddenSeriesQueryStore.Shared, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the provider over an explicit query-store seam (tests / headless hosts) and an optional PII-safe
    /// diagnostics collector.
    /// </summary>
    /// <param name="store">The query-string seam the provided state binds to.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics collector.</param>
    public ChartHiddenSeriesProvider(IHiddenSeriesQueryStore store, ChartHiddenSeriesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);

        _store = store;
        _diagnostics = diagnostics ?? new ChartHiddenSeriesDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web fragment contributes no accessible node of its own, so the
        // provider hides itself from Narrator and lets the hosted chart and its legend carry the semantics.
        AutomationProperties.SetAccessibilityView(
            this,
            ChartHiddenSeriesAccessibility.ProviderContributesAccessibleNode ? AccessibilityView.Content : AccessibilityView.Raw);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        RebuildState();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>ChartHiddenSeriesContext</c>).</summary>
    public static string Slug => ChartHiddenSeriesRegistration.Slug;

    /// <summary>The chart identifier whose hidden-series state this provider exposes (web <c>chartKey</c>).</summary>
    public string? ChartKey
    {
        get => (string?)GetValue(ChartKeyProperty);
        set => SetValue(ChartKeyProperty, value);
    }

    /// <summary>
    /// The provided hidden-series state (web <c>children(state)</c>): the bound holder, or <c>null</c> when the
    /// chart did not opt into legend toggling.
    /// </summary>
    public HiddenSeriesState? State => _state;

    /// <summary>Dispose the provided state and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _state?.Dispose();
        _state = null;
        GC.SuppressFinalize(this);
    }

    private static void OnChartKeyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((ChartHiddenSeriesProvider)d).RebuildState();

    private void RebuildState()
    {
        _state?.Dispose();
        _state = ChartHiddenSeriesProviderModel.Create(_store, ChartKey, _diagnostics);
        ChartHiddenSeriesContext.SetState(this, _state);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirrors the web provider mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
