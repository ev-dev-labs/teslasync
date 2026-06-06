namespace TeslaSync.App.Core.Maps;

/// <summary>A point fed to the cluster engine (port of the web <c>ClusterPoint</c>).</summary>
/// <param name="Id">Stable identifier (used for reconciliation only).</param>
/// <param name="Lat">Latitude.</param>
/// <param name="Lng">Longitude.</param>
/// <param name="Color">Optional per-point marker color (hex/rgba string).</param>
/// <param name="Label">Optional accessible label.</param>
public readonly record struct ClusterPoint(
    string Id,
    double Lat,
    double Lng,
    string? Color = null,
    string? Label = null);

/// <summary>A resolved cluster bubble (or singleton) ready to render.</summary>
/// <param name="ScreenX">Screen X of the bubble centre.</param>
/// <param name="ScreenY">Screen Y of the bubble centre.</param>
/// <param name="Count">Number of child points.</param>
/// <param name="Children">The points that fell into this cluster.</param>
public readonly record struct ClusterBubble(double ScreenX, double ScreenY, int Count, IReadOnlyList<ClusterPoint> Children)
{
    /// <summary>True when this bubble represents a single un-clustered point.</summary>
    public bool IsSingle => Count == 1;
}

/// <summary>
/// Grid-bucket marker clustering backing <c>TsMarkerCluster</c> (functional port of
/// <c>leaflet.markercluster</c>'s screen-space grouping). Points within
/// <c>maxClusterRadius</c> pixels of each other at the current zoom collapse into a
/// single bubble. Pure + headless so grouping and the density palette are tested.
/// </summary>
public static class MarkerClusterEngine
{
    /// <summary>Hard cap on rendered markers to avoid a perf cliff (matches web 5000).</summary>
    public const int MaxMarkers = 5000;

    /// <summary>
    /// Group points into cluster bubbles for a viewport centred on
    /// <paramref name="center"/> at <paramref name="zoom"/>. Clustering is disabled
    /// at or above <paramref name="disableClusteringAtZoom"/> (every point becomes a
    /// singleton). Off-screen points (beyond a one-bubble margin) are skipped. Uses
    /// greedy screen-distance clustering (a point joins the first existing cluster
    /// whose running centroid is within <paramref name="maxClusterRadius"/> pixels),
    /// which — unlike a fixed grid — is robust to cell-boundary splits.
    /// </summary>
    public static IReadOnlyList<ClusterBubble> Cluster(
        IReadOnlyList<ClusterPoint> points,
        GeoPoint center,
        int zoom,
        double viewWidth,
        double viewHeight,
        double maxClusterRadius = 50,
        int disableClusteringAtZoom = 18)
    {
        ArgumentNullException.ThrowIfNull(points);
        if (viewWidth <= 0 || viewHeight <= 0)
        {
            return [];
        }

        bool clusteringOff = zoom >= disableClusteringAtZoom;
        double radius = Math.Max(1, maxClusterRadius);
        double radiusSq = radius * radius;
        double margin = radius * 2;

        var working = new List<MutableCluster>();

        int considered = 0;
        foreach (var p in points)
        {
            if (considered >= MaxMarkers)
            {
                break;
            }

            considered++;

            if (!double.IsFinite(p.Lat) || !double.IsFinite(p.Lng))
            {
                continue;
            }

            var screen = TileMath.ToScreen(new GeoPoint(p.Lat, p.Lng), center, zoom, viewWidth, viewHeight);
            if (screen.X < -margin || screen.X > viewWidth + margin ||
                screen.Y < -margin || screen.Y > viewHeight + margin)
            {
                continue;
            }

            MutableCluster? target = null;
            if (!clusteringOff)
            {
                double best = double.MaxValue;
                foreach (var cluster in working)
                {
                    double dx = cluster.CentroidX - screen.X;
                    double dy = cluster.CentroidY - screen.Y;
                    double distSq = (dx * dx) + (dy * dy);
                    if (distSq <= radiusSq && distSq < best)
                    {
                        best = distSq;
                        target = cluster;
                    }
                }
            }

            if (target is null)
            {
                target = new MutableCluster();
                working.Add(target);
            }

            target.Add(p, screen.X, screen.Y);
        }

        var bubbles = new List<ClusterBubble>(working.Count);
        foreach (var cluster in working)
        {
            bubbles.Add(new ClusterBubble(cluster.CentroidX, cluster.CentroidY, cluster.Children.Count, cluster.Children));
        }

        return bubbles;
    }

    private sealed class MutableCluster
    {
        private double _sumX;
        private double _sumY;

        public List<ClusterPoint> Children { get; } = [];

        public double CentroidX => Children.Count == 0 ? 0 : _sumX / Children.Count;

        public double CentroidY => Children.Count == 0 ? 0 : _sumY / Children.Count;

        public void Add(ClusterPoint point, double screenX, double screenY)
        {
            Children.Add(point);
            _sumX += screenX;
            _sumY += screenY;
        }
    }

    /// <summary>
    /// Density-based bubble color (hex), mirroring the web default cluster palette:
    /// ≥100 rose, ≥25 amber, ≥10 purple, otherwise cyan.
    /// </summary>
    public static string DensityColor(int count) => count switch
    {
        >= 100 => "#f43f5e",
        >= 25 => "#fbbf24",
        >= 10 => "#a855f7",
        _ => "#22d3ee",
    };
}
