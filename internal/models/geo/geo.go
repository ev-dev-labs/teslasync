package geo

import "time"

// Address represents a reverse-geocoded location.
type Address struct {
	ID          int64     `json:"id" db:"id"`
	DisplayName string    `json:"display_name" db:"display_name"`
	Latitude    float64   `json:"latitude" db:"latitude"`
	Longitude   float64   `json:"longitude" db:"longitude"`
	Name        *string   `json:"name,omitempty" db:"name"`
	HouseNumber *string   `json:"house_number,omitempty" db:"house_number"`
	Road        *string   `json:"road,omitempty" db:"road"`
	City        *string   `json:"city,omitempty" db:"city"`
	County      *string   `json:"county,omitempty" db:"county"`
	State       *string   `json:"state,omitempty" db:"state"`
	Country     *string   `json:"country,omitempty" db:"country"`
	PostCode    *string   `json:"postcode,omitempty" db:"postcode"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// VisitedLocation represents an aggregated visited place.
type VisitedLocation struct {
	ID             int64      `json:"id" db:"id"`
	VehicleID      int64      `json:"vehicle_id" db:"vehicle_id"`
	AddressID      *int64     `json:"address_id,omitempty" db:"address_id"`
	AddressName    string     `json:"address_name" db:"address_name"`
	VisitCount     int        `json:"visit_count" db:"visit_count"`
	TotalDurationS float64    `json:"total_duration_s" db:"total_duration_s"`
	LastVisited    *time.Time `json:"last_visited,omitempty" db:"last_visited"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}
