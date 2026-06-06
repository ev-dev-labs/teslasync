using System.Collections.Generic;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Core.Charts;
using Windows.Foundation;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Bridges pure <see cref="ChartGeometry"/> output into WinUI <see cref="Shape"/>
/// primitives (point collections and circular-arc paths). Keeps the rendering
/// controls free of repetitive geometry-to-shape plumbing.
/// </summary>
internal static class ChartShapes
{
    /// <summary>Converts pixel points into a WinUI <see cref="PointCollection"/>.</summary>
    public static PointCollection ToPointCollection(IReadOnlyList<PointD> points)
    {
        var collection = new PointCollection();
        foreach (var p in points)
        {
            collection.Add(new Point(p.X, p.Y));
        }

        return collection;
    }

    /// <summary>Builds an open polyline from pixel points.</summary>
    public static Polyline Polyline(IReadOnlyList<PointD> points, Brush stroke, double thickness)
    {
        return new Polyline
        {
            Points = ToPointCollection(points),
            Stroke = stroke,
            StrokeThickness = thickness,
            StrokeLineJoin = PenLineJoin.Round,
        };
    }

    /// <summary>Builds a filled polygon from pixel points.</summary>
    public static Polygon Polygon(IReadOnlyList<PointD> points, Brush fill)
    {
        return new Polygon
        {
            Points = ToPointCollection(points),
            Fill = fill,
        };
    }

    /// <summary>
    /// Builds a stroked circular-arc <see cref="Path"/> from a computed
    /// <see cref="ArcGeometry"/> (the gauge / ring value track).
    /// </summary>
    public static Microsoft.UI.Xaml.Shapes.Path ArcPath(ArcGeometry arc, Brush stroke, double thickness)
    {
        var figure = new PathFigure { StartPoint = new Point(arc.Start.X, arc.Start.Y) };
        figure.Segments.Add(new ArcSegment
        {
            Point = new Point(arc.End.X, arc.End.Y),
            Size = new Size(arc.Radius, arc.Radius),
            IsLargeArc = arc.IsLargeArc,
            SweepDirection = arc.SweepClockwise ? SweepDirection.Clockwise : SweepDirection.Counterclockwise,
        });

        var geometry = new PathGeometry();
        geometry.Figures.Add(figure);

        return new Microsoft.UI.Xaml.Shapes.Path
        {
            Data = geometry,
            Stroke = stroke,
            StrokeThickness = thickness,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
        };
    }
}
