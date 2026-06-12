using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Status;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>HealthRow</c> shared surface — a parity port of the web <c>HealthRow</c>
/// (web/src/components/status/HealthRow.tsx). It is the single-line at-a-glance health row stacked inside the
/// status panels: a status-tinted dot, an optional leading icon, a primary label, a right-aligned summary
/// (e.g. "12 / 12 healthy") tinted by the same status, and a trailing chevron when the row is actionable. It
/// composes the atomic <see cref="TsHealthRow"/> primitive (the shared dot + icon + label + summary + chevron
/// grid, with its built-in pointer / Enter / Space activation and system focus visuals) and binds it to the
/// UI-thread-free <see cref="HealthRowViewModel"/>, so the surface owns only the binding, the activation routing
/// and the diagnostics — the row visuals stay in the component library. Activation is dispatched by the resolved
/// <see cref="HealthRowInteraction"/>: an in-app or external link routes its target through the
/// <see cref="IHealthRowNavigator"/> seam (the web <c>&lt;Link&gt;</c> / <c>&lt;a target="_blank"&gt;</c>), a
/// command invokes the supplied handler (the web <c>&lt;button onClick&gt;</c>), and a plain row is inert (the
/// web <c>&lt;div&gt;</c>). The row keeps the web 44&#215;px minimum touch target and unifies its Narrator name
/// to the web link <c>aria-label</c> ("{label} — {summary}"). There is no loading / error / stale / offline
/// chrome because the web source has no data fetch — it is a pure presentational primitive whose states are the
/// five status tints, the icon-present / icon-absent branches and the four interaction modes, all driven by the
/// bound model. The surface emits the <c>view.opened</c> diagnostic once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class HealthRow : ContentControl, IDisposable
{
    private const double MinRowHeight = 44; // web min-h-[44px] touch target.

    private readonly HealthRowViewModel _viewModel;
    private readonly HealthRowDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsHealthRow _row = new();
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// sample healthy linked row over an inert navigator so the surface renders its visible state. Supply a model
    /// (plus a navigator / handler) through the other constructors to drive it from the composition root.
    /// </summary>
    public HealthRow()
        : this(DesignTimeModel(), navigator: null, onActivated: null, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over its prop set, the navigation seam and an optional click handler (production).</summary>
    /// <param name="model">The prop set (web props).</param>
    /// <param name="navigator">The navigation seam link activations route through.</param>
    /// <param name="onActivated">The click handler invoked for the command branch (web <c>onClick</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HealthRow(
        HealthRowModel model,
        IHealthRowNavigator? navigator = null,
        Action? onActivated = null,
        HealthRowDiagnostics? diagnostics = null)
        : this(new HealthRowViewModel(model, navigator, onActivated), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HealthRow(HealthRowViewModel viewModel, HealthRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new HealthRowDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAutomationId(this, HealthRowRegistration.AutomationId);

        _row.MinHeight = MinRowHeight;
        _row.Activated += OnRowActivated;
        Content = _row;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>HealthRow</c>).</summary>
    public static string Slug => HealthRowRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public HealthRowViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the row reports to Narrator (the web link <c>aria-label</c>).</summary>
    internal string AccessibleName => _viewModel.Projection.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _row.Activated -= OnRowActivated;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    private static HealthRowModel DesignTimeModel() =>
        HealthRowModel.Link(HealthStatus.Healthy, "System health", "All operational", "/system", glyph: "\uE950");

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mount: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(HealthRowViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        var projection = _viewModel.Projection;

        _row.Status = projection.Status;
        _row.Label = projection.Label;
        _row.Summary = projection.Summary;
        _row.IconGlyph = projection.Glyph;
        _row.Actionable = projection.Actionable;

        // Unify the Narrator name to the web link aria-label ("{label} — {summary}"); set last so it wins over
        // the atomic row's own default name, which the property assignments above recomputed.
        AutomationProperties.SetName(_row, projection.AccessibleName);
        AutomationProperties.SetName(this, projection.AccessibleName);
    }

    private void OnRowActivated(object? sender, EventArgs e) => _viewModel.Activate();

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
}
