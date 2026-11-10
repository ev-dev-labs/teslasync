import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DataStateSource } from "@/api/dataState";
import type { DrivingDynamicsData } from "@/types/driving";
import DrivingDynamicsWidget from "./DrivingDynamicsWidget";
import { PackBoundary } from "./designPacks/PackBoundary";
import { PACK_APPEARANCES } from "./designPacks/types";

vi.hoisted(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (media: string): MediaQueryList => ({
      matches: false,
      media,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    });
  }
});

const { dynamicsQuery, distributionQuery, vehiclesQuery, dynamicsRefetch, distributionRefetch } = vi.hoisted(() => ({
  dynamicsQuery: vi.fn(),
  distributionQuery: vi.fn(),
  vehiclesQuery: vi.fn(),
  dynamicsRefetch: vi.fn(),
  distributionRefetch: vi.fn(),
}));

vi.mock("@/api/hooks/useDriving", () => ({
  useDrivingDynamics: (vehicleId?: string) => dynamicsQuery(vehicleId),
  useAccelerationDistribution: (vehicleId?: string) => distributionQuery(vehicleId),
}));
vi.mock("@/api/hooks/useVehicles", () => ({
  useVehicles: () => vehiclesQuery(),
}));

const packs = Object.entries(PACK_APPEARANCES);
const dynamics: DrivingDynamicsData = {
  maxAccelerationG: 0.31,
  maxBrakingG: 0.28,
  maxCorneringG: 0.22,
  avgAccelerationG: 0.18,
  avgBrakingG: 0.16,
  smoothnessScore: 88,
};
const samples = { values: [-0.05, 0.05, -0.1, 0.1, 1.2, 2, NaN, Infinity] };

