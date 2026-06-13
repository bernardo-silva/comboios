import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ApiError } from "./api";
import type { FeConfig } from "./fe-config";
import type { Journey } from "./journeys";
import type { Sale } from "./sale";
import type { SeatSearchProgress } from "./find-seats";

const createSaleMock = mock(async (..._args: unknown[]): Promise<Sale> => {
  throw new Error("createSale not configured for this test");
});
const cancelSaleMock = mock(async (..._args: unknown[]): Promise<void> => {});

mock.module("./sale", () => ({
  createSale: createSaleMock,
  cancelSale: cancelSaleMock,
}));

const { findAvailableSeats } = await import("./find-seats");

const noSeatsError = () => new ApiError(409, "WS:RES:116", "not enough seats available");

const feConfig: FeConfig = {
  travelApiKey: "travel-key",
  ticketingApiKey: "ticketing-key",
  xcck: "xcck",
  xccs: "xccs",
};

const station = (code: string) => ({ code, designation: `${code} Station` });

let nextSaleId = 1;
const makeSale = (overrides: Partial<Sale> = {}): Sale => ({
  saleID: nextSaleId++,
  reference: `REF-${nextSaleId}`,
  status: { code: "PENDING", designation: "Pending" },
  totalAmount: "10.00",
  travelData: { outwardTrip: [] },
  ...overrides,
});

const makeJourney = (
  stopCodes: string[],
  departureCode: string = stopCodes[0]!,
  arrivalCode: string = stopCodes[stopCodes.length - 1]!,
): Journey => ({
  departureTime: "08:00",
  arrivalTime: "10:00",
  duration: "2:00",
  services: "AP",
  transferCount: 0,
  travelSections: [
    {
      trainNumber: 123,
      serviceCode: { code: "AP", designation: "Alfa Pendular" },
      departureStation: station(departureCode),
      arrivalStation: station(arrivalCode),
      trainStops: stopCodes.map((code, i) => ({
        station: station(code),
        arrival: `0${8 + i}:00`,
        departure: `0${8 + i}:05`,
      })),
    },
  ],
});

// Replace setTimeout so the 1s delays between API calls don't slow down tests.
let originalSetTimeout: typeof setTimeout;

