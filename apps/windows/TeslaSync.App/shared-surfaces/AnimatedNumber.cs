using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.DataDisplay;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 AnimatedNumber surface — a parity port of
/// <c>web/src/components/data-display/AnimatedNumber.tsx</c>. The web component is a pure presentational count-up
/// readout: a <c>&lt;span class="tabular-nums"&gt;</c> that tweens its displayed value from <c>0</c> to the
/// <c>value</c> prop over <c>duration</c> seconds with an ease-out-quad curve, wrapping the locale-formatted
/// number (<c>fmtNumber(display, decimals)</c>) in an optional <c>prefix</c> / <c>suffix</c>. This surface
/// reproduces that with a tabular-figure <see cref="TextBlock"/> driven by a ~60fps <see cref="DispatcherTimer"/>
/// over the shared, unit-tested <see cref="AnimatedNumberModel"/> tween (the same ease-out-quad maths the web
/// uses), formatting each frame through the shared <see cref="AnimatedNumberProjection"/>. All state flows
/// through <see cref="AnimatedNumberViewModel"/>; the view performs no I/O. It is reduced-motion-aware: under the
/// OS "animations off" preference (or a non-positive duration) the count-up is skipped and the readout snaps to
/// its final value — the web <c>prefers-reduced-motion</c> / instant-settle behaviour. Because the component
/// reads no network data (its only inputs are caller-supplied props), there is no loading / error / stale /
/// offline chrome; the reproduced branches are the full-motion count-up, the reduced-motion / zero-duration snap,
/// and the with/without prefix-suffix and decimals variants. The settled, fully-formatted value is the surface's
/// accessible name so Narrator announces the meaningful number rather than the intermediate frames, and the host
/// can drive typography (font size/weight/family/colour — the web inherited font + <c>className</c>) through the
/// control's font properties, which are forwarded to the inner text. The <c>view.opened</c> diagnostic is emitted
/// exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class AnimatedNumber : ContentControl, IDisposable
{
    private const int FrameIntervalMs = 16; // ~60fps, matching the atomic TsAnimatedNumber cadence.

    private readonly AnimatedNumberViewModel _viewModel;
    private readonly AnimatedNumberDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(FrameIntervalMs) };

    private readonly TextBlock _text = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private AnimatedNumberModel _tween = new(0, 0, 0, reduceMotion: true);
    private DateTimeOffset _started;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the readout at <c>0</c> with the web prop defaults (<c>duration = 1</c>, <c>decimals = 0</c>, no
    /// prefix/suffix) and the system reduce-motion preference (the parameterless host/designer entry point).
    /// </summary>
    public AnimatedNumber()
        : this(new AnimatedNumberViewModel(0, new SystemMotionPreferenceSource()), diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the readout over the web props and the system reduce-motion preference.
    /// </summary>
    /// <param name="value">The initial target value (web <c>value</c>).</param>
    /// <param name="decimals">The fraction-digit count (web <c>decimals</c>).</param>
    /// <param name="prefix">The leading text (web <c>prefix</c>), or null for none.</param>
    /// <param name="suffix">The trailing text (web <c>suffix</c>), or null for none.</param>
    /// <param name="durationSeconds">The tween duration in seconds (web <c>duration</c>); null uses the default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnimatedNumber(
        double value,
        int decimals = AnimatedNumberRegistration.DefaultDecimals,
        string? prefix = null,
        string? suffix = null,
        double? durationSeconds = null,
        AnimatedNumberDiagnostics? diagnostics = null)
        : this(
            new AnimatedNumberViewModel(
                value,
                decimals,
                prefix,
                suffix,
                durationSeconds ?? AnimatedNumberRegistration.DefaultDurationSeconds,
                new SystemMotionPreferenceSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the readout over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnimatedNumber(AnimatedNumberViewModel viewModel, AnimatedNumberDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new AnimatedNumberDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Foreground = DisplayTokens.TextPrimary;

        // web tabular-nums: tabular figures keep digit columns from jittering as the count-up runs.
        Typography.SetNumeralAlignment(_text, FontNumeralAlignment.Tabular);

        // Forward the host's typography to the inner text (the web inherited font + className surface).
        ForwardToText(TextBlock.FontFamilyProperty, nameof(FontFamily));
        ForwardToText(TextBlock.FontSizeProperty, nameof(FontSize));
        ForwardToText(TextBlock.FontStyleProperty, nameof(FontStyle));
        ForwardToText(TextBlock.FontWeightProperty, nameof(FontWeight));
        ForwardToText(TextBlock.ForegroundProperty, nameof(Foreground));

        Content = _text;

        AutomationProperties.SetAutomationId(this, AnimatedNumberRegistration.RootAutomationId);

        _timer.Tick += OnTick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        RenderInitialFrame();
    }

    /// <summary>The canonical surface slug (<c>AnimatedNumber</c>).</summary>
    public static string Slug => AnimatedNumberRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AnimatedNumberViewModel ViewModel => _viewModel;

    /// <summary>
    /// The target value (web <c>value</c> prop). Assigning a new value restarts the count-up from
    /// <see cref="AnimatedNumberRegistration.StartValue"/>.
    /// </summary>
    public double Value
    {
        get => _viewModel.Value;
        set => _viewModel.SetValue(value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _timer.Stop();
        _timer.Tick -= OnTick;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new NumberAutomationPeer(this);

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

        StartTween();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Reproject always raises Projection when anything changes, so a single key restarts the tween once.
        if (e.PropertyName == nameof(AnimatedNumberViewModel.Projection))
        {
            Marshal(StartTween);
        }
    }

    private void RenderInitialFrame()
    {
        AnimatedNumberProjection projection = _viewModel.Projection;
        RenderFrame(projection.Animate ? AnimatedNumberRegistration.StartValue : projection.Value);
    }

    private void StartTween()
    {
        if (_disposed)
        {
            return;
        }

        _timer.Stop();
        AnimatedNumberProjection projection = _viewModel.Projection;

        if (!projection.Animate)
        {
            // Reduced motion / non-positive duration: snap straight to the final value.
            RenderFrame(projection.Value);
            return;
        }

        if (!IsLoaded)
        {
            // The timer only runs meaningfully once the element is live; OnLoaded re-applies.
            RenderFrame(AnimatedNumberRegistration.StartValue);
            return;
        }

        _tween = new AnimatedNumberModel(AnimatedNumberRegistration.StartValue, projection.Value, projection.DurationSeconds, reduceMotion: false);
        _started = DateTimeOffset.Now;
        RenderFrame(AnimatedNumberRegistration.StartValue);
        _timer.Start();
    }

    private void OnTick(object? sender, object e)
    {
        double elapsed = (DateTimeOffset.Now - _started).TotalSeconds;
        RenderFrame(_tween.ValueAt(elapsed));
        if (_tween.IsComplete(elapsed))
        {
            RenderFrame(_tween.Target);
            _timer.Stop();
        }
    }

    private void RenderFrame(double frameValue)
    {
        AnimatedNumberProjection projection = _viewModel.Projection;
        _text.Text = projection.Format(frameValue);

        // Narrator reads the settled target value, not the intermediate count-up frames.
        AutomationProperties.SetName(this, projection.FormattedTarget);
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

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag once
    /// through <see cref="MotionPreference"/> (the read-once policy the peer motion-aware surfaces use; the
    /// runtime-change subscription is intentionally a no-op to avoid the platform-gated UISettings change event).
    /// Lives with the view so the WinUI-free state-holder layer stays portable to the headless test host.
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return NoOpSubscription.Instance;
        }

        private sealed class NoOpSubscription : IDisposable
        {
            public static NoOpSubscription Instance { get; } = new();

            private NoOpSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }

    private sealed class NumberAutomationPeer : FrameworkElementAutomationPeer
    {
        public NumberAutomationPeer(AnimatedNumber owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AnimatedNumber)Owner).ViewModel.FormattedTarget
                : name;
        }
    }
}
