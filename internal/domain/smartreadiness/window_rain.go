package smartreadiness

import "time"

type RainForecastHour struct {
	EndsAt          time.Time
	PrecipChancePct float64
	RainAndShowersM float64
}

type RainForecast struct {
	ReceivedAt time.Time
	Hours      []RainForecastHour
}

type OpenWindowObservation struct {
	Position   WindowPosition `json:"position"`
	ObservedAt time.Time      `json:"observed_at"`
}

type WindowPosition string

const (
	WindowFrontDriver    WindowPosition = "front_driver"
	WindowFrontPassenger WindowPosition = "front_passenger"
	WindowRearDriver     WindowPosition = "rear_driver"
	WindowRearPassenger  WindowPosition = "rear_passenger"
)

type WindowRainRisk struct {
	Window      OpenWindowObservation `json:"window"`
	ForecastAt  time.Time             `json:"forecast_at"`
	RiskStartAt time.Time             `json:"risk_start_at"`
	RiskEndAt   time.Time             `json:"risk_end_at"`
	ExpiresAt   time.Time             `json:"expires_at"`
}

type WeatherGrid struct {
	LatitudeHundredths  int
	LongitudeHundredths int
}

type WindowRainPlan struct {
	ID             int64            `json:"id"`
	CreatedAt      time.Time        `json:"created_at"`
	WatchUntil     time.Time        `json:"watch_until"`
	Paused         bool             `json:"paused"`
	Reason         WindowRainReason `json:"reason"`
	Risk           *WindowRainRisk  `json:"risk,omitempty"`
	DeviceReady    bool             `json:"device_ready"`
	DeviceID       int64            `json:"-"`
	Grid           WeatherGrid      `json:"-"`
	ParkObservedAt time.Time        `json:"-"`
}

type WindowRainSetup struct {
	DurationS        int    `json:"duration_s"`
	DeviceID         int64  `json:"device_id"`
	PushTitle        string `json:"push_title"`
	PushBody         string `json:"push_body"`
	OutdoorConfirmed bool   `json:"outdoor_confirmed"`
	ForecastConsent  bool   `json:"forecast_consent"`
	FreeTermsApply   bool   `json:"free_terms_apply"`
}

type WindowRainReason string

const (
	WindowRainMonitoring   WindowRainReason = "monitoring"
	WindowRainUnknownState WindowRainReason = "unknown_state"
	WindowRainMoved        WindowRainReason = "park_changed"
	WindowRainNoOpenWindow WindowRainReason = "no_fresh_open_window"
	WindowRainNoForecast   WindowRainReason = "weather_unavailable"
	WindowRainDry          WindowRainReason = "no_rain_risk"
	WindowRainAtRisk       WindowRainReason = "window_rain_risk"
	WindowRainExpired      WindowRainReason = "expired"
)
