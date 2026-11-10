package dto

type WidgetDesignPreference struct {
	PackID string `json:"pack_id"`
	Scope  string `json:"scope"`
}

type SetWidgetDesignPreference struct {
	PackID string `json:"pack_id"`
}
