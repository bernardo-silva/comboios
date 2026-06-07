import { z } from "zod";
import type { FeConfig } from "./fe-config";
import { fetchAndValidate } from "./api";

const BasePriceSchema = z.object({
  travelClass: z.number(),
  priceType: z.number(),
  centsValue: z.number(),
});

const StationRefSchema = z.object({
  code: z.string(),
  designation: z.string(),
});

const ServiceCodeSchema = z.object({
  code: z.string(),
  designation: z.string(),
});

const TravelSectionSchema = z.object({
  trainNumber: z.number(),
  serviceCode: ServiceCodeSchema,
  departureStation: StationRefSchema,
  arrivalStation: StationRefSchema,
});

const JourneySchema = z.object({
  departureTime: z.string(),
  arrivalTime: z.string(),
  duration: z.string(),
  services: z.string(),
  transferCount: z.number(),
  basePrices: z.array(BasePriceSchema).optional(),
  travelSections: z.array(TravelSectionSchema),
});

const JourneySearchResultSchema = z.object({
  outwardTrip: z.array(JourneySchema),
});

export type Journey = z.infer<typeof JourneySchema>;
export type JourneySearchResult = z.infer<typeof JourneySearchResultSchema>;

export const searchJourneys = async (
  departureStationCode: string,
  arrivalStationCode: string,
  travelDate: string,
  feConfig: FeConfig,
): Promise<JourneySearchResult> =>
  fetchAndValidate(
    "https://api-gateway.cp.pt/cp/services/travel-api/journeys",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": feConfig.travelApiKey,
        "x-cp-connect-id": feConfig.xcck,
        "x-cp-connect-secret": feConfig.xccs,
      },
      body: JSON.stringify({
        departureStationCode,
        arrivalStationCode,
        classes: [2],
        configID: 200,
        lang: "EN",
        quantities: [{ quantity: 1, type: 1 }],
        returnDate: null,
        returnTimeLimit: { endTime: "23:59", limitType: 0, startTime: "00:00" },
        saleableOnly: false,
        searchType: 3,
        services: [],
        timeLimit: { endTime: "23:59", limitType: 0, startTime: "00:00" },
        travelDate,
        username: "sivNetticket",
      }),
    },
    JourneySearchResultSchema,
    "journeys",
  );
