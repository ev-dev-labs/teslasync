using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 AI-feature visibility gate — a parity port of the web <c>withAiFeature</c> higher-order
/// component (web/src/components/ai/withAiFeature.tsx, ADR-015 "AI-Off Contract"). It wraps an arbitrary inner
/// surface and renders it only when the gated AI feature is enabled end-to-end (web <c>useAiEnabled(feature)</c>,
/// here the shared <see cref="IAiFeatureGate"/> via <see cref="AiEnabledEvaluator"/>): when the gate is open the
/// inner content is shown inside this transparent marker host, which carries the root marker automation id
/// (<c>ai-feature-&lt;id&gt;-root</c> — the native analogue of the web wrapper's <c>data-testid</c> /
/// <c>data-ai-feature</c>); when the gate is closed the surface collapses, drops the marker and hosts nothing —
/// the native analogue of the HOC returning <see langword="null"/>, so no AI surface leaks while AI is off
/// (the off-mode invariant). An unknown feature id throws at construction, exactly like the web HOC throwing at
/// the wrapping call. The surface adds no chrome of its own — the inner content carries every visual and
/// accessible semantic, exactly like the web bare <c>&lt;div&gt;</c>. Because the gate is a synchronous settings
/// read (not a network fetch) the surface has no loading / empty / error / stale / offline states — only the
/// enabled and disabled branches the web source has. All gate state flows through the shared
/// <see cref="WithAiFeatureViewModel"/>; the view never reads the gate directly. It emits the
/// <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class WithAiFeature : ContentControl, IDisposable
{
    private readonly WithAiFeatureViewModel _viewModel;
    private readonly WithAiFeatureDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private UIElement? _inner;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the gate over the AI feature seam, the wrapped feature id and the inner surface it guards.
    /// </summary>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c> source); off collapses the surface.</param>
    /// <param name="featureId">The wrapped AI feature id (web <c>feature</c>).</param>
    /// <param name="inner">The inner surface to gate (web <c>Inner</c>); may be set later via <see cref="Inner"/>.</param>
    /// <param name="innerName">The inner component name for the wrapper name (web <c>Inner.displayName</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <exception cref="ArgumentNullException">The gate is null.</exception>
    /// <exception cref="ArgumentException">The feature id is blank or not in the canonical registry.</exception>
    public WithAiFeature(
        IAiFeatureGate gate,
        string featureId,
        UIElement? inner = null,
        string? innerName = null,
        WithAiFeatureDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(gate);

        _viewModel = new WithAiFeatureViewModel(gate, featureId, innerName);
        _diagnostics = diagnostics ?? new WithAiFeatureDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _inner = inner;

        // Transparent structural wrapper: the web HOC renders a bare <div> with no role, so the inner content
        // carries every visual + accessible semantic and this host stays out of the tab order and stretches to
        // fill its slot.
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>withAiFeature</c>).</summary>
    public static string Slug => WithAiFeatureRegistration.Slug;

    /// <summary>The backing gate state holder (exposed for hosting / diagnostics / tests).</summary>
    public WithAiFeatureViewModel ViewModel => _viewModel;

    /// <summary>The wrapped AI feature id (web <c>feature</c>).</summary>
    public string FeatureId => _viewModel.FeatureId;

    /// <summary>
    /// The inner surface this gate guards (web <c>Inner</c>). Reassigning re-renders, so a host can supply the
    /// content after construction; the inner content is only attached while the gate is open.
    /// </summary>
    public UIElement? Inner
    {
        get => _inner;
        set
        {
            if (ReferenceEquals(_inner, value))
            {
                return;
            }

            _inner = value;
            Render();
        }
    }

    /// <summary>
    /// Compose the gate over an inner surface — the native analogue of the web HOC call
    /// <c>withAiFeature(feature, Inner)</c>. Throws for an unknown feature id at this call, exactly like the web
    /// HOC throwing at the wrapping call.
    /// </summary>
    /// <param name="gate">The AI feature gate.</param>
    /// <param name="featureId">The wrapped AI feature id.</param>
    /// <param name="inner">The inner surface to gate.</param>
    /// <param name="innerName">The inner component name for the wrapper name.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A composed gate surface.</returns>
    public static WithAiFeature Wrap(
        IAiFeatureGate gate,
        string featureId,
        UIElement inner,
        string? innerName = null,
        WithAiFeatureDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(inner);
        return new WithAiFeature(gate, featureId, inner, innerName, diagnostics);
    }

    /// <summary>
    /// Re-evaluate the gate and re-render — call when the AI settings snapshot changes (the web hook re-running
    /// on a settings change). Marshalled to the UI thread.
    /// </summary>
    public void Refresh() => _viewModel.Refresh();

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
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new WithAiFeatureAutomationPeer(this);

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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

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

    private void Render()
    {
        // web HOC: `if (!enabled) return null`. A closed gate collapses the host, drops the marker and hosts
        // nothing, so no AI surface leaks while AI is off (the off-mode invariant).
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            Content = null;
            AutomationProperties.SetAutomationId(this, string.Empty);
            return;
        }

        // web HOC: render <div data-ai-feature data-testid><Inner/></div>. The host IS the marker wrapper; the
        // inner surface carries all semantics.
        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, _viewModel.RootAutomationId);
        if (!ReferenceEquals(Content, _inner))
        {
            Content = _inner;
        }
    }

    /// <summary>
    /// A transparent group peer: the web wrapper is a bare <c>&lt;div&gt;</c> with no role, so the host reports
    /// a nameless group and lets the inner surface carry the accessible semantics.
    /// </summary>
    private sealed class WithAiFeatureAutomationPeer : FrameworkElementAutomationPeer
    {
        public WithAiFeatureAutomationPeer(WithAiFeature owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
