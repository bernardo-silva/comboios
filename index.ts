import * as p from "@clack/prompts";
import stations from "./stations.json";
import { searchJourneys } from "./journeys";
import { createSale, type SaleLeg } from "./sale";
import { fetchFeConfig } from "./fe-config";
import { ApiError } from "./api";

/** Pulls a human-readable message out of a CP API error response body. */
const describeApiError = (error: ApiError): string => {
  const body = error.body as Record<string, unknown> | undefined;

  const message =
    typeof body?.message === "string"
      ? body.message
      : typeof body?.error === "string"
        ? body.error
        : Array.isArray(body?.errors) && typeof body.errors[0]?.message === "string"
          ? body.errors[0].message
          : undefined;

  return message ?? `${error.status} ${error.statusText}`;
};

async function main() {
  const feConfig = await fetchFeConfig();

  const stationOptions = stations.map((station) => ({
    value: station.code,
    label: station.designation,
  }));

  const origin = await p.autocomplete({
    message: "Where are you departing from?",
    options: stationOptions,
    placeholder: "Type to search...",
    maxItems: 8,
  });

  if (p.isCancel(origin)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const destination = await p.autocomplete({
    message: "Where are you going?",
    options: stationOptions.filter((station) => station.value !== origin),
    placeholder: "Type to search...",
    maxItems: 8,
  });

  if (p.isCancel(destination)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const date = await p.date({
    message: "When are you travelling?",
    format: "DMY",
    initialValue: new Date(),
  });

  if (p.isCancel(date)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const originStation = stations.find((station) => station.code === origin)!;
  const destinationStation = stations.find((station) => station.code === destination)!;

  const searchSpinner = p.spinner();
  searchSpinner.start("Searching for journeys...");

  const results = await searchJourneys(origin, destination, date.toISOString().slice(0, 10), feConfig);

  searchSpinner.stop("Found journeys.");

  const journeyOptions = results.outwardTrip.map((journey, index) => ({
    value: index,
    label: `${journey.departureTime} -> ${journey.arrivalTime} (${journey.duration}, ${journey.services})`,
  }));

  const journeyIndex = await p.select({
    message: "Which journey would you like to take?",
    options: journeyOptions,
  });

  if (p.isCancel(journeyIndex)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const journey = results.outwardTrip[journeyIndex]!;

  const travelDate = date.toISOString().slice(0, 10);

  const legs: SaleLeg[] = journey.travelSections.map((section) => ({
    trainNumber: section.trainNumber,
    departureStationCode: section.departureStation.code,
    arrivalStationCode: section.arrivalStation.code,
    serviceCode: section.serviceCode.code,
    serviceDesignation: section.serviceCode.designation,
  }));

  const saleSpinner = p.spinner();
  saleSpinner.start("Booking your ticket...");

  let sale;
  try {
    sale = await createSale(legs, travelDate, 2, 1, feConfig);
  } catch (error) {
    if (error instanceof ApiError) {
      saleSpinner.stop("Booking failed.");
      p.cancel(`Could not book ticket: ${describeApiError(error)}`);
      process.exit(1);
    }
    throw error;
  }

  saleSpinner.stop("Ticket booked.");

  const seats = sale.travelData.outwardTrip
    .flatMap((leg) => leg.seatData)
    .map((seat) => `carriage ${seat.carriageNumber}, seat ${seat.seatNumber}`)
    .join(" / ");

  p.outro(
    `${originStation.designation} -> ${destinationStation.designation} on ${date.toLocaleDateString()}: ` +
      `${journey.departureTime} -> ${journey.arrivalTime} (${journey.duration}, ${journey.services})\n` +
      `Reference: ${sale.reference} (${sale.status.designation}) — ${sale.totalAmount} — ${seats}`,
  );
}

p.intro("cp");

try {
  await main();
} catch (error) {
  if (error instanceof ApiError) {
    p.cancel(`${error.context} request failed: ${describeApiError(error)}`);
    process.exit(1);
  }
  throw error;
}
