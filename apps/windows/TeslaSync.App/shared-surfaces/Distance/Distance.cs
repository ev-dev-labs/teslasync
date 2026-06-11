using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Distance surface — a parity port of the web <c>Distance</c> renderer
/// (web/src/components/data-display/format/Distance.tsx). The web component is a pure, unit-aware inline
/// readout: it takes a caller-supplied <c>miles</c> or <c>km</c> value, normalises it to SI metres, converts
/// it to the user's distance preference (<c>useUnits</c> → <c>convertDistanceFromSI</c>), formats it with
/// <c>fmtNumber</c> and renders <c>{number} {unit}</c> in a <c>&lt;span&gt;</c>, exposing the raw caller value
/// through the element's <c>title</c> tooltip; when no finite value is supplied it renders an em dash. This
/// surface reproduces that with a tabular-figure <see cref="TextBlock"/> driven entirely by
/// <see cref="DistanceViewModel"/> — the view performs no unit maths and no I/O. The raw-value tooltip is
/// reproduced with <see cref="ToolTipService"/>; the formatted readout (or the dash) is the surface's
/// accessible name so Narrator announces the meaningful value; and the host can drive typography (font
/// size/weight/family/colour — the web inherited font + <c>className</c>) through the control's font
/// properties, which are forwarded to the inner text. Because the component reads no network data and its only
/// data source is the synchronous unit preference, there is no loading / error / stale / offline chrome; the
/// reproduced branches are the formatted-value readout and the no-value em dash, across the mi / km input
/// channels and the user's distance-unit and precision variants. The <c>view.opened</c> diagnostic is emitted
/// exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Distance : ContentControl, IDisposable
{
    private readonly DistanceViewModel _viewModel;
    private readonly DistanceDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the readout over the process-default unit source with no value (the parameterless host/designer
    /// entry point; the empty em-dash state until a value is assigned).
    /// </summary>
    public Distance()
        : this(new DistanceViewModel(new DistanceUnitsSource()), diagnostics: null)
    {
    }

    /// <summary>Creates the readout over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Distance(DistanceViewModel viewModel, DistanceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new DistanceDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Foreground = DisplayTokens.TextPrimary;

        // web tabular-nums equivalent: tabular figures keep the digit columns from shifting as the value changes.
        Typography.SetNumeralAlignment(_text, FontNumeralAlignment.Tabular);

        // Forward the host's typography to the inner text (the web inherited font + className surface).
        ForwardToText(TextBlock.FontFamilyProperty, nameof(FontFamily));
        ForwardToText(TextBlock.FontSizeProperty, nameof(FontSize));
        ForwardToText(TextBlock.FontStyleProperty, nameof(FontStyle));
        ForwardToText(TextBlock.FontWeightProperty, nameof(FontWeight));
        ForwardToText(TextBlock.ForegroundProperty, nameof(Foreground));

        Content = _text;

        AutomationProperties.SetAutomationId(this, DistanceRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Distance</c>).</summary>
    public static string Slug => DistanceRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DistanceViewModel ViewModel => _viewModel;

    /// <summary>The value in miles (web <c>miles</c> prop). Assigning re-projects and re-renders.</summary>
    public double? Miles
    {
        get => _viewModel.Miles;
        set => _viewModel.SetMiles(value);
    }

    /// <summary>The value in kilometres (web <c>km</c> prop), used only when <see cref="Miles"/> is unset.</summary>
    public double? Kilometers
    {
        get => _viewModel.Kilometers;
        set => _viewModel.SetKilometers(value);
    }

    /// <summary>The explicit fraction-digit override (web <c>precision</c> prop); null uses the preference default.</summary>
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
    protected override AutomationPeer OnCreateAutomationPeer() => new DistanceAutomationPeer(this);

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

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(DistanceViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        DistanceProjection projection = _viewModel.Projection;
        _text.Text = projection.Display;

        // web title attribute: the raw caller value, shown on hover; removed in the empty state.
        ToolTipService.SetToolTip(this, projection.Title);

        // Narrator reads the visible readout (or the dash) — the web inline text node.
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

    private sealed class DistanceAutomationPeer : FrameworkElementAutomationPeer
    {
        public DistanceAutomationPeer(Distance owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Distance)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
