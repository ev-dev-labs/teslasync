package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	DataRepairScansTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "data_repair_scans_total",
		Help:      "Total data-repair integrity scans by trigger and terminal status.",
	}, []string{"trigger", "status"})

	DataRepairScanDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "data_repair_scan_duration_seconds",
		Help:      "Data-repair integrity scan duration in seconds by trigger.",
		Buckets:   []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 90},
	}, []string{"trigger"})

	DataRepairFindingsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "data_repair_findings_total",
		Help:      "Total durable data-repair findings materialized by kind and rule.",
	}, []string{"kind", "rule"})
)
