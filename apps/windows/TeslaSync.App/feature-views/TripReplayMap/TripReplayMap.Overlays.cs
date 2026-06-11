using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Core.Maps;
using ShapeEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// A fixed-pixel-radius circle marker pinned to a geographic coordinate — the native analogue of the web Leaflet
/// <c>CircleMarker</c> the trip-replay map uses for the green start, red end, and cyan stationary-anchor dots (a
/// 6-px-radius coloured circle, not a metre-radius geofence). It repositions itself on the map's overlay canvas on
/// every projection change and carries its endpoint label as the Narrator name + tooltip so the route detail is
/// available to assistive technology. View-only (references <c>Microsoft.UI</c>); the WinUI-free projection that
/// decides which dots to draw lives in <see cref="TripReplayMapProjection"/>.
/// </summary>
internal sealed partial class TripReplayDotMarker : ContentControl, IMapOverlay
{
    private const double DiameterPx = 12; // web CircleMarker radius={6}

    private GeoPoint _location;

    /// <summary>Creates the marker over its fill brush, fill opacity and accessible name.</summary>
    /// <param name="fill">The dot fill brush (the web <c>fillColor</c>).</param>
    /// <param name="fillOpacity">The dot fill opacity (the web <c>fillOpacity</c>).</param>
    /// <param name="accessibleName">The Narrator name describing this endpoint.</param>
    public TripReplayDotMarker(Brush fill, double fillOpacity, string accessibleName)
    {
        ArgumentNullException.ThrowIfNull(fill);

        IsTabStop = false;
        Width = DiameterPx;
        Height = DiameterPx;

        var dot = new ShapeEllipse
        {
            Width = DiameterPx,
            Height = DiameterPx,
            Fill = fill,
            Opacity = fillOpacity,
            Stroke = DisplayTokens.Surface,
            StrokeThickness = 2,
        };
        Content = dot;

        if (!string.IsNullOrEmpty(accessibleName))
        {
            AutomationProperties.SetName(this, accessibleName);
            ToolTipService.SetToolTip(this, accessibleName);
        }
    }

    /// <summary>The marker's geographic location.</summary>
    public GeoPoint Location
    {
        get => _location;
        set => _location = value;
    }

    /// <summary>Reposition against the current projection so the dot stays centred on its coordinate.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(_location);
        Canvas.SetLeft(this, screen.X - (DiameterPx / 2));
        Canvas.SetTop(this, screen.Y - (DiameterPx / 2));
    }
}
