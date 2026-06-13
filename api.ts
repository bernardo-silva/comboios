import * as p from "@clack/prompts";
import { z } from "zod";

/**
 * Thrown when an API responds with a non-2xx status. Carries the parsed
 * (or raw) response body so callers can inspect it, e.g. to detect
 * "no seats available" errors from the sale endpoint.
 */
export class ApiError extends Error {
  constructor(
    public readonly context: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {
    super(`${context} request failed: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

/**
 * Fetches `url`, parses the JSON body and validates it against `schema`.
 * On an HTTP error, throws an `ApiError` carrying the response body so
 * callers can handle expected failures (e.g. no seats available). On a
 * schema mismatch, prints a pretty message via clack and exits, since
 * that indicates an unexpected API shape rather than a recoverable error.
 */
export const fetchAndValidate = async <T extends z.ZodType>(
  url: string,
  init: RequestInit | undefined,
  schema: T,
  context: string,
): Promise<z.infer<T>> => {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(context, response.status, response.statusText, body);
  }

  const body = await response.json();
  const result = schema.safeParse(body);

  if (!result.success) {
    p.log.error(`${context} returned an unexpected response:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }

  return result.data;
};
