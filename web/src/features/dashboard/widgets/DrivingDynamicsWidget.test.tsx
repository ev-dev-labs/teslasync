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

const { dynamicsQuery, vehiclesQuery } = vi.hoisted(() => ({
  dynamicsQuery: vi.fn(),
  vehiclesQuery: vi.fn(),
}));

vi.mock("@/api/hooks/useDriving", () => ({
  useDrivingDynamics: (vehicleId?: string) => dynamicsQuery(vehicleId),
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
});
