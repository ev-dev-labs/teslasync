package charging

// SessionFacts keeps retained vehicle evidence and billing evidence separate.
type SessionFacts struct {
	Charger          ChargerEvidence
	IsHome           bool
	DefaultRatePerWh float64
	InvoiceID        int64
	InvoiceCost      *float64
	InvoiceCurrency  *string
	InvoiceEnergyWh  *float64
	InvoiceSite      string
}
