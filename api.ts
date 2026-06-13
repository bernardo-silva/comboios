import * as p from "@clack/prompts";
import { z } from "zod";

const ApiErrorBodySchema = z.object({
  error: z.string().optional(),
  description: z.string().optional(),
  message: z.string().optional(),
});

/**
 * Thrown when the CP API responds with a non-2xx status. `code` is the
 * API's own error code (e.g. "WS:RES:116" for "not enough seats available"),
 * useful for callers that want to handle specific failures.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Error codes the sale endpoint returns when a journey/segment has no seats
// left: WS:RES:116 ("not enough seats available for the complete request"),
// WS:RES:114, and WS:RES:107 ("train not available, try again later").
const NO_SEATS_ERROR_CODES = new Set(["WS:RES:107", "WS:RES:114", "WS:RES:116"]);

export const isNoSeatsError = (error: unknown): boolean =>
  error instanceof ApiError && error.code !== undefined && NO_SEATS_ERROR_CODES.has(error.code);

const RETRYABLE_STATUS_MIN = 500;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches `url`, parses the JSON body and validates it against `schema`.
 * On an HTTP error, throws an `ApiError`. On a schema mismatch, prints a
 * pretty message via clack and exits — callers can assume a successful
 * return is well-typed data.
 *
 * Transient (5xx) errors are retried a few times with a short delay before
 * giving up, since the API itself often reports these as "try again later".
 */
export const fetchAndValidate = async <T extends z.ZodType>(
  url: string,
  init: RequestInit | undefined,
  schema: T,
  context: string,
): Promise<z.infer<T>> => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);

    if (!response.ok) {
      const errorBody = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
      const details = errorBody.success ? errorBody.data : undefined;

      const error = new ApiError(
        response.status,
        details?.error,
        details?.description ?? `${context} request failed: ${response.status} ${response.statusText}`,
      );

      if (response.status >= RETRYABLE_STATUS_MIN && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }

    const body = await response.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      p.log.error(`${context} returned an unexpected response:\n${z.prettifyError(result.error)}`);
      process.exit(1);
    }

    return result.data;
  }
};
