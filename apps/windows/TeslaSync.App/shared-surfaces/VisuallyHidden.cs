using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.A11y;

namespace TeslaSync.App.SharedSurfaces.VisuallyHiddenSurface;

/// <summary>
/// The native WinUI 3 VisuallyHidden announcer surface — a parity port of
/// web/src/components/a11y/VisuallyHidden.tsx in its cross-feature role as the application's global
/// screen-reader announcement region (the web component mounted as two <c>liveRegion</c> instances by
/// <c>AnnouncerRegion</c> in <c>Layout.tsx</c>, fed by <c>useAnnouncer()</c>). It hosts a polite and an
/// assertive visually-hidden live region — each the shared atomic <see cref="TsAnnouncerRegion"/> (1×1,
/// clipped, zero-opacity, so it is invisible to sighted users yet present in the UI-Automation tree) — and
/// binds them to the <see cref="IAnnouncer"/> data source through an <see cref="VisuallyHiddenAnnouncerViewModel"/>,
/// so any feature that calls <see cref="IAnnouncer.Announce"/> has its message voiced by Narrator on the
/// matching-urgency region without moving focus. The two regions are siblings so each region's
/// <c>aria-live</c> value stays static (the web split, because some screen readers ignore live-value
/// changes after the first announcement). The surface contributes no accessible node of its own
/// (<see cref="AccessibilityView.Raw"/>, like the web fragment) and emits the <c>view.opened</c> diagnostic
/// exactly once on <see cref="FrameworkElement.Loaded"/>. Because the announcer is a synchronous in-process
/// channel (web <c>useAnnouncer</c> is a module-level pub/sub, not a network read) the surface has no
/// loading / error / stale / offline chrome — only the empty (no announcement yet) and announced states per
/// priority, mirroring the web source's two <c>useState('')</c> regions. The polymorphic and focusable
/// skip-link branches of the web primitive are carried by the atomic <see cref="TsVisuallyHidden"/>
/// component and are out of scope for this surface.
/// </summary>
public sealed partial class VisuallyHidden : ContentControl, IDisposable
{
    private readonly VisuallyHiddenAnnouncerViewModel _viewModel;
    private readonly VisuallyHiddenDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsAnnouncerRegion _polite = new();
    private readonly TsAnnouncerRegion _assertive = new() { Assertive = true };
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the process-wide announcer (the web global <c>useAnnouncer</c>).</summary>
    public VisuallyHidden()
        : this(Announcer.Shared, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over an explicit announcer seam (tests / headless hosts) and an optional PII-safe
    /// diagnostics collector.
    /// </summary>
    public VisuallyHidden(IAnnouncer announcer, VisuallyHiddenDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(announcer);

        _viewModel = new VisuallyHiddenAnnouncerViewModel(announcer);
        _diagnostics = diagnostics ?? new VisuallyHiddenDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        var host = new Grid();
        host.Children.Add(_polite);
        host.Children.Add(_assertive);
        Content = host;

        IsTabStop = false;

        // Transparent structural wrapper: the web fragment contributes no accessible node of its own, so the
        // surface hides itself from Narrator and lets the two hosted regions carry the live semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>VisuallyHidden</c>).</summary>
    public static string Slug => VisuallyHiddenRegistration.Slug;

    /// <summary>The backing live-region state holder (exposed for hosting / diagnostics / tests).</summary>
    public VisuallyHiddenAnnouncerViewModel ViewModel => _viewModel;

    /// <summary>Detach from the announcer and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirrors the web AnnouncerRegion mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // Reflect any announcement that arrived before the regions had automation peers (the web initial
        // render of the controlled value), so the current state is voiced once the surface is live.
        if (!string.IsNullOrEmpty(_viewModel.PoliteMessage))
        {
            _polite.Announce(_viewModel.PoliteMessage);
        }

        if (!string.IsNullOrEmpty(_viewModel.AssertiveMessage))
        {
            _assertive.Announce(_viewModel.AssertiveMessage);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Marshal(() =>
        {
            switch (e.PropertyName)
            {
                case nameof(VisuallyHiddenAnnouncerViewModel.PoliteMessage):
                    _polite.Announce(_viewModel.PoliteMessage);
                    break;

                case nameof(VisuallyHiddenAnnouncerViewModel.AssertiveMessage):
                    _assertive.Announce(_viewModel.AssertiveMessage);
                    break;
            }
        });
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
}
