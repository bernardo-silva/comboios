import { z } from "zod";
import type { FeConfig } from "./fe-config";
import { fetchAndValidate } from "./api";

const SaleStatusSchema = z.object({
  code: z.string(),
  designation: z.string(),
});

const SeatDataSchema = z.object({
  trainNumber: z.number(),
  carriageNumber: z.number(),
  seatNumber: z.number(),
});

const SaleTripLegSchema = z.object({
  trainNumber: z.number(),
  departureTime: z.string(),
  arrivalTime: z.string(),
  seatData: z.array(SeatDataSchema),
});

const SaleSchema = z.object({
  saleID: z.number(),
  reference: z.string(),
  status: SaleStatusSchema,
  totalAmount: z.string(),
  travelData: z.object({
    outwardTrip: z.array(SaleTripLegSchema),
  }),
});

export type Sale = z.infer<typeof SaleSchema>;

export type SaleLeg = {
  trainNumber: number;
  departureStationCode: string;
  arrivalStationCode: string;
  serviceCode: string;
  serviceDesignation: string;
};

export const createSale = async (
  legs: SaleLeg[],
  travelDate: string,
  travelClass: number,
  quantity: number,
  feConfig: FeConfig,
): Promise<Sale> =>
  fetchAndValidate(
    "https://api-gateway.cp.pt/cp/services/ticketing-api/sale",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": feConfig.ticketingApiKey,
        "x-cp-connect-id": feConfig.xcck,
        "x-cp-connect-secret": feConfig.xccs,
      },
      body: JSON.stringify({
        quantity,
        travelClass: { code: String(travelClass) },
        travelDate,
        outwardTrip: legs.map((leg) => ({
          trainNumber: leg.trainNumber,
          departureStation: { code: leg.departureStationCode },
          arrivalStation: { code: leg.arrivalStationCode },
          serviceCode: { code: leg.serviceCode, designation: leg.serviceDesignation },
        })),
        lang: "en",
      }),
    },
    SaleSchema,
    "sale",
  );

/**
 * Cancels a pending sale created via `createSale`.
 */
export const cancelSale = async (saleID: number, feConfig: FeConfig): Promise<void> => {
  await fetchAndValidate(
    `https://api-gateway.cp.pt/cp/services/ticketing-api/sale/${saleID}`,
    {
      method: "DELETE",
      headers: {
        "X-Api-Key": feConfig.ticketingApiKey,
        "x-cp-connect-id": feConfig.xcck,
        "x-cp-connect-secret": feConfig.xccs,
      },
    },
    z.object({}).passthrough(),
    "cancel sale",
  );
};
