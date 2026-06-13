import * as p from "@clack/prompts";
import { createSale, type SaleLeg } from "./sale";
import { fetchFeConfig } from "./fe-config";
import { ApiError, isNoSeatsError } from "./api";
import { findAvailableSeats } from "./find-seats";
import { promptJourneySearch, promptJourneySelection, promptPassengerDetails, promptPassengerSelection } from "./prompts";
import { addPassenger, loadPassengers, updatePassenger } from "./passengers";

p.intro("cp");

enum Action {
  BuyTicket = "buy-ticket",
  FindSeats = "find-seats",
  AddPassenger = "add-passenger",
  EditPassenger = "edit-passenger",
}

const action = await p.select({
  message: "What would you like to do?",
  options: [
    { value: Action.BuyTicket, label: "Buy ticket" },
    { value: Action.FindSeats, label: "Find seats" },
    { value: Action.AddPassenger, label: "Add passenger" },
    { value: Action.EditPassenger, label: "Edit passenger" },
  ],
});

if (p.isCancel(action)) {
  p.cancel("Cancelled.");
  process.exit(0);
}

if (action === Action.AddPassenger) {
  const details = await promptPassengerDetails();
  const passenger = await addPassenger(details);

  p.outro(`Added passenger ${passenger.fullName}.`);
  process.exit(0);
}

if (action === Action.EditPassenger) {
  const passengers = await loadPassengers();
  const existing = await promptPassengerSelection(passengers);
  const details = await promptPassengerDetails(existing);
  const passenger = await updatePassenger(existing.id, details);

  p.outro(`Updated passenger ${passenger.fullName}.`);
  process.exit(0);
}

const feConfig = await fetchFeConfig();

if (action === Action.FindSeats) {
  const { originStation, destinationStation, date, travelDate, results } = await promptJourneySearch(feConfig);

  const singleTrainJourneys = results.outwardTrip.filter((journey) => journey.travelSections.length === 1);

  const journey = await promptJourneySelection(singleTrainJourneys);

  const findSpinner = p.spinner();
  findSpinner.start("Looking for available seats...");

  const seatResult = await findAvailableSeats(journey, travelDate, feConfig, (progress) => {
    const from = progress.from.designation;
    const to = progress.to.designation;
    findSpinner.message(`${progress.type === "no-seats" ? "❌" : "✅"} ${from} -> ${to}`);
  });

  if (seatResult.type === "direct") {
    findSpinner.stop("Seats are available for this journey.");
    p.outro(
      `${originStation.designation} -> ${destinationStation.designation} on ${date.toLocaleDateString()}: ` +
        `${journey.departureTime} -> ${journey.arrivalTime} (${journey.duration}, ${journey.services})\n` +
        `Reference: ${seatResult.sale.reference} (${seatResult.sale.status.designation}) — ${seatResult.sale.totalAmount}`,
    );
    process.exit(0);
  }

  const uncancelledSalesNote = (sales: typeof seatResult.uncancelledPendingSales) =>
    sales.length === 0
      ? ""
      : `\n\nNote: ${sales.length} pending sale(s) created while searching could not be cancelled automatically ` +
        `— review/cancel them manually: ${sales.map((sale) => sale.reference).join(", ")}`;

  if (seatResult.type === "error") {
    findSpinner.stop("Search failed.");

    const message = seatResult.error instanceof ApiError ? seatResult.error.message : String(seatResult.error);

    p.cancel(`Seat search failed: ${message}` + uncancelledSalesNote(seatResult.uncancelledPendingSales));
    process.exit(1);
  }

  if (seatResult.type === "not-found") {
    findSpinner.stop("No seats found.");

    const reasonText: Record<typeof seatResult.reason, string> = {
      "no-intermediate-stops": "the train has no intermediate stops between these stations to split the journey on",
      "api-call-limit-reached": "the search limit was reached before a working combination could be found",
      "no-combination-found": "no combination of tickets covering this journey has seats available",
    };

    p.outro(
      `No available seat combination found for ${originStation.designation} -> ${destinationStation.designation} ` +
        `on the ${journey.departureTime} -> ${journey.arrivalTime} train: ${reasonText[seatResult.reason]}.` +
        uncancelledSalesNote(seatResult.uncancelledPendingSales),
    );
    process.exit(0);
  }

  findSpinner.stop(`Found a combination of ${seatResult.segments.length} tickets.`);

  const ticketList = seatResult.segments
    .map(
      (segment, index) =>
        `${index + 1}. ${segment.departureStation.designation} -> ${segment.arrivalStation.designation} ` +
        `(train ${segment.trainNumber} ${segment.serviceCode.code}) — ` +
        `Reference: ${segment.sale.reference} (${segment.sale.status.designation}) — ${segment.sale.totalAmount}`,
    )
    .join("\n");

  p.outro(
    `Booked a pending sale for each leg of the journey:\n${ticketList}` +
      uncancelledSalesNote(seatResult.uncancelledPendingSales),
  );
  process.exit(0);
}

const { originStation, destinationStation, date, travelDate, results } = await promptJourneySearch(feConfig);

const journey = await promptJourneySelection(results.outwardTrip);

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
  if (isNoSeatsError(error)) {
    saleSpinner.stop("No seats available.");
    p.cancel("There are no seats available for this journey. Please try a different train.");
    process.exit(1);
  }

  saleSpinner.stop("Booking failed.");

  if (error instanceof ApiError) {
    p.cancel(`Booking failed: ${error.message}`);
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
