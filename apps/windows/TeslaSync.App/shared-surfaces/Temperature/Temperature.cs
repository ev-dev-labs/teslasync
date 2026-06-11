using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.SharedSurfaces.TemperatureSurface;

/// <summary>
/// The native WinUI 3 <c>Temperature</c> shared surface — a parity port of
/// <c>web/src/components/data-display/format/Temperature.tsx</c>. The web component is a pure presentational
/// temperature readout: an inline <c>&lt;span&gt;</c> that converts a caller-supplied °C (<c>c</c>) or °F
/// (<c>f</c>) value to the user's display unit and renders the locale-formatted number immediately followed
/// by the unit symbol, with a hover <c>title</c> echoing the raw caller value in its source unit; when no
/// finite value is supplied it renders a bare em dash. This surface reproduces that with a tabular-figure
/// <see cref="TextBlock"/> driven by the WinUI-free <see cref="TemperatureViewModel"/> + the shared,
/// unit-tested <see cref="TemperatureProjection"/> (the same conversion + formatting maths the web uses,
/// via <c>UnitConverters</c> / <c>ScalarFormatters</c>). All state flows through the
/// view-model, which binds the user's °C/°F preference through the <see cref="IUnitPreferenceSource"/> seam
/// (the native <c>useUnits()</c>); the view performs no I/O and re-renders when the value or the unit
/// preference changes.
///
/// <para>
/// State coverage: the web source reads no network data — its only data source is <c>useUnits</c> and it
/// renders synchronously from props — so it has no loading / error / stale / offline chrome to reproduce.
/// The two branches it actually has are reproduced in full: the value branch (the converted, formatted
/// readout with the source-value tooltip) and the empty branch (the muted em dash, no tooltip). The web
/// component declares no i18n strings of its own (the only literals are the °C / °F symbols and the em
/// dash), so there are no localized keys to wire.
/// </para>
///
/// <para>
/// The settled readout is the surface's accessible name so Narrator announces the meaningful value, and the
/// raw source value is exposed as the accessible help text (the web <c>title</c>). The host can drive
/// typography (font size/weight/family/colour — the web inherited font + <c>className</c>) through the
/// control's font properties, which are forwarded to the inner text. The <c>view.opened</c> diagnostic is
/// emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class Temperature : ContentControl, IDisposable
{
    private readonly TemperatureViewModel _viewModel;
    private readonly TemperatureDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe, empty readout (no value) over the metric (°C) preference — the native
    /// analogue of mounting the web component with no props in an isolated host / designer. Production
    /// callers use the props / state-holder constructors and inject the app's unit-preference source.
    /// </summary>
    public Temperature()
        : this(TemperatureModel.Empty, StaticUnitPreferenceSource.Metric, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the web props, the unit-preference source and optional diagnostics.</summary>
    /// <param name="celsius">The temperature in °C (web <c>c</c>); takes precedence over <paramref name="fahrenheit"/>.</param>
    /// <param name="fahrenheit">The temperature in °F (web <c>f</c>), used when <paramref name="celsius"/> is absent.</param>
    /// <param name="precision">The optional fraction-digit override (web <c>precision</c>).</param>
    /// <param name="units">The unit-preference source (web <c>useUnits</c>); defaults to metric (°C).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Temperature(
        double? celsius = null,
        double? fahrenheit = null,
        int? precision = null,
        IUnitPreferenceSource? units = null,
        TemperatureDiagnostics? diagnostics = null)
        : this(
            new TemperatureViewModel(
                new TemperatureModel(celsius, fahrenheit, precision),
                units ?? StaticUnitPreferenceSource.Metric),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit model + preference source and optional diagnostics.</summary>
    /// <param name="model">The initial render model (the web props).</param>
    /// <param name="units">The unit-preference source (web <c>useUnits</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Temperature(TemperatureModel model, IUnitPreferenceSource units, TemperatureDiagnostics? diagnostics = null)
        : this(new TemperatureViewModel(model, units), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Temperature(TemperatureViewModel viewModel, TemperatureDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TemperatureDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Foreground = DisplayTokens.TextPrimary;

        // web tabular-figure readout: keep digit columns from jittering when the value updates.
        Typography.SetNumeralAlignment(_text, FontNumeralAlignment.Tabular);

        // Forward the host's typography to the inner text (the web inherited font + className surface).
        ForwardToText(TextBlock.FontFamilyProperty, nameof(FontFamily));
        ForwardToText(TextBlock.FontSizeProperty, nameof(FontSize));
        ForwardToText(TextBlock.FontStyleProperty, nameof(FontStyle));
        ForwardToText(TextBlock.FontWeightProperty, nameof(FontWeight));
        ForwardToText(TextBlock.ForegroundProperty, nameof(Foreground));

        Content = _text;
        AutomationProperties.SetAutomationId(this, TemperatureRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Temperature</c>).</summary>
    public static string Slug => TemperatureRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TemperatureViewModel ViewModel => _viewModel;

    /// <summary>
    /// The canonical °C value (web <c>c</c> prop). Assigning a non-null value selects the °C source;
    /// assigning null with no °F clears the readout to the em dash. Reading returns the current model's °C.
    /// </summary>
    public double? Celsius
    {
        get => _viewModel.Model.C;
        set => _viewModel.SetCelsius(value, _viewModel.Model.Precision);
    }

    /// <summary>
    /// The °F value (web <c>f</c> prop), converted to °C before display. Assigning a non-null value selects
    /// the °F source. Reading returns the current model's °F.
    /// </summary>
    public double? Fahrenheit
    {
        get => _viewModel.Model.F;
        set => _viewModel.SetFahrenheit(value, _viewModel.Model.Precision);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TemperatureAutomationPeer(this);

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
        if (e.PropertyName == nameof(TemperatureViewModel.Display))
        {
            ScheduleRender();
        }
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
        TemperatureDisplay display = _viewModel.Display;
        _text.Text = display.Text;

        // Narrator reads the settled readout (the value + unit, or the em dash).
        AutomationProperties.SetName(this, display.AutomationName);

        if (display.HasValue && !string.IsNullOrEmpty(display.Tooltip))
        {
            // web title: the raw caller value in its source unit, surfaced as the hover tooltip + help text.
            ToolTipService.SetToolTip(this, new ToolTip { Content = display.Tooltip });
            AutomationProperties.SetHelpText(this, display.Tooltip);
        }
        else
        {
            ToolTipService.SetToolTip(this, null);
            AutomationProperties.SetHelpText(this, string.Empty);
        }
    }

    private sealed class TemperatureAutomationPeer : FrameworkElementAutomationPeer
    {
        public TemperatureAutomationPeer(Temperature owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Temperature)Owner).ViewModel.Display.AutomationName
                : name;
        }
    }
}
