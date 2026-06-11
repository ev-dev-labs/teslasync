namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The colour-scheme seam the <c>TeslaCarViz</c> surface binds through (P1/S8 state-holder layer) — the native
/// analogue of the web <c>useTheme()</c> hook that the source's <c>useSvgPalette()</c> reads
/// (web/src/components/data-display/TeslaCarViz.tsx: <c>const { mode } = useTheme(); const isLight =
/// mode.colorScheme === 'light'</c>). The web component picks its body / glass / wheel / detail colours purely
/// from whether the active theme is light or dark and re-renders when the user switches themes; the WinUI view
/// has to source the effective element theme (<c>ActualTheme</c>) and react when it changes, so that
/// responsibility is expressed as this small seam. <see cref="IsLight"/> selects the light vs dark
/// <see cref="TeslaCarVizPalette"/>; <see cref="Changed"/> fires when the effective theme flips so the bound
/// <see cref="TeslaCarVizViewModel"/> re-projects. The production implementation (reading the view's
/// <c>ActualTheme</c>) lives with the WinUI view; <see cref="StaticTeslaCarVizThemeSource"/> stands in for
/// headless hosts, previews and unit tests so the palette and view-model can be exercised for both schemes
/// without a XAML runtime.
/// </summary>
public interface ITeslaCarVizThemeSource
{
    /// <summary>
    /// True when the active theme is light, so the surface uses the light <see cref="TeslaCarVizPalette"/>
    /// (web <c>mode.colorScheme === 'light'</c>); false uses the dark palette.
    /// </summary>
    bool IsLight { get; }

    /// <summary>
    /// Raised whenever the effective light/dark theme flips (web <c>useTheme</c> re-rendering its consumers);
    /// may be raised from a background thread.
    /// </summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ITeslaCarVizThemeSource"/> with an explicit, caller-set scheme — the headless / preview /
/// unit-test default. It lets the palette and view-model be exercised for both the light and dark branches
/// without a XAML theme host. Call <see cref="Set"/> to flip the scheme, raising <see cref="Changed"/> (the web
/// theme provider re-rendering as the user switches themes). Defaults to the dark scheme, matching the web app's
/// default <c>colorScheme</c>.
/// </summary>
public sealed class StaticTeslaCarVizThemeSource : ITeslaCarVizThemeSource
{
    private bool _isLight;

    /// <summary>Creates a source over an initial scheme (defaults to dark, the web app default).</summary>
    /// <param name="isLight">Whether the initial scheme is light.</param>
    public StaticTeslaCarVizThemeSource(bool isLight = false) => _isLight = isLight;

    /// <summary>A shared source reporting the dark scheme (the common test default).</summary>
    public static StaticTeslaCarVizThemeSource Dark { get; } = new(isLight: false);

    /// <summary>A shared source reporting the light scheme.</summary>
    public static StaticTeslaCarVizThemeSource Light { get; } = new(isLight: true);

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsLight => _isLight;

    /// <summary>Flip the scheme and raise <see cref="Changed"/> (the web theme provider re-rendering).</summary>
    /// <param name="isLight">Whether the new scheme is light.</param>
    public void Set(bool isLight)
    {
        if (_isLight == isLight)
        {
            return;
        }

        _isLight = isLight;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
