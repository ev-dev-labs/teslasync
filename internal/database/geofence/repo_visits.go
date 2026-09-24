package geofence

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// VisitedPlaceCandidate is an unpersisted cluster of completed drive endpoints.
// Charge evidence is counted only from completed sessions with valid start GPS.
type VisitedPlaceCandidate struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	Latitude      float64    `json:"latitude"`
	Longitude     float64    `json:"longitude"`
	VisitCount    int        `json:"visit_count"`
	ChargeCount   int        `json:"charge_count"`
	LastVisited   time.Time  `json:"last_visited"`
	FirstChargeAt *time.Time `json:"first_charge_at"`
}

type visitPoint struct {
	id       int64
	lat, lon float64
	name     string
	at       time.Time
}

type chargePoint struct {
	lat, lon float64
	at       time.Time
}

// ListVisitedCandidates detects places on demand without creating geofences
// or depending on reverse-geocoding. Completed drives are the visit evidence;
// completed charging sessions independently establish charging evidence.
func (r *GeofenceRepo) ListVisitedCandidates(ctx context.Context) ([]VisitedPlaceCandidate, error) {
	const visitsSQL = `SELECT id, end_lat, end_lng, COALESCE(end_place, ''), ended_at
FROM drives WHERE ended_at IS NOT NULL AND end_lat BETWEEN -90 AND 90
AND end_lng BETWEEN -180 AND 180 AND NOT (end_lat = 0 AND end_lng = 0)
ORDER BY ended_at DESC LIMIT 5000`
	rows, err := r.pool.Query(ctx, visitsSQL)
	if err != nil {
		return nil, fmt.Errorf("geofence visit evidence: %w", err)
	}
	var visits []visitPoint
	for rows.Next() {
		var p visitPoint
		if err := rows.Scan(&p.id, &p.lat, &p.lon, &p.name, &p.at); err != nil {
			rows.Close()
			return nil, fmt.Errorf("geofence visit evidence scan: %w", err)
		}
		visits = append(visits, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("geofence visit evidence rows: %w", err)
	}

	const chargesSQL = `SELECT start_lat, start_lng, started_at FROM charging_sessions
WHERE ended_at IS NOT NULL AND start_lat BETWEEN -90 AND 90
AND start_lng BETWEEN -180 AND 180 AND NOT (start_lat = 0 AND start_lng = 0)
ORDER BY started_at DESC LIMIT 5000`
	rows, err = r.pool.Query(ctx, chargesSQL)
	if err != nil {
		return nil, fmt.Errorf("geofence charge evidence: %w", err)
	}
	var charges []chargePoint
	for rows.Next() {
		var p chargePoint
		if err := rows.Scan(&p.lat, &p.lon, &p.at); err != nil {
			rows.Close()
			return nil, fmt.Errorf("geofence charge evidence scan: %w", err)
		}
		charges = append(charges, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("geofence charge evidence rows: %w", err)
	}
	existing, err := r.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("geofence visited candidates existing places: %w", err)
	}
	type cluster struct {
		VisitedPlaceCandidate
	}
	var clusters []cluster
	for _, point := range visits {
		matched := false
		for _, place := range existing {
			lat, lon := place.Centroid()
			if place.Radius() > 0 && haversineMeters(point.lat, point.lon, lat, lon) <= place.Radius() {
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		for i := range clusters {
			c := &clusters[i]
			if haversineMeters(point.lat, point.lon, c.Latitude, c.Longitude) <= DiscoveryRadiusMeters {
				c.VisitCount++
				if strings.EqualFold(strings.TrimSpace(point.name), c.Name) && point.id < c.ID {
					c.ID = point.id
				}
				if c.Name == "" && strings.TrimSpace(point.name) != "" {
					c.Name = strings.TrimSpace(point.name)
					c.ID = point.id
				}
				matched = true
				break
			}
		}
		if !matched {
			clusters = append(clusters, cluster{VisitedPlaceCandidate: VisitedPlaceCandidate{
				ID: point.id, Name: strings.TrimSpace(point.name), Latitude: point.lat,
				Longitude: point.lon, VisitCount: 1, LastVisited: point.at,
			}})
		}
	}
	result := make([]VisitedPlaceCandidate, 0, len(clusters))
	for _, c := range clusters {
		for _, charge := range charges {
			if haversineMeters(c.Latitude, c.Longitude, charge.lat, charge.lon) <= DiscoveryRadiusMeters {
				c.ChargeCount++
				if c.FirstChargeAt == nil || charge.at.Before(*c.FirstChargeAt) {
					at := charge.at
					c.FirstChargeAt = &at
				}
			}
		}
		result = append(result, c.VisitedPlaceCandidate)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ChargeCount != result[j].ChargeCount {
			return result[i].ChargeCount > result[j].ChargeCount
		}
		return result[i].LastVisited.After(result[j].LastVisited)
	})
	if len(result) > 100 {
		result = result[:100]
	}
	return result, nil
}
