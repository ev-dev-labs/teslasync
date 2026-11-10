package dto

type WidgetDesignPreference struct {
	PackID  string `json:"pack_id"`
	Scope   string `json:"scope"`
	AppWide bool   `json:"app_wide"`
}

type SetWidgetDesignPreference struct {
	PackID  string `json:"pack_id"`
	AppWide *bool  `json:"app_wide,omitempty"`
}
