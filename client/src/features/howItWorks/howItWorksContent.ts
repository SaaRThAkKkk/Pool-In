import {
  CarFront,
  CarTaxiFront,
  Handshake,
  MapPinned,
  MessagesSquare,
  MousePointerClick,
  Search,
  Shuffle,
  Smartphone,
  Star,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { SafetyStatus } from '../safety/safetyContent'

// Where each step really stands. Keep this honest: only mark a step Live when it works today.
export interface Step {
  id: string
  title: string
  summary: string
  details: string
  icon: LucideIcon
  status: SafetyStatus
}

export const STEPS: Step[] = [
  {
    id: 'account',
    title: 'Create your account',
    summary: 'Sign up in a minute.',
    details:
      "Register with your name, email, an Indian mobile number and a password. Your gender is optional and is only used for women-only pooling later. You'll be signed in straight away.",
    icon: UserPlus,
    status: 'LIVE',
  },
  {
    id: 'verify',
    title: 'Verify your phone',
    summary: 'Earn a badge and build trust.',
    details:
      'Confirm your number with a one-time code, either while signing up or later from your dashboard. A verified number adds a badge to your profile, and booking or joining a ride may require one. It confirms your number only, not your identity.',
    icon: Smartphone,
    status: 'ROLLING_OUT',
  },
  {
    id: 'pool-in',
    title: 'Press Pool In',
    summary: 'One button, one page.',
    details:
      "On the home page, press Pool In. Everything happens on a single page, with no separate screens for offering or finding a ride. The home map shows where you are, using your browser's location.",
    icon: MousePointerClick,
    status: 'LIVE',
  },
  {
    id: 'trip',
    title: 'Tell us about your trip',
    summary: 'Where, by when, and what you carry.',
    details:
      'Your start is preset to your current location, and you pick your destination from the place suggestions. Then choose the time you need to arrive by (hours and minutes) and add your luggage. A blue route line previews the way.',
    icon: MapPinned,
    status: 'LIVE',
  },
  {
    id: 'choose',
    title: 'Choose how you want to pool',
    summary: 'Own a vehicle, or pool a cab.',
    details:
      "Choose \"I own the vehicle\" if you're driving and want to share the cost, or \"Pool a cab\" if you want to share a cab with others. The form changes to ask only what that option needs.",
    icon: Shuffle,
    status: 'LIVE',
  },
  {
    id: 'match',
    title: 'We look for a match',
    summary: 'Cab requests are matched with pools.',
    details:
      "When you pool a cab, we'll search both the car-owner pools and other cab requests for a trip that suits you. Seats, luggage and time must fit first; only then do we rank what's left. Matching isn't live yet, so today your request is simply saved.",
    icon: Search,
    status: 'PLANNED',
  },
  {
    id: 'agree',
    title: 'Agree the details',
    summary: 'Request, negotiate, confirm.',
    details:
      "You'll be able to ask to join a pool and propose a fare. The other person can accept, decline or counter, and a pool is only confirmed when everyone has agreed. Seats are held only once that agreement is in place.",
    icon: Handshake,
    status: 'PLANNED',
  },
  {
    id: 'room',
    title: 'Plan in your Pool Room',
    summary: 'A private space for the group.',
    details:
      "Once a pool is agreed, its members will get a private Pool Room to chat, agree pickup and drop-off points, and see the route. Sharing live location will be optional and always your choice.",
    icon: MessagesSquare,
    status: 'PLANNED',
  },
  {
    id: 'travel',
    title: 'Travel, then rate',
    summary: 'Complete the trip and share feedback.',
    details:
      "After the journey you'll be able to rate the people you travelled with and report anything that went wrong. Pool-In coordinates the trip; it doesn't book or pay for a cab for you.",
    icon: Star,
    status: 'PLANNED',
  },
]

export interface Path {
  id: string
  title: string
  tagline: string
  icon: LucideIcon
  youTell: string[]
  whatHappens: string
}

export const PATHS: Path[] = [
  {
    id: 'own-vehicle',
    title: 'I own the vehicle',
    tagline: "You're driving and want to share the cost.",
    icon: CarFront,
    youTell: [
      'Your vehicle type, make and model',
      'Seats you can offer (limited by the vehicle type)',
      'A fare per passenger, and whether it is negotiable',
    ],
    whatHappens:
      'Your pool is saved in the car-owner section, ready for riders to find once matching is live.',
  },
  {
    id: 'pool-a-cab',
    title: 'Pool a cab',
    tagline: 'You want to share a cab with others.',
    icon: CarTaxiFront,
    youTell: ['How many people are travelling', 'Your trip and luggage, like everyone else'],
    whatHappens:
      'We first look for a matching pool in both sections. If none is found, your request is saved in the cab section so others can match with it later.',
  },
]
