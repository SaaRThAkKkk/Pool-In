import type { RequestHandler } from 'express';
import { toOwnerRideDto } from '../models/Ride.js';
import { createOwnerRide, getOwnerRide, listOwnerRides } from '../services/rides/rideService.js';
import type { CreateRideInput } from '../validators/rides.js';

export function makeRideController() {
  const create: RequestHandler = async (req, res) => {
    const ride = await createOwnerRide(req.user!, req.body as CreateRideInput);
    res.status(201).json({ success: true, data: { ride: toOwnerRideDto(ride) } });
  };

  const mine: RequestHandler = async (req, res) => {
    const rides = await listOwnerRides(req.user!);
    res.json({ success: true, data: { rides: rides.map(toOwnerRideDto) } });
  };

  const getOne: RequestHandler = async (req, res) => {
    const ride = await getOwnerRide(req.user!, String(req.params.id));
    res.json({ success: true, data: { ride: toOwnerRideDto(ride) } });
  };

  return { create, mine, getOne };
}
