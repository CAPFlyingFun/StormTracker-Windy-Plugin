// Real observed lightning for the plugin — NOAA GOES GLM via the StormTracker
// worker's keyless /glm endpoint (public-domain satellite data, no API key, no
// quota, CORS-open). A GitHub Actions job refreshes the worker's snapshot
// about every 5 minutes from NOAA's open-data bucket; freshness is anchored to
// the snapshot's build time so a stalled pipeline simply hides the layer
// instead of showing stale strikes as live.
//
// Geolocation note: GLM detects flashes optically from geostationary orbit at
// ~8–14 km accuracy — coarser than a ground network. The UI labels the source
// so observed-vs-estimated is never ambiguous.

import { haversine } from "./stormScanner";

export interface Strike {
  lat: number;
  lon: number;
  /** epoch ms of the flash */
  t: number;
  distMi: number;
}

export interface LightningResult {
  strikes: Strike[];
  sat: string | null;
  /** epoch ms the snapshot was built — drives freshness display */
  updatedMs: number;
}

const WORKER_URL = "https://stormtracker-proxy.joshua-622.workers.dev";
const FRESH_MS = 10 * 60 * 1000; // older snapshot = treat as no data

export async function fetchLightning(
  lat: number,
  lon: number,
  radiusMi: number,
): Promise<LightningResult | null> {
  try {
    const radMi = Math.max(radiusMi, 60);
    const latPad = radMi / 69;
    const lonPad = radMi / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const u =
      `${WORKER_URL}/glm?since_minutes=15&limit=500` +
      `&min_lat=${(lat - latPad).toFixed(3)}&max_lat=${(lat + latPad).toFixed(3)}` +
      `&min_lon=${(lon - lonPad).toFixed(3)}&max_lon=${(lon + lonPad).toFixed(3)}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null; // 404 = no snapshot yet; anything else = hide layer
    const j = await r.json();
    const updatedMs = j && typeof j.updated === "number" ? j.updated * 1000 : 0;
    if (!updatedMs || Date.now() - updatedMs > FRESH_MS) return null;
    const strikes: Strike[] = [];
    for (const f of j.flashes || []) {
      if (typeof f.lat !== "number" || typeof f.lon !== "number") continue;
      let t = 0;
      if (f.flash_timestamp_utc) {
        // "YYYY-MM-DD HH:MM:SS" (UTC, space, no zone marker)
        let s = String(f.flash_timestamp_utc).replace(" ", "T");
        if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
        t = Date.parse(s) || 0;
      }
      strikes.push({ lat: f.lat, lon: f.lon, t, distMi: haversine(lat, lon, f.lat, f.lon) });
    }
    return { strikes, sat: j.sat || null, updatedMs };
  } catch {
    return null;
  }
}

export interface StrikeCluster {
  lat: number;
  lng: number;
  count: number;
  /** minutes since the freshest strike in the cluster */
  minAgeMin: number;
}

// Cluster strikes into ~0.03° (~2 mi) cells — one ⚡ per cell with a count —
// so the map stays readable and the marker count bounded (same approach as
// the main app's radar map).
export function clusterStrikes(strikes: Strike[], maxClusters = 220): StrikeCluster[] {
  const now = Date.now();
  const cells = new Map<string, { latSum: number; lonSum: number; n: number; minAge: number }>();
  for (const f of strikes) {
    const qk = Math.round(f.lat / 0.03) + "_" + Math.round(f.lon / 0.03);
    const ageMin = f.t ? (now - f.t) / 60000 : 15;
    let c = cells.get(qk);
    if (!c) {
      c = { latSum: 0, lonSum: 0, n: 0, minAge: ageMin };
      cells.set(qk, c);
    }
    c.latSum += f.lat;
    c.lonSum += f.lon;
    c.n++;
    if (ageMin < c.minAge) c.minAge = ageMin;
  }
  return [...cells.values()]
    .map((c) => ({ lat: c.latSum / c.n, lng: c.lonSum / c.n, count: c.n, minAgeMin: c.minAge }))
    .sort((a, b) => a.minAgeMin - b.minAgeMin)
    .slice(0, maxClusters);
}
