package smartreadiness

import "time"

const MaxServiceCaseEvidence = 20

type ServiceCaseKind string

const (
	ServiceCaseWarning   ServiceCaseKind = "warning"
	ServiceCaseCondition ServiceCaseKind = "condition"
	ServiceCaseFirmware  ServiceCaseKind = "firmware"
	ServiceCaseWork      ServiceCaseKind = "recorded_work"
)

type ServiceCaseEvidence struct {
	ID         int64           `json:"id"`
	Kind       ServiceCaseKind `json:"kind"`
	ObservedAt time.Time       `json:"observed_at"`
	Detail     string          `json:"detail"`
}

type ServiceCase struct {
	ID       int64                 `json:"id"`
	Version  int64                 `json:"version"`
	Title    string                `json:"title"`
	OpenedAt time.Time             `json:"opened_at"`
	Evidence []ServiceCaseEvidence `json:"evidence"`
}

type ServiceCaseSelection struct {
	ID            int64 `json:"id"`
	IncludeDetail bool  `json:"include_detail"`
	IncludeTime   bool  `json:"include_time"`
}

type ServiceCasePreviewItem struct {
	Kind       ServiceCaseKind `json:"kind"`
	Detail     *string         `json:"detail,omitempty"`
	ObservedAt *time.Time      `json:"observed_at,omitempty"`
}

type ServiceCasePreview struct {
	Format     string                   `json:"format"`
	Provenance string                   `json:"provenance"`
	Evidence   []ServiceCasePreviewItem `json:"evidence"`
}
