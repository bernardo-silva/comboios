import * as p from "@clack/prompts";
import stations from "./stations.json";
import { searchJourneys, type Journey, type JourneySearchResult } from "./journeys";
import type { FeConfig } from "./fe-config";
import type { Passenger, PassengerDetails } from "./passengers";

const stationOptions = stations.map((station) => ({
  value: station.code,
  label: station.designation,
}));

export interface JourneySearchSelection {
  origin: string;
  destination: string;
  originStation: (typeof stations)[number];
  destinationStation: (typeof stations)[number];
  date: Date;
  travelDate: string;
  results: JourneySearchResult;
}

/**
 * Prompts for origin, destination and travel date, then searches for
 * journeys. Exits the process if the user cancels at any step.
 */
export const promptJourneySearch = async (feConfig: FeConfig): Promise<JourneySearchSelection> => {
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
  const travelDate = date.toISOString().slice(0, 10);

  const searchSpinner = p.spinner();
  searchSpinner.start("Searching for journeys...");

  const results = await searchJourneys(origin, destination, travelDate, feConfig);

  searchSpinner.stop("Found journeys.");

  return { origin, destination, originStation, destinationStation, date, travelDate, results };
};

/**
 * Prompts the user to pick one journey from a search result. Exits the
 * process if the user cancels or if there are no journeys to pick from.
 */
export const promptJourneySelection = async (journeys: Journey[]): Promise<Journey> => {
  if (journeys.length === 0) {
    p.cancel("No journeys found.");
    process.exit(0);
  }

  const journeyOptions = journeys.map((journey, index) => ({
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

  return journeys[journeyIndex]!;
};

/**
 * Prompts for a passenger's details, pre-filling the fields with the given
 * passenger's data if provided. Exits the process if the user cancels.
 */
export const promptPassengerDetails = async (initial?: Passenger): Promise<PassengerDetails> => {
  const fullName = await p.text({
    message: "Full name",
    initialValue: initial?.fullName ?? "",
    validate: (value) => (!value || value.trim() === "" ? "Full name is required." : undefined),
  });

  if (p.isCancel(fullName)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const email = await p.text({
    message: "Email",
    initialValue: initial?.email ?? "",
    validate: (value) => {
      if (!value || value.trim() === "") return "Email is required.";
      if (!/^\S+@\S+\.\S+$/.test(value)) return "Enter a valid email address.";
      return undefined;
    },
  });

  if (p.isCancel(email)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const citizenCardNumber = await p.text({
    message: "Citizen card number",
    initialValue: initial?.citizenCardNumber ?? "",
    validate: (value) => (!value || value.trim() === "" ? "Citizen card number is required." : undefined),
  });

  if (p.isCancel(citizenCardNumber)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const greenRailwayPassNumber = await p.text({
    message: "Green railway pass number",
    initialValue: initial?.greenRailwayPassNumber ?? "",
    validate: (value) => (!value || value.trim() === "" ? "Green railway pass number is required." : undefined),
  });

  if (p.isCancel(greenRailwayPassNumber)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return { fullName, email, citizenCardNumber, greenRailwayPassNumber };
};

/**
 * Prompts the user to pick one passenger from the list. Exits the process
 * if the user cancels or if there are no passengers to pick from.
 */
export const promptPassengerSelection = async (passengers: Passenger[]): Promise<Passenger> => {
  if (passengers.length === 0) {
    p.cancel("No passengers registered yet.");
    process.exit(0);
  }

  const passengerOptions = passengers.map((passenger) => ({
    value: passenger.id,
    label: `${passenger.fullName} (${passenger.email})`,
  }));

  const passengerId = await p.select({
    message: "Which passenger would you like to edit?",
    options: passengerOptions,
  });

  if (p.isCancel(passengerId)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return passengers.find((passenger) => passenger.id === passengerId)!;
};
