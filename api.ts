import * as p from "@clack/prompts";
import { z } from "zod";

/**
 * Fetches `url`, parses the JSON body and validates it against `schema`.
 * On an HTTP error or schema mismatch, prints a pretty message via clack
 * and exits — callers can assume a successful return is well-typed data.
 */
export const fetchAndValidate = async <T extends z.ZodType>(
  url: string,
  init: RequestInit | undefined,
  schema: T,
  context: string,
): Promise<z.infer<T>> => {
  const response = await fetch(url, init);

  if (!response.ok) {
    p.log.error(`${context} request failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  const body = await response.json();
  const result = schema.safeParse(body);

  if (!result.success) {
    p.log.error(`${context} returned an unexpected response:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }

  return result.data;
};
