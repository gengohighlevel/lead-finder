export type Place = {
  osmType: 'relation' | 'way' | 'node';
  osmId: number;
  lat: number;
  lon: number;
  label: string;
  countryCode?: string;
  /** south, north, west, east (from the place search); used by the fallback business search */
  bbox?: [number, number, number, number];
};

export class LocationNotFoundError extends Error {
  constructor(location: string) { super(`Location not found: ${location}`); this.name = 'LocationNotFoundError'; }
}
