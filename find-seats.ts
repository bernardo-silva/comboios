import * as p from "@clack/prompts";
import { isNoSeatsError } from "./api";
import type { FeConfig } from "./fe-config";
import type { Journey } from "./journeys";
import { cancelSale, createSale, type Sale, type SaleLeg } from "./sale";

// createSale is a write operation (a successful call creates a PENDING sale
// and reserves a seat). Stray pending sales get cleaned up via cancelSale,
// so we can afford a deeper search — but still space requests out to avoid
// rate limiting.
const MAX_TICKETS = 2;
const MAX_CANDIDATE_STOPS = 10;
const MAX_API_CALLS = 40;
const REQUEST_DELAY_MS = 1000;
const CANCEL_DELAY_MS = 1000;

export interface SeatSegment {
  departureStation: { code: string; designation: string };
  arrivalStation: { code: string; designation: string };
  trainNumber: number;
  serviceCode: { code: string; designation: string };
  sale: Sale;
}

export type NotFoundReason =
  | "no-intermediate-stops"
  | "api-call-limit-reached"
  | "no-combination-found";

export type SeatSearchResult =
  | { type: "direct"; sale: Sale }
  | { type: "split"; segments: SeatSegment[]; uncancelledPendingSales: Sale[] }
  | { type: "not-found"; reason: NotFoundReason; uncancelledPendingSales: Sale[] }
  | { type: "error"; error: unknown; uncancelledPendingSales: Sale[] };

