using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 formatter-preferences bridge — a parity port of the web <c>FormatterPrefsBridge</c>
/// component (web/src/components/FormatterPrefsBridge.tsx). The web component is a side-effect-only mount that
/// returns <see langword="null"/>: placed near the React root, it keeps the module-level formatter globals in
/// sync with the persisted settings regardless of which page is mounted. This surface is the native analogue —
/// a host placed once in the shell that owns a <see cref="FormatterPrefsBridgeViewModel"/> (which subscribes to
/// the settings seam and pushes locale + precision into the formatter globals) and renders nothing of its own:
/// it is collapsed, hosts no content, stays out of the tab order, and is excluded from the accessibility tree,
/// so it carries no visual or accessible semantics — the native equivalent of the web component rendering
/// <see langword="null"/>. Because the web source is side-effect-only it has no titles / labels / i18n keys and
/// no loading / empty / error / stale / offline chrome; this surface reproduces exactly that (its behaviour lives
/// entirely in the view-model). It emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/> and disposes the view-model on <see cref="FrameworkElement.Unloaded"/>.
/// </summary>
public sealed partial class FormatterPrefsBridge : ContentControl, IDisposable
{
    private readonly FormatterPrefsBridgeViewModel _viewModel;
    private readonly FormatterPrefsDiagnostics _diagnostics;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the bridge over the settings seam, the formatter globals and an optional broadcast seam.</summary>
    /// <param name="source">The settings state-holder seam (web <c>useSettings</c> query); supplies the resolved snapshot.</param>
    /// <param name="store">The formatter globals to keep in sync; defaults to <see cref="FormatterPrefsStore.Shared"/>.</param>
    /// <param name="signal">The optional settings-changed broadcast seam (web <c>subscribe(TOPICS.SETTINGS_CHANGED)</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <exception cref="ArgumentNullException">The source is null.</exception>
    public FormatterPrefsBridge(
        IFormatterPrefsSource source,
        IFormatterPrefsStore? store = null,
        ISettingsChangeSignal? signal = null,
        FormatterPrefsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);

        _viewModel = new FormatterPrefsBridgeViewModel(source, store, signal);
        _diagnostics = diagnostics ?? new FormatterPrefsDiagnostics();

        // Side-effect-only mount: renders nothing (web returns null). Collapsed, no content, out of the tab order
        // and out of the accessibility tree, so it carries no visual or accessible semantics of its own.
        IsTabStop = false;
        IsHitTestVisible = false;
        Visibility = Visibility.Collapsed;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>FormatterPrefsBridge</c>).</summary>
    public static string Slug => FormatterPrefsBridgeRegistration.Slug;

    /// <summary>The backing bridge state holder (exposed for hosting / diagnostics / tests).</summary>
    public FormatterPrefsBridgeViewModel ViewModel => _viewModel;

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
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// A peer that keeps the bridge out of the accessibility tree — the web component renders nothing, so the
    /// host reports no control / content element and exposes no accessible name. There are no interactive
    /// elements to label.
    /// </summary>
    /// <returns>The non-participating automation peer.</returns>
    protected override AutomationPeer OnCreateAutomationPeer() => new FormatterPrefsBridgeAutomationPeer(this);

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

    private sealed class FormatterPrefsBridgeAutomationPeer : FrameworkElementAutomationPeer
    {
        public FormatterPrefsBridgeAutomationPeer(FormatterPrefsBridge owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override bool IsControlElementCore() => false;

        protected override bool IsContentElementCore() => false;
    }
}
