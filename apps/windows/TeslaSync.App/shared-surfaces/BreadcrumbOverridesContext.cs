using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace TeslaSync.App.SharedSurfaces.BreadcrumbOverridesContextSurface;

/// <summary>
/// The native WinUI 3 context bridge for per-route breadcrumb label overrides — a parity port of
/// <c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c> in its role as the prop-drilling-free channel
/// between a page deep in the tree and the single global breadcrumb in the layout chrome. The web module exports a
/// React context whose value is the override registry; a page registers its dynamic labels with
/// <c>useSetBreadcrumbOverrides({...})</c> and the layout reads the merged map with <c>useBreadcrumbOverrides()</c>,
/// neither receiving it as a prop. WinUI has no React context, so the nearest-ancestor lookup is reproduced with an
/// attached <see cref="RegistryProperty"/> set by the provider and the tree-walking reader <see cref="GetNearest"/> —
/// the exact semantics of <c>useContext</c> (nearest provider, else <c>null</c>, which the read/write holders treat as
/// the empty / no-op fallback). Because the registry is a synchronous in-process React-state mirror (the web source
/// performs no network I/O — it is pure component state), this surface has no loading / error / stale / offline chrome;
/// its only observable states are <em>empty</em> (no page has registered a label, so the merged map is empty) and
/// <em>active</em> (one or more overrides registered), exactly the states the web source exposes.
/// </summary>
public static class BreadcrumbOverridesContext
{
    /// <summary>
    /// The attached registry the provider sets on itself (the React context value). Read the nearest ancestor's value
    /// with <see cref="GetNearest"/> rather than this raw accessor, which returns only an element's own local value.
    /// </summary>
    public static readonly DependencyProperty RegistryProperty = DependencyProperty.RegisterAttached(
        "Registry",
        typeof(IBreadcrumbOverridesRegistry),
        typeof(BreadcrumbOverridesContext),
        new PropertyMetadata(null));

    /// <summary>Set the provided override registry on <paramref name="element"/> (the provider sets this on itself).</summary>
    /// <param name="element">The element that provides the context (the provider).</param>
    /// <param name="value">The override registry to provide.</param>
    public static void SetRegistry(DependencyObject element, IBreadcrumbOverridesRegistry? value)
    {
        ArgumentNullException.ThrowIfNull(element);
        element.SetValue(RegistryProperty, value);
    }

    /// <summary>Read an element's own provided registry (its local attached value); <c>null</c> when it provides none.</summary>
    /// <param name="element">The element to read the local provided value from.</param>
    public static IBreadcrumbOverridesRegistry? GetRegistry(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);
        return (IBreadcrumbOverridesRegistry?)element.GetValue(RegistryProperty);
    }

    /// <summary>
    /// Read the override registry from the nearest ancestor provider (web <c>useContext(BreadcrumbOverridesContext)</c>).
    /// Walks up the visual tree, falling back to the logical parent, and returns the first provided registry — or
    /// <c>null</c> when no provider is in scope (the web default context value), which the read/write holders treat as
    /// the empty / no-op fallback.
    /// </summary>
    /// <param name="element">The element reading the context (e.g. a page registering its labels).</param>
    public static IBreadcrumbOverridesRegistry? GetNearest(DependencyObject element)
    {
        ArgumentNullException.ThrowIfNull(element);

        DependencyObject? current = element;
        while (current is not null)
        {
            if (GetRegistry(current) is { } registry)
            {
                return registry;
            }

            current = GetParentObject(current);
        }

        return null;
    }

    private static DependencyObject? GetParentObject(DependencyObject element)
    {
        DependencyObject? parent = VisualTreeHelper.GetParent(element);
        if (parent is not null)
        {
            return parent;
        }

        // Before the element is in the live visual tree, fall back to the logical parent so the lookup still resolves
        // the provider (e.g. during template realisation or in a detached subtree).
        return element is FrameworkElement frameworkElement ? frameworkElement.Parent : null;
    }
}

/// <summary>
/// The native WinUI 3 breadcrumb-overrides provider — the parity port of the web <c>BreadcrumbOverridesProvider</c>
/// (<c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c>). It wraps the app's routed content and provides
/// the process-wide <see cref="IBreadcrumbOverridesRegistry"/> via <see cref="BreadcrumbOverridesContext"/> so a page
/// reads it with <see cref="BreadcrumbOverridesContext.GetNearest"/> (then drives a
/// <see cref="BreadcrumbOverridesPublisher"/>) and the layout breadcrumb reads it through a
/// <see cref="BreadcrumbOverridesState"/>. Like the web provider it is a transparent wrapper: it renders its
/// <see cref="ContentControl.Content"/> unchanged and contributes no accessible node of its own
/// (<see cref="AccessibilityView.Raw"/>), so Narrator traverses straight to the hosted content. It emits the
/// <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class BreadcrumbOverridesProvider : ContentControl
{
    private readonly BreadcrumbOverridesDiagnostics _diagnostics;
    private bool _opened;

    /// <summary>Creates the provider over the process-wide registry (the single web layout-root provider).</summary>
    public BreadcrumbOverridesProvider()
        : this(BreadcrumbOverridesRegistry.Shared, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the provider over an explicit registry seam (tests / headless hosts) and an optional PII-safe
    /// diagnostics collector.
    /// </summary>
    /// <param name="registry">The registry seam the provided context binds to.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics collector.</param>
    public BreadcrumbOverridesProvider(IBreadcrumbOverridesRegistry registry, BreadcrumbOverridesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(registry);

        Registry = registry;
        _diagnostics = diagnostics ?? new BreadcrumbOverridesDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web provider renders a bare children fragment and adds no node of its
        // own, so hide the wrapper from Narrator and let the hosted content carry the semantics.
        AutomationProperties.SetAccessibilityView(
            this,
            BreadcrumbOverridesAccessibility.ProviderContributesAccessibleNode ? AccessibilityView.Content : AccessibilityView.Raw);

        BreadcrumbOverridesContext.SetRegistry(this, registry);

        Loaded += OnLoaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>BreadcrumbOverridesContext</c>).</summary>
    public static string Slug => BreadcrumbOverridesRegistration.Slug;

    /// <summary>The override registry this provider exposes to descendants (web context value).</summary>
    public IBreadcrumbOverridesRegistry Registry { get; }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;

        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web provider mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }
}
