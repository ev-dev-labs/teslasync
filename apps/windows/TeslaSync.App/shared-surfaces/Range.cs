using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Range surface — a parity port of
/// <c>web/src/components/data-display/format/Range.tsx</c>. The web component is a pure presentational readout: a
/// <c>&lt;span&gt;</c> that renders the user's preferred range (<c>usePreferredRange</c> — rated vs ideal) formatted
/// in the user's distance unit (<c>useUnits().formatDistance</c>), or an em dash (<c>—</c>) when the preferred
/// range is null. This surface reproduces that with a tabular-figure <see cref="TextBlock"/> driven entirely by
/// the shared, unit-tested <see cref="RangeProjection"/> through the WinUI-free <see cref="RangeViewModel"/>; the
/// view performs no I/O and no unit math. Because the component reads no network data (its only inputs are the
/// caller-supplied <see cref="State"/> snapshot and the user's unit / preferred-range preferences) it has no
/// loading / error / stale / offline chrome — the reproduced render branches are exactly the web source's two:
/// the formatted-value branch (rated|ideal × km|mi × precision) and the em-dash empty branch. The accessible name
/// combines the rated/ideal label (the web <c>useRangeLabel</c> companion) with the value, so Narrator hears
/// "Rated Range: 410 km" rather than a bare dash, and the host can drive typography (font size/weight/family/colour
/// — the web inherited font + <c>className</c>) through the control's font properties, which are forwarded to the
/// inner text. The <c>view.opened</c> diagnostic is emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Range : ContentControl
{
    private readonly RangeViewModel _viewModel;
    private readonly RangeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;

    /// <summary>
    /// Creates the readout with the web prop defaults (no snapshot, rated range, metric units, <c>precision = 0</c>)
    /// over the passthrough localizer — the parameterless host/designer entry point.
    /// </summary>
    public Range()
        : this(new RangeViewModel(PassthroughLocalizer.Instance), diagnostics: null)
    {
    }

    /// <summary>Creates the readout over an explicit state holder (hosts / tests) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Range(RangeViewModel viewModel, RangeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new RangeDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Foreground = DisplayTokens.TextPrimary;

        // web tabular-nums: tabular figures keep digit columns aligned across value changes.
        Typography.SetNumeralAlignment(_text, FontNumeralAlignment.Tabular);

        // Forward the host's typography to the inner text (the web inherited font + className surface).
        ForwardToText(TextBlock.FontFamilyProperty, nameof(FontFamily));
        ForwardToText(TextBlock.FontSizeProperty, nameof(FontSize));
        ForwardToText(TextBlock.FontStyleProperty, nameof(FontStyle));
        ForwardToText(TextBlock.FontWeightProperty, nameof(FontWeight));
        ForwardToText(TextBlock.ForegroundProperty, nameof(Foreground));

        Content = _text;

        AutomationProperties.SetAutomationId(this, RangeRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Range</c>).</summary>
    public static string Slug => RangeRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RangeViewModel ViewModel => _viewModel;

    /// <summary>The vehicle/charge snapshot (web <c>state</c> prop). Assigning re-renders the readout.</summary>
    public RangeState? State
    {
        get => _viewModel.State;
        set => _viewModel.State = value;
    }

    /// <summary>The preferred-range preference (web <c>useSettings().rangeType</c>). Assigning re-renders.</summary>
    public RangeType PreferredRange
    {
        get => _viewModel.PreferredRange;
        set => _viewModel.PreferredRange = value;
    }

    /// <summary>The display-unit preference (web <c>useUnits().unitPrefs</c>). Assigning re-renders.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>The decimal precision (web <c>precision</c>). Assigning re-renders.</summary>
    public int Precision
    {
        get => _viewModel.Precision;
        set => _viewModel.Precision = value;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RangeAutomationPeer(this);

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

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Reproject always raises Projection when anything changes, so a single key re-renders once.
        if (e.PropertyName == nameof(RangeViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        RangeProjection projection = _viewModel.Projection;
        _text.Text = projection.Value;

        // Narrator reads the labelled value (or "no value"), not a bare em dash.
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

    private sealed class RangeAutomationPeer : FrameworkElementAutomationPeer
    {
        public RangeAutomationPeer(Range owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((Range)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
