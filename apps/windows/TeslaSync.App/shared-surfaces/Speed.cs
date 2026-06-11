using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Settings;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Speed surface — a parity port of
/// <c>web/src/components/data-display/format/Speed.tsx</c>. The web component is a pure presentational speed
/// readout: a <c>&lt;span&gt;</c> that takes a caller-supplied speed in <c>mph</c> or <c>kmh</c>, folds it to SI
/// metres-per-second, reconverts to the user's <see cref="TeslaSync.App.Core.Units.UnitPref.Speed"/> preference
/// (web <c>convertSpeedFromSI</c>), and renders <c>{fmtNumber(value, precision)} {speedUnit}</c> with an HTML
/// <c>title</c> showing the raw caller value in its source unit. This surface reproduces that with a
/// <see cref="TextBlock"/> hosted in a <see cref="ContentControl"/>, a <see cref="ToolTipService"/> tooltip for
/// the title, and the converted value as the control's accessible name. All state flows through
/// <see cref="SpeedViewModel"/> over the shared <see cref="IUnitPreferenceSource"/> seam (the <c>useUnits</c>
/// analog); the view performs no I/O and no unit maths of its own. It re-renders when the host pushes a new
/// reading or when the user switches their measurement system at runtime (the web <c>useUnits</c> re-render).
/// Because the component reads no network data, there is no loading / error / stale / offline chrome and no
/// animation; the reproduced render branches are the mph value, the km/h value, and the empty fallback (the
/// web bare <c>—</c> span). The <c>view.opened</c> diagnostic is emitted exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Speed : ContentControl, IDisposable
{
    private readonly SpeedViewModel _viewModel;
    private readonly SpeedDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates an empty readout bound to the shared application unit preference (the parameterless host/designer
    /// entry point). With no reading supplied the surface shows the empty fallback until a value is pushed.
    /// </summary>
    public Speed()
        : this(new SpeedViewModel(null, null, null, new AppSettingsUnitPreferenceSource(AppSettingsHost.Service)), diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the readout over the web props, bound to the shared application unit preference.
    /// </summary>
    /// <param name="mph">The speed in miles-per-hour (web <c>mph</c>), or null.</param>
    /// <param name="kmh">The speed in kilometres-per-hour (web <c>kmh</c>), or null.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Speed(double? mph = null, double? kmh = null, int? precision = null, SpeedDiagnostics? diagnostics = null)
        : this(
            new SpeedViewModel(mph, kmh, precision, new AppSettingsUnitPreferenceSource(AppSettingsHost.Service)),
            diagnostics)
    {
    }

    /// <summary>Creates the readout over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Speed(SpeedViewModel viewModel, SpeedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new SpeedDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Foreground = DisplayTokens.TextPrimary;

        // Forward the host's typography to the inner text (the web inherited font + className surface).
        ForwardToText(TextBlock.FontFamilyProperty, nameof(FontFamily));
        ForwardToText(TextBlock.FontSizeProperty, nameof(FontSize));
        ForwardToText(TextBlock.FontStyleProperty, nameof(FontStyle));
        ForwardToText(TextBlock.FontWeightProperty, nameof(FontWeight));
        ForwardToText(TextBlock.ForegroundProperty, nameof(Foreground));

        Content = _text;

        AutomationProperties.SetAutomationId(this, SpeedRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Speed</c>).</summary>
    public static string Slug => SpeedRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SpeedViewModel ViewModel => _viewModel;

    /// <summary>The miles-per-hour reading (web <c>mph</c> prop). Assigning re-renders the readout.</summary>
    public double? Mph
    {
        get => _viewModel.Mph;
        set => _viewModel.SetMph(value);
    }

    /// <summary>The kilometres-per-hour reading (web <c>kmh</c> prop). Assigning re-renders the readout.</summary>
    public double? Kmh
    {
        get => _viewModel.Kmh;
        set => _viewModel.SetKmh(value);
    }

    /// <summary>The per-call fraction-digit override (web <c>precision</c> prop). Assigning re-renders.</summary>
    public int? Precision
    {
        get => _viewModel.Precision;
        set => _viewModel.SetPrecision(value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SpeedAutomationPeer(this);

    private void ForwardToText(DependencyProperty target, string sourceProperty) =>
        _text.SetBinding(
            target,
            new Binding
            {
                Source = this,
                Path = new PropertyPath(sourceProperty),
                Mode = BindingMode.OneWay,
            });

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Reproject always raises Projection when anything visible changes; a single key re-renders once.
        if (e.PropertyName == nameof(SpeedViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        SpeedProjection projection = _viewModel.Projection;
        _text.Text = projection.DisplayText;

        // web title attribute: the raw source value + source unit on hover. In the empty state the web span has no
        // title, so clear the tooltip and the (a11y) help text.
        if (projection.Title is { Length: > 0 } title)
        {
            ToolTipService.SetToolTip(this, title);
            AutomationProperties.SetHelpText(this, title);
        }
        else
        {
            ToolTipService.SetToolTip(this, null);
            AutomationProperties.SetHelpText(this, string.Empty);
        }

        // Narrator reads the converted, formatted value (the visible span text), not the raw source.
        AutomationProperties.SetName(this, projection.AccessibleName);
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

    private sealed class SpeedAutomationPeer : FrameworkElementAutomationPeer
    {
        public SpeedAutomationPeer(Speed owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Speed)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