export type SeatSearchProgress =
  | { type: "no-seats"; from: { code: string; designation: string }; to: { code: string; designation: string } }
  | { type: "found-seats"; from: { code: string; designation: string }; to: { code: string; designation: string } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts to book `leg` for `travelDate`. Returns the resulting pending sale
 * if seats are available, or `null` if the API reports no seats. Any other
 * API error is rethrown.
 */
const trySale = async (leg: SaleLeg, travelDate: string, feConfig: FeConfig): Promise<Sale | null> => {
  try {
    return await createSale([leg], travelDate, 2, 1, feConfig);
  } catch (error) {
    if (isNoSeatsError(error)) {
      return null;
    }

    throw error;
  }
};

/**
 * Cancels each of `sales` (with a delay between requests), best-effort.
 * Returns the sales that could not be cancelled.
 */
const cancelSales = async (sales: Sale[], feConfig: FeConfig): Promise<Sale[]> => {
  const uncancelled: Sale[] = [];

  for (let i = 0; i < sales.length; i++) {
    if (i > 0) await sleep(CANCEL_DELAY_MS);

    try {
      await cancelSale(sales[i]!.saleID, feConfig);
    } catch (error) {
      p.log.error(
        `Failed to cancel sale ${sales[i]!.reference}: ${error instanceof Error ? error.message : String(error)}`,
      );
      uncancelled.push(sales[i]!);
    }
  }

  return uncancelled;
};

/**
 * Given a single-train journey with no seats available end-to-end, looks for
 * a way to cover the same physical train ride with separate tickets bought
 * for sub-segments (e.g. A->C and C->B instead of A->B), picking split points
 * from the train's actual stop list so no train change is involved.
 *
 * Availability can only be confirmed by actually attempting a booking, so a
 * successful check creates a real PENDING sale. The returned result includes
 * any such pending sales created along the way that aren't part of the final
 * chosen split, so the caller can review or let them expire.
 *
 * Returns the combination using the fewest tickets (up to MAX_TICKETS).
 */
export const findAvailableSeats = async (
  journey: Journey,
  travelDate: string,
  feConfig: FeConfig,
  onProgress?: (progress: SeatSearchProgress) => void,
): Promise<SeatSearchResult> => {
  if (journey.travelSections.length !== 1) {
    throw new Error("Find seats only supports journeys with a single train (no transfers).");
  }

  const section = journey.travelSections[0]!;

  const directSale = await trySale(
    {
      trainNumber: section.trainNumber,
      departureStationCode: section.departureStation.code,
      arrivalStationCode: section.arrivalStation.code,
      serviceCode: section.serviceCode.code,
      serviceDesignation: section.serviceCode.designation,
    },
    travelDate,
    feConfig,
  );

  onProgress?.({
    type: directSale ? "found-seats" : "no-seats",
    from: section.departureStation,
    to: section.arrivalStation,
  });

  if (directSale) {
    return { type: "direct", sale: directSale };
  }

  const { trainStops } = section;

  const startIndex = trainStops.findIndex((stop) => stop.station.code === section.departureStation.code);
  const endIndex = trainStops.findIndex((stop) => stop.station.code === section.arrivalStation.code);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    return { type: "not-found", reason: "no-intermediate-stops", uncancelledPendingSales: [] };
  }

  let intermediateStops = trainStops.slice(startIndex + 1, endIndex);

  if (intermediateStops.length > MAX_CANDIDATE_STOPS) {
    const step = intermediateStops.length / (MAX_CANDIDATE_STOPS + 1);
    intermediateStops = Array.from(
      { length: MAX_CANDIDATE_STOPS },
      (_, i) => intermediateStops[Math.floor((i + 1) * step)]!,
    );
  }

  const nodes = [trainStops[startIndex]!, ...intermediateStops, trainStops[endIndex]!];

  let apiCalls = 1; // the direct attempt above already counts towards the cap
  const allSales: Sale[] = [];
  const edgeCache = new Map<string, SeatSegment | null>();

  const checkEdge = async (fromIndex: number, toIndex: number): Promise<SeatSegment | null> => {
    const key = `${fromIndex}-${toIndex}`;
    const cached = edgeCache.get(key);
    if (cached !== undefined) return cached;

    if (apiCalls >= MAX_API_CALLS) return null;

    await sleep(REQUEST_DELAY_MS);
    apiCalls++;

    const from = nodes[fromIndex]!;
    const to = nodes[toIndex]!;

    const sale = await trySale(
      {
        trainNumber: section.trainNumber,
        departureStationCode: from.station.code,
        arrivalStationCode: to.station.code,
        serviceCode: section.serviceCode.code,
        serviceDesignation: section.serviceCode.designation,
      },
      travelDate,
      feConfig,
    );

    const segment: SeatSegment | null = sale
      ? {
          departureStation: from.station,
          arrivalStation: to.station,
          trainNumber: section.trainNumber,
          serviceCode: section.serviceCode,
          sale,
        }
      : null;

    if (sale) allSales.push(sale);
    edgeCache.set(key, segment);

    if (!sale) {
      // No seats for [fromIndex, toIndex] means no seats for any larger
      // journey containing this segment either, so pre-cache those edges
      // too and skip wasting API calls on them.
      for (let x = 0; x <= fromIndex; x++) {
        for (let y = toIndex; y < nodes.length; y++) {
          if (x === fromIndex && y === toIndex) continue;
          const supersetKey = `${x}-${y}`;
          if (!edgeCache.has(supersetKey)) edgeCache.set(supersetKey, null);
        }
      }
    }

    onProgress?.({
      type: sale ? "found-seats" : "no-seats",
      from: from.station,
      to: to.station,
    });

    return segment;
  };

  // Looks for a path from `current` to `end` using exactly `remaining` more
  // tickets, preferring the longest possible jump at each step so we tend
  // towards fewer, longer segments (and fewer API calls overall).
  const findPath = async (current: number, end: number, remaining: number): Promise<SeatSegment[] | null> => {
    if (remaining === 1) {
      const segment = await checkEdge(current, end);
      return segment ? [segment] : null;
    }

    for (let next = end - 1; next > current; next--) {
      const segment = await checkEdge(current, next);
      if (!segment) continue;

      const rest = await findPath(next, end, remaining - 1);
      if (rest) return [segment, ...rest];

      if (apiCalls >= MAX_API_CALLS) return null;
    }

    return null;
  };

  let path: SeatSegment[] | null = null;

  try {
    for (let tickets = 2; tickets <= MAX_TICKETS; tickets++) {
      path = await findPath(0, nodes.length - 1, tickets);
      if (path || apiCalls >= MAX_API_CALLS) break;
    }
  } catch (error) {
    const uncancelledPendingSales = await cancelSales(allSales, feConfig);
    return { type: "error", error, uncancelledPendingSales };
  }

  if (path) {
    const usedSaleIDs = new Set(path.map((segment) => segment.sale.saleID));
    const extraSales = allSales.filter((sale) => !usedSaleIDs.has(sale.saleID));
    const uncancelledPendingSales = await cancelSales(extraSales, feConfig);
    return { type: "split", segments: path, uncancelledPendingSales };
  }

  const reason: NotFoundReason = apiCalls >= MAX_API_CALLS ? "api-call-limit-reached" : "no-combination-found";
  const uncancelledPendingSales = await cancelSales(allSales, feConfig);
  return { type: "not-found", reason, uncancelledPendingSales };
};
