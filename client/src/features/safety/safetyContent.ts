import {
  BadgeCheck,
  Flag,
  Lightbulb,
  LocateFixed,
  MapPin,
  Share2,
  Siren,
  Smartphone,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

// Where each safety measure really stands. Keep this honest: only mark something "live" when it works today.
export type SafetyStatus = 'LIVE' | 'ROLLING_OUT' | 'PLANNED'

export const STATUS_INFO: Record<SafetyStatus, { label: string; meaning: string; chip: string }> = {
  LIVE: {
    label: 'Live',
    meaning: 'Works in the app today',
    chip: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  },
  ROLLING_OUT: {
    label: 'Rolling out',
    meaning: 'Built, still being switched on',
    chip: 'bg-amber-100 text-amber-900 ring-amber-200',
  },
  PLANNED: {
    label: 'Planned',
    meaning: 'Coming, not built yet',
    chip: 'bg-slate-100 text-slate-700 ring-slate-300',
  },
}

export interface SafetyItem {
  id: string
  title: string
  summary: string
  details: string
  icon: LucideIcon
  status: SafetyStatus
}

export const SAFETY_ITEMS: SafetyItem[] = [
  {
    id: 'phone-verification',
    title: 'Phone verification',
    summary: 'Confirm your number with a one-time code.',
    details:
      "We send a 6-digit code to your phone to confirm you can receive messages on that number. It helps other riders trust that a contact number is real. It does not verify who you are, so it never replaces your own judgement.",
    icon: Smartphone,
    status: 'ROLLING_OUT',
  },
  {
    id: 'badges',
    title: 'What a badge means',
    summary: 'A badge says only what was checked.',
    details:
      "A badge describes one specific check, such as a verified phone number. It never means someone has been vetted or is safe. We won't show a badge for something we haven't actually checked, and we don't show other riders your verification details.",
    icon: BadgeCheck,
    status: 'ROLLING_OUT',
  },
  {
    id: 'women-only',
    title: 'Women-only pools',
    summary: 'Pool only with women co-passengers.',
    details:
      "You'll be able to choose a women-only pool. The rule will be enforced on our servers, not just hidden in the app. It reduces mismatches but is never a guarantee of personal safety, and gender is self-declared, not verified.",
    icon: UsersRound,
    status: 'PLANNED',
  },
  {
    id: 'your-location',
    title: 'Your location stays yours',
    summary: 'The map uses your location on your device.',
    details:
      "The home map shows where you are using your browser's location, and that stays in your browser. If you pick \"My current location\" as a start when you pool in, we save it rounded to about 100 metres. You can allow or block location access in your browser at any time.",
    icon: MapPin,
    status: 'LIVE',
  },
  {
    id: 'live-sharing',
    title: 'Live location sharing',
    summary: 'Opt-in, time-limited and stoppable.',
    details:
      "Sharing your live location with the people in your pool will always be your choice: off by default, visible only to that pool, set to expire on its own, and stoppable at any moment. It helps you meet up. It is not a safety guarantee.",
    icon: LocateFixed,
    status: 'PLANNED',
  },
  {
    id: 'report-block',
    title: 'Report and block',
    summary: 'Flag a problem or block someone.',
    details:
      "You'll be able to report a rider, a driver or a pool, and block people you don't want to be matched with. Our team will review reports. If you are in danger, contact emergency services first: reporting comes after.",
    icon: Flag,
    status: 'PLANNED',
  },
  {
    id: 'trusted-contact',
    title: 'Trusted contact',
    summary: 'Let someone you trust follow your trip.',
    details:
      "You'll be able to share your trip with a person you trust before you travel, so someone else knows where you are going, when, and with whom.",
    icon: Share2,
    status: 'PLANNED',
  },
  {
    id: 'emergency',
    title: 'Emergency help',
    summary: 'In danger? Call 112 first.',
    details:
      "In an emergency, call India's emergency number 112 (police, fire and ambulance) before anything else. Pool-In cannot send help to you, so don't wait for a reply from us.",
    icon: Siren,
    status: 'LIVE',
  },
  {
    id: 'instincts',
    title: 'Trust your instincts',
    summary: 'Simple habits that keep you safer.',
    details:
      "Meet in a public, well-lit place. Check that the vehicle and the person match what was agreed before you get in. Tell a friend where you're going, share only the personal details you need to, and leave any situation that feels wrong.",
    icon: Lightbulb,
    status: 'LIVE',
  },
]