beforeAll(() => {
  originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    fn(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
});

afterAll(() => {
  globalThis.setTimeout = originalSetTimeout;
});

beforeEach(() => {
  createSaleMock.mockReset();
  cancelSaleMock.mockReset();
  cancelSaleMock.mockResolvedValue(undefined);
});

describe("findAvailableSeats", () => {
  test("throws if the journey has more than one travel section", async () => {
    const journey = makeJourney(["A", "B"]);
    journey.travelSections.push(journey.travelSections[0]!);

    await expect(findAvailableSeats(journey, "2026-07-01", feConfig)).rejects.toThrow(
      "Find seats only supports journeys with a single train (no transfers).",
    );

    expect(createSaleMock).not.toHaveBeenCalled();
  });

  test("returns the direct sale when seats are available end-to-end", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    const sale = makeSale();
    createSaleMock.mockResolvedValueOnce(sale);

    const progress: SeatSearchProgress[] = [];
    const result = await findAvailableSeats(journey, "2026-07-01", feConfig, (p) => progress.push(p));

    expect(result).toEqual({ type: "direct", sale });
    expect(createSaleMock).toHaveBeenCalledTimes(1);
    expect(createSaleMock).toHaveBeenCalledWith(
      [
        {
          trainNumber: 123,
          departureStationCode: "A",
          arrivalStationCode: "C",
          serviceCode: "AP",
          serviceDesignation: "Alfa Pendular",
        },
      ],
      "2026-07-01",
      2,
      1,
      feConfig,
    );
    expect(progress).toEqual([{ type: "found-seats", from: station("A"), to: station("C") }]);
    expect(cancelSaleMock).not.toHaveBeenCalled();
  });

  test("rethrows API errors that aren't 'no seats' errors", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    createSaleMock.mockRejectedValueOnce(new ApiError(500, "WS:GEN:001", "internal error"));

    await expect(findAvailableSeats(journey, "2026-07-01", feConfig)).rejects.toThrow("internal error");
    expect(createSaleMock).toHaveBeenCalledTimes(1);
  });

  test("rethrows non-API errors", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    createSaleMock.mockRejectedValueOnce(new Error("network down"));

    await expect(findAvailableSeats(journey, "2026-07-01", feConfig)).rejects.toThrow("network down");
  });

  test("returns not-found without further calls if departure/arrival aren't on the train's stop list", async () => {
    // Departure station "Z" is not part of the train's stops.
    const journey = makeJourney(["A", "B", "C"], "Z", "C");
    createSaleMock.mockRejectedValueOnce(noSeatsError());

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result).toEqual({ type: "not-found", reason: "no-intermediate-stops", uncancelledPendingSales: [] });
    expect(createSaleMock).toHaveBeenCalledTimes(1);
    expect(cancelSaleMock).not.toHaveBeenCalled();
  });

  test("returns not-found without further calls if there are no intermediate stops", async () => {
    const journey = makeJourney(["A", "C"]);
    createSaleMock.mockRejectedValueOnce(noSeatsError());

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result).toEqual({ type: "not-found", reason: "no-combination-found", uncancelledPendingSales: [] });
    expect(createSaleMock).toHaveBeenCalledTimes(1);
    expect(cancelSaleMock).not.toHaveBeenCalled();
  });

  test("falls back to a two-ticket split itinerary when the direct booking fails", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    const saleAB = makeSale();
    const saleBC = makeSale();

    createSaleMock
      .mockRejectedValueOnce(noSeatsError()) // direct A->C
      .mockResolvedValueOnce(saleAB) // A->B
      .mockResolvedValueOnce(saleBC); // B->C

    const progress: SeatSearchProgress[] = [];
    const result = await findAvailableSeats(journey, "2026-07-01", feConfig, (p) => progress.push(p));

    expect(result.type).toBe("split");
    if (result.type !== "split") throw new Error("expected a split result");

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      departureStation: station("A"),
      arrivalStation: station("B"),
      trainNumber: 123,
      sale: saleAB,
    });
    expect(result.segments[1]).toMatchObject({
      departureStation: station("B"),
      arrivalStation: station("C"),
      trainNumber: 123,
      sale: saleBC,
    });
    expect(result.uncancelledPendingSales).toEqual([]);
    expect(cancelSaleMock).not.toHaveBeenCalled();

    expect(progress).toEqual([
      { type: "no-seats", from: station("A"), to: station("C") },
      { type: "found-seats", from: station("A"), to: station("B") },
      { type: "found-seats", from: station("B"), to: station("C") },
    ]);
  });

  test("returns not-found and cancels stray pending sales when no split works", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    const saleAB = makeSale();

    createSaleMock
      .mockRejectedValueOnce(noSeatsError()) // direct A->C
      .mockResolvedValueOnce(saleAB) // A->B succeeds...
      .mockRejectedValueOnce(noSeatsError()); // ...but B->C never does

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result).toEqual({ type: "not-found", reason: "no-combination-found", uncancelledPendingSales: [] });
    expect(cancelSaleMock).toHaveBeenCalledTimes(1);
    expect(cancelSaleMock).toHaveBeenCalledWith(saleAB.saleID, feConfig);
  });

  test("reports pending sales that could not be cancelled", async () => {
    const journey = makeJourney(["A", "B", "C"]);
    const saleAB = makeSale();

    createSaleMock
      .mockRejectedValueOnce(noSeatsError()) // direct A->C
      .mockResolvedValueOnce(saleAB) // A->B succeeds...
      .mockRejectedValueOnce(noSeatsError()); // ...but B->C never does

    cancelSaleMock.mockRejectedValueOnce(new Error("cancel failed"));

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result).toEqual({
      type: "not-found",
      reason: "no-combination-found",
      uncancelledPendingSales: [saleAB],
    });
  });

  test("skips a failed first-segment candidate and finds a working split", async () => {
    const journey = makeJourney(["A", "B", "C", "D", "E"]);
    const saleAC = makeSale();
    const saleCE = makeSale();

    createSaleMock
      .mockRejectedValueOnce(noSeatsError()) // direct A->E
      .mockRejectedValueOnce(noSeatsError()) // A->D has no seats either...
      .mockResolvedValueOnce(saleAC) // ...but A->C succeeds...
      .mockResolvedValueOnce(saleCE); // ...and C->E succeeds, completing the split

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result.type).toBe("split");
    if (result.type !== "split") throw new Error("expected a split result");

    expect(result.segments.map((s) => [s.departureStation.code, s.arrivalStation.code])).toEqual([
      ["A", "C"],
      ["C", "E"],
    ]);
    expect(result.segments[0]!.sale).toEqual(saleAC);
    expect(result.segments[1]!.sale).toEqual(saleCE);

    expect(result.uncancelledPendingSales).toEqual([]);
    expect(cancelSaleMock).not.toHaveBeenCalled();
  });

  test("caches repeated edge checks instead of calling the API again", async () => {
    // Only 3 stops means findPath for tickets=3 and 4 re-checks the same
    // A->B edge that was already tried for tickets=2.
    const journey = makeJourney(["A", "B", "C"]);
    const saleAB = makeSale();

    createSaleMock
      .mockRejectedValueOnce(noSeatsError()) // direct A->C
      .mockResolvedValueOnce(saleAB) // A->B succeeds
      .mockRejectedValueOnce(noSeatsError()); // B->C fails

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result.type).toBe("not-found");
    // direct + A->B + B->C, with no repeats for the higher ticket counts.
    expect(createSaleMock).toHaveBeenCalledTimes(3);
  });

  test("never exceeds the API call cap, even with many intermediate stops", async () => {
    const stopCodes = ["A", ...Array.from({ length: 14 }, (_, i) => `S${i + 1}`), "Z"];
    const journey = makeJourney(stopCodes);

    createSaleMock.mockRejectedValue(noSeatsError());

    const result = await findAvailableSeats(journey, "2026-07-01", feConfig);

    expect(result.type).toBe("not-found");
    expect(createSaleMock.mock.calls.length).toBeLessThanOrEqual(20);
  });

  test("downsamples intermediate stops when there are more than the candidate limit", async () => {
    const stopCodes = ["A", ...Array.from({ length: 12 }, (_, i) => `S${i + 1}`), "Z"];
    const journey = makeJourney(stopCodes);

    createSaleMock.mockRejectedValue(noSeatsError());

    await findAvailableSeats(journey, "2026-07-01", feConfig);

    // With 12 intermediate stops downsampled to 10 candidates, S1 and S12
    // are dropped from consideration.
    const excludedCodes = new Set(["S1", "S12"]);
    const usedCodes = new Set<string>();
    for (const [leg] of createSaleMock.mock.calls) {
      const [{ departureStationCode, arrivalStationCode }] = leg as [
        { departureStationCode: string; arrivalStationCode: string },
      ];
      usedCodes.add(departureStationCode);
      usedCodes.add(arrivalStationCode);
    }

    for (const excluded of excludedCodes) {
      expect(usedCodes.has(excluded)).toBe(false);
    }
  });
});
