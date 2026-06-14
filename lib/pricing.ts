// Prepaid call-time pricing. Bulk packages get cheaper per minute; anything
// beyond the 2-hour pack is the flat floor rate. Pure module — safe on client
// and server. Prices here are display/marketing; the server recomputes the
// authoritative price + seconds in the buyTime action so a client can't lie.

export type TimePackage = {
  id: string;
  minutes: number;
  priceCents: number;
  label: string;
  blurb: string;
};

export const STANDARD_RATE_CENTS_PER_MIN = 10; // floor rate (10c/min)

export const PACKAGES: TimePackage[] = [
  { id: 'p30', minutes: 30, priceCents: 500, label: '30 minutes', blurb: 'Quick catch-up' },
  { id: 'p60', minutes: 60, priceCents: 700, label: '1 hour', blurb: 'Most popular' },
  { id: 'p120', minutes: 120, priceCents: 1200, label: '2 hours', blurb: 'Best value' },
];

// Custom purchases are for "more than the 2-hour pack", billed at the floor rate.
export const CUSTOM_MIN_MINUTES = 120;
export const CUSTOM_MAX_MINUTES = 6000;

export function customPriceCents(minutes: number): number {
  return Math.round(minutes * STANDARD_RATE_CENTS_PER_MIN);
}

// "$5", "$12.10"
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

// 0 -> "0 min", 90 -> "1h 30m", 1800 -> "30 min"
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 min';
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  if (totalMin > 0) return `${totalMin} min`;
  return '<1 min';
}

// Effective per-minute rate of a package, for showing "16¢/min" etc.
export function ratePerMinCents(priceCents: number, minutes: number): number {
  return Math.round(priceCents / minutes);
}
