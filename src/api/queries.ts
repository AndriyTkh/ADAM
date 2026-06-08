import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Alert, Pollutant, PointReading, SensorMeta, SensorReadings, TimeRange, Vehicle, VehiclePathPoint } from './types'

export function usePollutants() {
  return useQuery({
    queryKey: ['pollutants'],
    queryFn: () => apiFetch<Pollutant[]>('/v1/pollutants'),
    staleTime: Infinity,
  })
}

export function useSensors() {
  return useQuery({
    queryKey: ['sensors'],
    queryFn: () => apiFetch<SensorMeta[]>('/v1/sensors'),
    staleTime: 5 * 60_000,
  })
}

export function useSensorReadings(t: string, enabled = true) {
  return useQuery({
    queryKey: ['sensors', 'readings', t],
    queryFn: () => apiFetch<SensorReadings>(`/v1/sensors/readings?t=${encodeURIComponent(t)}`),
    enabled,
    staleTime: t === 'live' ? 0 : Infinity,
  })
}

export function useTimerange() {
  return useQuery({
    queryKey: ['timerange'],
    queryFn: () => apiFetch<TimeRange>('/v1/timerange'),
    refetchInterval: 10 * 60_000,
  })
}

export function useAlerts(t: string, enabled = true) {
  return useQuery({
    queryKey: ['alerts', t],
    queryFn: () => apiFetch<Alert[]>(`/v1/alerts?t=${encodeURIComponent(t)}`),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useVehicles(t: string, enabled = true) {
  return useQuery({
    queryKey: ['vehicles', t],
    queryFn: () => apiFetch<Vehicle[]>(`/v1/vehicles?t=${encodeURIComponent(t)}`),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false,
    // Keep prior bucket's markers on screen while the next bucket loads so the
    // play-mode leg transition never flickers to empty (see VehiclesLayer pacemaker).
    placeholderData: keepPreviousData,
  })
}

export function useVehiclePath(id: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['vehicle', 'path', id, from, to],
    queryFn: () => apiFetch<VehiclePathPoint[]>(
      `/v1/vehicles/${id}/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
    enabled: enabled && !!id && !!from && !!to,
    staleTime: Infinity,
  })
}

export function usePointReading(
  lat: number | null,
  lng: number | null,
  t: string,
  signal?: AbortSignal,
) {
  return useQuery({
    queryKey: ['point', lat, lng, t],
    queryFn: () =>
      apiFetch<PointReading>(
        `/v1/point?lat=${lat}&lng=${lng}&t=${encodeURIComponent(t)}`,
        { signal },
      ),
    enabled: lat !== null && lng !== null,
    staleTime: t === 'live' ? 0 : Infinity,
  })
}
