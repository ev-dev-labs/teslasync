// Package stats provides the shared numeric primitives used by ML trainers.
package stats

import (
	"math"
	"sort"
)

// Mean returns the arithmetic mean of the finite values.
// Empty input and input containing no finite values return 0.
func Mean(values []float64) float64 {
	finite := finiteValues(values)
	n := len(finite)
	if n == 0 {
		return 0
	}

	var sum float64
	var compensation float64
	for _, value := range finite {
		y := value - compensation
		t := sum + y
		compensation = (t - sum) - y
		sum = t
	}
	if !math.IsInf(sum, 0) && !math.IsNaN(sum) {
		mean := sum / float64(n)
		if !math.IsInf(mean, 0) && !math.IsNaN(mean) {
			return mean
		}
	}

	maxAbs := 0.0
	for _, value := range finite {
		absolute := math.Abs(value)
		if absolute > maxAbs {
			maxAbs = absolute
		}
	}
	if maxAbs == 0 || math.IsInf(maxAbs, 0) || math.IsNaN(maxAbs) {
		return 0
	}

	var scaledSum float64
	var scaledCompensation float64
	for _, value := range finite {
		scaled := value / maxAbs
		y := scaled - scaledCompensation
		t := scaledSum + y
		scaledCompensation = (t - scaledSum) - y
		scaledSum = t
	}
	return (scaledSum / float64(n)) * maxAbs
}

// PopulationMean is an explicit name for Mean.
func PopulationMean(values []float64) float64 {
	return Mean(values)
}

// MeanStddev returns the population mean and population standard deviation.
// Empty input and input containing no finite values return (0, 0).
func MeanStddev(values []float64) (float64, float64) {
	finite := finiteValues(values)
	n := len(finite)
	if n == 0 {
		return 0, 0
	}

	mean := Mean(finite)
	if math.IsNaN(mean) || math.IsInf(mean, 0) {
		return 0, 0
	}

	maxDeviation := 0.0
	deviations := make([]float64, n)
	for i, value := range finite {
		deviation := value - mean
		if math.IsInf(deviation, 0) || math.IsNaN(deviation) {
			return 0, 0
		}
		deviation = math.Abs(deviation)
		deviations[i] = deviation
		if deviation > maxDeviation {
			maxDeviation = deviation
		}
	}
	if maxDeviation == 0 {
		return mean, 0
	}

	var normalizedSquares float64
	var compensation float64
	for _, deviation := range deviations {
		scaled := deviation / maxDeviation
		square := scaled * scaled
		y := square - compensation
		t := normalizedSquares + y
		compensation = (t - normalizedSquares) - y
		normalizedSquares = t
	}
	stddev := maxDeviation * math.Sqrt(normalizedSquares/float64(n))
	if math.IsNaN(stddev) {
		return mean, 0
	}
	return mean, stddev
}

// MeanStdDev is the spelling-compatible alias for MeanStddev.
func MeanStdDev(values []float64) (float64, float64) {
	return MeanStddev(values)
}

// MeanAndStddev is an explicit alias for MeanStddev.
func MeanAndStddev(values []float64) (float64, float64) {
	return MeanStddev(values)
}

// MeanAndStdDev is a spelling-compatible alias for MeanStddev.
func MeanAndStdDev(values []float64) (float64, float64) {
	return MeanStddev(values)
}

// Stddev is the population standard deviation of finite values.
func Stddev(values []float64) float64 {
	_, stddev := MeanStddev(values)
	return stddev
}

// StdDev is an exported spelling-compatible alias for Stddev.
func StdDev(values []float64) float64 {
	return Stddev(values)
}

// PopulationMeanStddev is an explicit spelling-compatible alias.
func PopulationMeanStddev(values []float64) (float64, float64) {
	return MeanStddev(values)
}

// PopulationStddev is an explicit name for the population standard deviation.
func PopulationStddev(values []float64) float64 {
	return Stddev(values)
}

// PopulationStdDev is a spelling-compatible alias for PopulationStddev.
func PopulationStdDev(values []float64) float64 {
	return Stddev(values)
}

// Percentile returns the type-7 percentile for q in [0,1].
// The input is copied and sorted; the caller's slice is not mutated.
// Non-finite values are ignored. Empty and q-outside-bounds behavior
// follows the existing ML trainers: empty returns 0; q <= 0 and q >= 1
// return the finite minimum and maximum respectively.
func Percentile(values []float64, q float64) float64 {
	finite := finiteValues(values)
	n := len(finite)
	if n == 0 {
		return 0
	}
	sort.Float64s(finite)
	if n == 1 {
		return finite[0]
	}
	if math.IsNaN(q) {
		return 0
	}
	if q <= 0 {
		return finite[0]
	}
	if math.IsInf(q, 1) || q >= 1 {
		return finite[n-1]
	}
	if math.IsInf(q, -1) {
		return finite[0]
	}

	position := q * float64(n-1)
	low := int(math.Floor(position))
	high := int(math.Ceil(position))
	if low == high {
		return finite[low]
	}
	fraction := position - float64(low)
	return finite[low]*(1-fraction) + finite[high]*fraction
}

// PercentileType7 is an explicit alias for Percentile.
func PercentileType7(values []float64, q float64) float64 {
	return Percentile(values, q)
}

// Percentile7 is an additional short-form alias for Percentile.
func Percentile7(values []float64, q float64) float64 {
	return Percentile(values, q)
}

func finiteValues(values []float64) []float64 {
	finite := make([]float64, 0, len(values))
	for _, value := range values {
		if !math.IsNaN(value) && !math.IsInf(value, 0) {
			finite = append(finite, value)
		}
	}
	return finite
}
