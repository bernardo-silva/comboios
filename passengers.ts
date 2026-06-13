import { z } from "zod";

const PassengerSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  email: z.string(),
  citizenCardNumber: z.string(),
  greenRailwayPassNumber: z.string(),
});

export type Passenger = z.infer<typeof PassengerSchema>;

export type PassengerDetails = Omit<Passenger, "id">;

const DB_PATH = "./passengers.json";

export const loadPassengers = async (): Promise<Passenger[]> => {
  const file = Bun.file(DB_PATH);

  if (!(await file.exists())) {
    return [];
  }

  return z.array(PassengerSchema).parse(await file.json());
};

const savePassengers = async (passengers: Passenger[]): Promise<void> => {
  await Bun.write(DB_PATH, JSON.stringify(passengers, null, 2));
};

export const addPassenger = async (details: PassengerDetails): Promise<Passenger> => {
  const passengers = await loadPassengers();
  const passenger: Passenger = { id: crypto.randomUUID(), ...details };

  passengers.push(passenger);
  await savePassengers(passengers);

  return passenger;
};

export const updatePassenger = async (id: string, details: PassengerDetails): Promise<Passenger> => {
  const passengers = await loadPassengers();
  const index = passengers.findIndex((passenger) => passenger.id === id);

  if (index === -1) {
    throw new Error(`Passenger with id ${id} not found`);
  }

  const passenger: Passenger = { id, ...details };
  passengers[index] = passenger;
  await savePassengers(passengers);

  return passenger;
};
