import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DrivingDynamicsData } from "@/types/driving";
import DrivingDynamicsWidget from "./DrivingDynamicsWidget";

vi.hoisted(() => {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia !== "function"
  ) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { dynamicsQuery, vehiclesQuery, distributionQuery } = vi.hoisted(() => ({
  dynamicsQuery: vi.fn(),
  vehiclesQuery: vi.fn(),
  distributionQuery: vi.fn(),
}));

vi.mock("@/api/hooks/useDriving", () => ({
  useDrivingDynamics: (vehicleId?: string) => dynamicsQuery(vehicleId),
  useAccelerationDistribution: (vehicleId?: string) => distributionQuery(vehicleId),
}));

vi.mock("@/components/charts", async () => ({
  ...await vi.importActual<typeof import("@/components/charts")>("@/components/charts"),
  EmbeddedChart: ({ data }: { data: readonly Record<string, unknown>[] }) =>
    <pre data-testid="dynamics-histogram">{JSON.stringify(data)}</pre>,
}));

vi.mock("@/api/hooks/useVehicles", () => ({
  useVehicles: () => vehiclesQuery(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === "string" ? defaultValue : key,
  }),
}));

function makeDynamics(
  overrides: Partial<DrivingDynamicsData> = {},
): DrivingDynamicsData {
  return {
    maxAccelerationG: 0.31,
    maxBrakingG: 0.28,
    maxCorneringG: 0.22,
    avgAccelerationG: 0.18,
    avgBrakingG: 0.16,
    smoothnessScore: 88,
    ...overrides,
  };
}

function makeQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(cols = 2) {
  return render(
    <MemoryRouter>
      <DrivingDynamicsWidget size={{ cols, rows: 2 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesQuery.mockReturnValue({ data: [{ id: 42 }] });
  dynamicsQuery.mockReturnValue(makeQuery());
  distributionQuery.mockReturnValue(makeQuery({ data: { values: [0.05, 0.1, 0.15, 0.2, 0.3] } }));
});

afterEach(cleanup);

describe("DrivingDynamicsWidget redesign", () => {
  it("renders one Style headline and measured peak G-force stats", () => {
    dynamicsQuery.mockReturnValue(makeQuery({ data: makeDynamics() }));

    renderWidget(2);

    expect(
      screen.getByRole("heading", { name: "Driving dynamics", level: 3 }),
    ).toBeVisible();
    expect(screen.getByText("Style")).toBeInTheDocument();
    expect(screen.getByText("Smooth")).toBeInTheDocument();
    expect(screen.getByText("Accel")).toBeInTheDocument();
    expect(screen.getByText("Brake")).toBeInTheDocument();
    expect(screen.getByText("Lateral")).toBeInTheDocument();
    expect(screen.getByText("0.31")).toBeInTheDocument();
    expect(screen.getByText("0.28")).toBeInTheDocument();
    expect(screen.getByText("0.22")).toBeInTheDocument();
    expect(screen.queryByText("Top 30%")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hard-brake/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/G-force distribution/i)).not.toBeInTheDocument();
    expect(distributionQuery).toHaveBeenCalledWith(undefined);
  });

  it("keeps compact layout content-sized and does not show three stats", () => {
    dynamicsQuery.mockReturnValue(
      makeQuery({ data: makeDynamics({ smoothnessScore: 45 }) }),
    );

    renderWidget(1);

    expect(screen.getByText("Sporty")).toBeInTheDocument();
    expect(screen.queryByText("Accel")).not.toBeInTheDocument();
  });

  it("does not fabricate a style from missing measurements", () => {
    dynamicsQuery.mockReturnValue(
      makeQuery({ data: {} as DrivingDynamicsData }),
    );

    renderWidget(2);

    expect(screen.getByText("Style")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("renders loading, empty, and initial error states honestly", () => {
    dynamicsQuery.mockReturnValue(makeQuery({ isLoading: true }));
    const { unmount, container } = renderWidget(2);
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    unmount();

    dynamicsQuery.mockReturnValue(makeQuery({ data: undefined }));
    const empty = renderWidget(2);
    expect(screen.getByText("No dynamics data")).toBeInTheDocument();
    empty.unmount();

    dynamicsQuery.mockReturnValue(
      makeQuery({
        error: new Error("boom"),
        isError: true,
        data: undefined,
      }),
    );
    renderWidget(2);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });

  it("retains cached values during a refresh error", () => {
    dynamicsQuery.mockReturnValue(
      makeQuery({
        data: makeDynamics(),
        error: new Error("transient"),
        isError: true,
      }),
    );
    const { container } = renderWidget(2);

    expect(screen.getByText("Smooth")).toBeInTheDocument();
    expect(
      container.querySelector(".bg-\\[var\\(--semantic-danger\\)\\]"),
    ).toBeTruthy();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it("resolves the explicit vehicle and refreshes only when idle", () => {
    const refetch = vi.fn();
    dynamicsQuery.mockReturnValue(
      makeQuery({
        data: makeDynamics(),
        refetch,
        isFetching: false,
      }),
    );

    render(
      <MemoryRouter>
        <DrivingDynamicsWidget size={{ cols: 2, rows: 2 }} vehicleId={7} />
      </MemoryRouter>,
    );
    expect(dynamicsQuery).toHaveBeenCalledWith("7");
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    cleanup();
    dynamicsQuery.mockReturnValue(
      makeQuery({
        data: makeDynamics(),
        refetch,
        isFetching: true,
      }),
    );
    renderWidget(2);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("bins real signed acceleration magnitudes and preserves every finite observation", () => {
    dynamicsQuery.mockReturnValue(makeQuery({ data: makeDynamics() }));
    distributionQuery.mockReturnValue(makeQuery({
      data: { values: [-0.05, 0.05, -0.1, 0.1, 1.2, 2, null, NaN, Infinity] },
    }));
    renderWidget(3);
    const bins = JSON.parse(screen.getByTestId("dynamics-histogram").textContent ?? "[]") as { range: string; count: number }[];
    expect(bins).toHaveLength(12);
    expect(bins.filter(bin => bin.count > 0)).toEqual([
      { range: "0.0-0.1", count: 2 },
      { range: "0.1-0.2", count: 2 },
      { range: "1.1+", count: 2 },
    ]);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(6);
    expect(distributionQuery).toHaveBeenCalledWith("42");
    expect(screen.getByText("Smooth")).toBeVisible();
  });

  it("keeps measured dynamics visible when the independent distribution is empty or fails", () => {
    dynamicsQuery.mockReturnValue(makeQuery({ data: makeDynamics() }));
    distributionQuery.mockReturnValue(makeQuery({ data: { values: [] } }));
    const empty = renderWidget(3);
    expect(screen.getByText("No acceleration samples yet")).toBeInTheDocument();
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.queryByTestId("dynamics-histogram")).not.toBeInTheDocument();
    empty.unmount();
    const retry = vi.fn();
    distributionQuery.mockReturnValue(makeQuery({ error: new Error("distribution down"), isError: true, refetch: retry }));
    renderWidget(3);
    expect(screen.getByText("Smooth")).toBeVisible();
    expect(screen.getByText("Acceleration distribution unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("retains histogram observations during a background distribution failure", () => {
    dynamicsQuery.mockReturnValue(makeQuery({ data: makeDynamics() }));
    distributionQuery.mockReturnValue(makeQuery({
      data: { values: [0.05] }, error: new Error("refresh failed"), isError: true,
    }));
    renderWidget(3);
    expect(screen.getByTestId("dynamics-histogram")).toHaveTextContent('"count":1');
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    expect(screen.getByText("Smooth")).toBeVisible();
  });

  it("refreshes both sources from the one wide-widget freshness control", () => {
    const retryDynamics = vi.fn();
    const retryDistribution = vi.fn();
    dynamicsQuery.mockReturnValue(makeQuery({ data: makeDynamics(), refetch: retryDynamics }));
    distributionQuery.mockReturnValue(makeQuery({ data: { values: [0.1] }, refetch: retryDistribution }));
    renderWidget(3);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(retryDynamics).toHaveBeenCalledTimes(1);
    expect(retryDistribution).toHaveBeenCalledTimes(1);
  });
});
