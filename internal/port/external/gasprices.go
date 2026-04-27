package external

import "context"

// EnergyPrice represents a price per unit of energy.
type EnergyPrice struct {
	PricePerKWh    float64 `json:"pricePerKwh"`
	PricePerGallon float64 `json:"pricePerGallon"`
	Currency       string  `json:"currency"`
	Region         string  `json:"region"`
}

// GasPriceProvider defines the interface for energy price data.
type GasPriceProvider interface {
	GetCurrentPrice(ctx context.Context, region string) (*EnergyPrice, error)
}