function makeQuery<T>(data: T, overrides: Omit<DataStateSource<T>, "data"> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function widget(packId: unknown, cols = 3) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DrivingDynamicsWidget vehicleId={7} size={{ cols, rows: 2 }} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function waitForPack(container: HTMLElement, appearance: string) {
  await waitFor(() => {
    expect(container.querySelector(`[data-widget-family="bars"][data-widget-appearance="${appearance}"]`)).not.toBeNull();
  });
}

function histogramBins() {
  const table = screen.getByRole("table", { name: "G-force distribution — data table" });
  return within(table).getAllByRole("row").slice(1).map(row =>
    within(row).getAllByRole("cell").map(cell => cell.textContent),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesQuery.mockReturnValue({ data: [{ id: 42 }] });
  dynamicsQuery.mockReturnValue(makeQuery(dynamics, { refetch: dynamicsRefetch }));
  distributionQuery.mockReturnValue(makeQuery(samples, { refetch: distributionRefetch }));
});
afterEach(cleanup);

describe("DrivingDynamicsWidget production design packs", () => {
  it.each(packs)("%s preserves real peak values, every histogram bin, and refresh actions (%s)", async (packId, appearance) => {
    const { container } = render(widget(packId));
    await waitForPack(container, appearance);

    expect(screen.getByRole("heading", { name: "Driving dynamics", level: 3 })).toBeVisible();
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.getByText("Style")).toBeVisible();
    expect(screen.getByText("Estimated peaks · all completed drives")).toBeVisible();
    expect(screen.getByText("Observed acceleration magnitudes · last 30 days")).toBeVisible();
    expect(screen.getByText("Peak comparison scale: 0–1.00 g")).toBeVisible();
    for (const [label, value] of [["Accel", "0.31"], ["Brake", "0.28"], ["Lateral", "0.22"]]) {
      expect(screen.getByRole("progressbar", { name: label })).toHaveAttribute("aria-valuenow", value);
      expect(screen.getByText(`${value} g`)).toBeVisible();
      expect(screen.getByText(value)).toBeVisible();
    }
    const bins = histogramBins();
    expect(bins).toHaveLength(12);
    expect(bins.filter(([, count]) => Number(count) > 0)).toEqual([
      ["0.0-0.1", "2"], ["0.1-0.2", "2"], ["1.1+", "2"],
    ]);
    expect(bins.reduce((sum, [, count]) => sum + Number(count), 0)).toBe(6);
    expect(container.querySelector('[data-widget-family="bars"] .lucide-gauge')).not.toBeNull();
    expect(dynamicsQuery).toHaveBeenCalledWith("7");
    expect(distributionQuery).toHaveBeenCalledWith("7");

    fireEvent.click(screen.getByRole("button", { name: /refresh data/i }));
    expect(dynamicsRefetch).toHaveBeenCalledTimes(1);
    expect(distributionRefetch).toHaveBeenCalledTimes(1);
  });

  it.each(packs)("%s distinguishes invalid or missing readings from measured zero (%s)", async (packId, appearance) => {
    const partial: Partial<DrivingDynamicsData> = {
      maxAccelerationG: NaN, maxBrakingG: 0, maxCorneringG: Infinity, smoothnessScore: NaN,
    };
    dynamicsQuery.mockReturnValue(makeQuery(partial));
    distributionQuery.mockReturnValue(makeQuery({ values: [] }));
    const { container } = render(widget(packId));
    await waitForPack(container, appearance);

    for (const name of ["Accel", "Lateral"]) {
      const reading = screen.getByRole("progressbar", { name });
      expect(reading).not.toHaveAttribute("aria-valuenow");
      expect(reading).toHaveAttribute("aria-valuetext", "No reading");
      expect(reading.querySelector("[data-metric-fill]")).toBeNull();
    }
    expect(screen.getByRole("progressbar", { name: "Brake" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0.00 g")).toBeVisible();
    expect(screen.getByText("No acceleration samples yet")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/^(Smooth|Normal|Sporty|Aggressive)$/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it.each(packs)("%s switches presentations without losing the original Classic body or selected vehicle (%s)", async (packId, appearance) => {
    const view = render(widget("classic"));
    const before = histogramBins();
    view.rerender(widget(packId));
    await waitForPack(view.container, appearance);
    expect(histogramBins()).toEqual(before);
    view.rerender(widget("classic"));

    expect(view.container.querySelector("[data-widget-appearance]")).toBeNull();
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.getByText("0.31")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated peaks · all completed drives")).not.toBeInTheDocument();
    expect(histogramBins()).toEqual(before);
    expect(dynamicsQuery.mock.calls.every(([id]) => id === "7")).toBe(true);
    expect(distributionQuery.mock.calls.every(([id]) => id === "7")).toBe(true);
  });

  it.each(packs)("%s retains compact sizing and the original non-wide query enablement (%s)", async (packId, appearance) => {
    const { container } = render(widget(packId, 1));
    await waitForPack(container, appearance);
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.queryByText("Accel")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(distributionQuery).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByRole("button", { name: /refresh data/i }));
    expect(dynamicsRefetch).toHaveBeenCalledTimes(1);
    expect(distributionRefetch).not.toHaveBeenCalled();
  });

  it.each(packs)("%s keeps retained peaks and observations visible through refresh failures and retries only the affected distribution (%s)", async (packId, appearance) => {
    dynamicsQuery.mockReturnValue(makeQuery(dynamics, {
      refetch: dynamicsRefetch, error: new Error("dynamics refresh failed"), isError: true,
    }));
    distributionQuery.mockReturnValue(makeQuery(samples, {
      refetch: distributionRefetch, error: new Error("distribution refresh failed"), isError: true,
    }));
    const { container } = render(widget(packId));
    await waitForPack(container, appearance);
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(histogramBins()).toHaveLength(12);
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId("stale-refresh-warning")).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(distributionRefetch).toHaveBeenCalledTimes(1);
    expect(dynamicsRefetch).not.toHaveBeenCalled();
  });

  it.each(packs)("%s retains healthy dynamics while an independent histogram fails, including its retry (%s)", async (packId, appearance) => {
    distributionQuery.mockReturnValue(makeQuery(undefined, {
      refetch: distributionRefetch, error: new Error("distribution unavailable"), isError: true,
    }));
    const { container } = render(widget(packId));
    await waitForPack(container, appearance);
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Accel" })).toHaveAttribute("aria-valuenow", "0.31");
    expect(screen.getByText("Acceleration distribution unavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(distributionRefetch).toHaveBeenCalledTimes(1);
    expect(dynamicsRefetch).not.toHaveBeenCalled();
  });

  it.each(packs)("%s keeps the existing refresh control disabled while either wide source is fetching (%s)", async (packId, appearance) => {
    distributionQuery.mockReturnValue(makeQuery(samples, {
      refetch: distributionRefetch, isFetching: true,
    }));
    const { container } = render(widget(packId));
    await waitForPack(container, appearance);
    const refresh = screen.getByRole("button", { name: /refresh data/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(distributionRefetch).not.toHaveBeenCalled();
    expect(dynamicsRefetch).not.toHaveBeenCalled();
  });

  it.each(packs)("%s preserves signed values and expands the common peak scale rather than clipping the readout (%s)", async (packId, appearance) => {
    dynamicsQuery.mockReturnValue(makeQuery({
      ...dynamics, maxAccelerationG: 1.5, maxBrakingG: -0.28, maxCorneringG: 0,
    }));
    const { container } = render(widget(packId, 2));
    await waitForPack(container, appearance);
    const acceleration = screen.getByRole("progressbar", { name: "Accel" });
    expect(acceleration).toHaveAttribute("aria-valuenow", "1.5");
    expect(acceleration).toHaveAttribute("aria-valuemax", "1.5");
    expect(screen.getByText("Peak comparison scale: 0–1.50 g")).toBeVisible();
    expect(screen.getByRole("group", { name: "Brake" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("-0.28 g")).toBeVisible();
    expect(container.querySelector('[data-max-per-row="3"]')).toHaveTextContent("-0.28");
    expect(screen.getByRole("progressbar", { name: "Lateral" })).toHaveAttribute("aria-valuenow", "0");
  });

  it.each(packs)("%s preserves loading, empty, initial-error recovery and source trust (%s)", async (packId, appearance) => {
    dynamicsQuery.mockReturnValue(makeQuery(undefined, {
      refetch: dynamicsRefetch, isLoading: true, isFetching: true, dataUpdatedAt: 0,
    }));
    const view = render(widget(packId, 2));
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Smooth")).not.toBeInTheDocument();

    dynamicsQuery.mockReturnValue(makeQuery(undefined, { refetch: dynamicsRefetch }));
    view.rerender(widget(packId, 2));
    await waitForPack(view.container, appearance);
    expect(screen.getByText("No dynamics data")).toBeVisible();
    expect(screen.queryByText(/^(Smooth|Normal|Sporty|Aggressive)$/)).not.toBeInTheDocument();
    for (const name of ["Accel", "Brake", "Lateral"]) {
      expect(screen.getByRole("progressbar", { name })).not.toHaveAttribute("aria-valuenow");
    }

    dynamicsQuery.mockReturnValue(makeQuery(undefined, {
      refetch: dynamicsRefetch, error: new Error("dynamics unavailable"), isError: true,
    }));
    view.rerender(widget(packId, 2));
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(screen.getByText("Can't reach server")).toBeVisible();
    expect(screen.queryByText("No dynamics data")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(dynamicsRefetch).toHaveBeenCalledTimes(1);
    expect(distributionRefetch).not.toHaveBeenCalled();

    dynamicsQuery.mockReturnValue(makeQuery(dynamics, { refetch: dynamicsRefetch }));
    view.rerender(widget(packId, 2));
    await waitForPack(view.container, appearance);
    expect(view.container.querySelector('[data-data-state="ok"]')).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.getByText("0.31 g")).toBeVisible();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it("recovers an unknown pack ID with the unmodified Classic empty state", () => {
    dynamicsQuery.mockReturnValue(makeQuery(undefined));
    const { container } = render(widget("retired", 2));
    expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(container.querySelector("[data-widget-appearance]")).toBeNull();
    expect(screen.getByText("No dynamics data")).toBeVisible();
    expect(screen.queryByText("Style")).not.toBeInTheDocument();
  });
});
