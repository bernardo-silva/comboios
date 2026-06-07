import { z } from "zod";
import { fetchAndValidate } from "./api";

const FeConfigSchema = z.object({
  travelApiKey: z.string(),
  ticketingApiKey: z.string(),
  xcck: z.string(),
  xccs: z.string(),
});

export type FeConfig = z.infer<typeof FeConfigSchema>;

export const fetchFeConfig = async (): Promise<FeConfig> =>
  fetchAndValidate("https://cp.pt/fe-config.json", undefined, FeConfigSchema, "fe-config");
