/**
 * Earth's radius in kilometers
 */
const EARTH_RADIUS_KM = 6371

/**
 * Convert degrees to radians
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

/**
 * Calculate the great circle distance between two points using the Haversine formula.
 * This provides accurate distance calculations for points on a sphere.
 *
 * @param lat1 - Latitude of first point in degrees
 * @param lng1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lng2 - Longitude of second point in degrees
 * @returns Distance in kilometers, rounded to 2 decimal places
 *
 * @example
 * // Distance between Paris and Lyon
 * const distance = calculateDistance(48.8566, 2.3522, 45.7640, 4.8357)
 * console.log(distance) // ~392.22 km
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = EARTH_RADIUS_KM * c

  // Round to 2 decimal places
  return Math.round(distance * 100) / 100
}
