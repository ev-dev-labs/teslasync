using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Pressure surface — a parity port of
/// <c>web/src/components/data-display/format/Pressure.tsx</c>. The web component is a pure presentational
/// pressure readout: an anonymous <c>&lt;span&gt;</c> that takes a caller-supplied value in <c>bar</c> or
/// <c>psi</c>, converts it to the SI floor (kilopascals), renders it in the user's pressure preference
/// (<c>useUnits().unitPrefs.pressure</c>) via <c>fmtNumber(convertPressureFromSI(kPa, pref), precision)</c>,
/// and exposes a hover <c>title</c> echoing the raw caller value in its source unit; when neither input is
/// finite it renders the em dash <c>—</c>. This surface reproduces that with a <see cref="TextBlock"/> driven
/// by the shared, unit-tested <see cref="PressureProjection"/>, the active unit coming from the
/// <see cref="IPressureUnitSource"/> seam (P1/S8) so the readout re-renders live when the user changes the
/// measurement system. All state flows through <see cref="PressureViewModel"/>; the view performs no I/O.
/// Because the component reads no network data (its inputs are caller-supplied props plus the synchronous unit
/// preference), there is no loading / error / stale / offline chrome — the reproduced render branches are the
/// value state (formatted number + unit + source tooltip) and the empty state (em dash, no tooltip). The
/// formatted value is the surface's accessible name so Narrator announces the meaningful reading, the hover
/// tooltip mirrors the web <c>title</c>, and the host can drive typography (font + the web <c>className</c>)
/// through the control's font properties, which are forwarded to the inner text. The <c>view.opened</c>
/// diagnostic is emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Pressure : ContentControl, IDisposable
{
    private readonly PressureViewModel _viewModel;
    private readonly PressureDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates an empty readout bound to the metric unit preference (the parameterless host/designer entry
    /// point). Real hosts pass a <see cref="SettingsPressureUnitSource"/> so the unit tracks the user's setting.
    /// </summary>
    public Pressure()
        : this(new PressureViewModel(bar: null, psi: null, precision: null, StaticPressureUnitSource.Metric), diagnostics: null)
    {
    }

    /// <summary>Creates the readout over the web inputs and a unit-preference source (P1/S8 seam).</summary>
    /// <param name="bar">The canonical input in bar (web <c>bar</c>), or null.</param>
    /// <param name="psi">The alternative input in psi (web <c>psi</c>), or null.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null.</param>
    /// <param name="unitSource">The unit-preference source.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Pressure(
        double? bar,
        double? psi,
        int? precision,
        IPressureUnitSource unitSource,
        PressureDiagnostics? diagnostics = null)
        : this(new PressureViewModel(bar, psi, precision, unitSource), diagnostics)
    {
    }

    /// <summary>Creates the readout over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Pressure(PressureViewModel viewModel, PressureDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new PressureDiagnostics();
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

        AutomationProperties.SetAutomationId(this, PressureRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Pressure</c>).</summary>
    public static string Slug => PressureRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PressureViewModel ViewModel => _viewModel;

    /// <summary>The canonical input in bar (web <c>bar</c> prop). Assigning re-projects the readout.</summary>
    public double? Bar
    {
        get => _viewModel.Bar;
        set => _viewModel.SetInputs(value, _viewModel.Psi, _viewModel.Precision);
    }

    /// <summary>The alternative input in psi (web <c>psi</c> prop). Used only when <see cref="Bar"/> is not finite.</summary>
    public double? Psi
    {
        get => _viewModel.Psi;
        set => _viewModel.SetInputs(_viewModel.Bar, value, _viewModel.Precision);
    }

    /// <summary>The per-call fraction-digit override (web <c>precision</c> prop). Null uses the default.</summary>
    public int? Precision
    {
        get => _viewModel.Precision;
        set => _viewModel.SetInputs(_viewModel.Bar, _viewModel.Psi, value);
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
    protected override AutomationPeer OnCreateAutomationPeer() => new PressureAutomationPeer(this);

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
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PressureViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        PressureProjection projection = _viewModel.Projection;
        _text.Text = projection.Text;

        // web title: the hover tooltip echoing the raw source value (null in the empty state, where the
        // web span carries no title attribute).
        ToolTipService.SetToolTip(this, projection.Tooltip);

        // Narrator reads the formatted reading (or the em dash) — the span's text content.
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

    private sealed class PressureAutomationPeer : FrameworkElementAutomationPeer
    {
        public PressureAutomationPeer(Pressure owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Pressure)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
