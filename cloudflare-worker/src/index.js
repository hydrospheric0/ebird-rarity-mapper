/**
 * Cloudflare Worker — eBird Rarity Mapper API
 *
 * County identification: bundled COUNTY_INDEX (no FCC / no TIGER for PIP).
 * County low-res geometry: served from pre-built per-state GeoJSON on Pages CDN.
 * County high-res geometry: single-county TIGER fetch (one polygon, fast, CF-cached 24h).
 * eBird fallbacks: county → state+filter fired IN PARALLEL (not sequential).
 */

import { getAbaCode, ABA_MAX_CODE } from './aba-codes-data.js';
import { COUNTY_INDEX } from './county-pip.js';

const EBIRD_API_BASE = 'https://api.ebird.org/v2';
const TIGER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';
const PAGES_BASE = 'https://mobile-rarity-mapper.pages.dev';

const STATE_FIPS_TO_CODE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY',
};
const STATE_CODE_TO_FIPS = Object.fromEntries(
  Object.entries(STATE_FIPS_TO_CODE).map(([f, c]) => [c, f])
);

// ── Local county PIP ────────────────────────────────────────────────────────
// COUNTY_INDEX entries: [fips5, minLng, minLat, maxLng, maxLat, centLng, centLat, countyRegion]
let _pipReady = false;
const _pip = new Map(); // fips5 -> [minLng, minLat, maxLng, maxLat, centLng, centLat, countyRegion]
function ensurePip() {
  if (_pipReady) return;
  for (const row of COUNTY_INDEX) _pip.set(row[0], row.slice(1));
  _pipReady = true;
}

function findCountyByLatLng(lat, lng) {
  ensurePip();
  const candidates = [];
  for (const [fips5, d] of _pip) {
    if (lng >= d[0] && lng <= d[2] && lat >= d[1] && lat <= d[3]) candidates.push({ fips5, d });
  }
  if (!candidates.length) return null;
  let best = candidates[0];
  if (candidates.length > 1) {
    let bd = Infinity;
    for (const c of candidates) {
      const dist = (c.d[4] - lng) ** 2 + (c.d[5] - lat) ** 2;
      if (dist < bd) { bd = dist; best = c; }
    }
  }
  const { fips5, d } = best;
  const stateFips = fips5.slice(0, 2);
  const stateCode = STATE_FIPS_TO_CODE[stateFips];
  return { fips5, stateFips, countyFips: fips5.slice(2, 5), stateCode, countyRegion: d[6] };
}

function parseCountyRegion(s) {
  const m = /^US-([A-Z]{2})-(\d{3})$/.exec(String(s || '').toUpperCase());
  if (!m) return null;
  const stateCode = m[1]; const countyCode = m[2];
  const stateFips = STATE_CODE_TO_FIPS[stateCode] || null;
  return { stateCode, countyCode, stateFips, fips5: stateFips ? stateFips + countyCode : null, countyRegion: `US-${stateCode}-${countyCode}` };
}

function stateRegionFromStateFips(stateFips) {
  const c = STATE_FIPS_TO_CODE[String(stateFips || '').padStart(2, '0')];
  return c ? `US-${c}` : null;
}

// ── CORS ────────────────────────────────────────────────────────────────────
function isPrivateIPv4(h) {
  const p = h.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return false;
  return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}
function isAllowedOrigin(o) {
  try {
    const u = new URL(o);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || isPrivateIPv4(u.hostname))) return true;
    return false;
  } catch { return false; }
}
function getAllowedOrigin(req) {
  const o = req.headers.get('Origin');
  return (o && isAllowedOrigin(o)) ? o : null;
}
function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(req) ?? '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') ?? 'Content-Type',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  };
}
function withCors(req, res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
function jsonResponse(req, status, data, extra = {}) {
  return withCors(req, new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  }));
}
function isValidRegionCode(r) {
  const v = String(r || '').toUpperCase();
  return v === 'US' || v === 'ABA' || /^US-[A-Z]{2}$/.test(v);
}

// ── eBird fetch (CF Cache, 15 min TTL) ──────────────────────────────────────
async function ebirdFetch(env, path, params = {}) {
  const url = new URL(`${EBIRD_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const key = new Request(url.toString());
  const cache = caches.default;
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit;
  const res = await fetch(url, { headers: { 'X-eBirdApiToken': env.EBIRD_API_KEY, 'Accept': 'application/json', 'User-Agent': 'ebird-rarity-mapper-worker' } });
  if (!res.ok) throw new Error(`eBird ${res.status}`);
  const h = new Headers(res.headers); h.set('Cache-Control', 'public, max-age=900');
  const c = new Response(res.body, { status: res.status, headers: h });
  await cache.put(key, c.clone()).catch(() => {});
  return c;
}

// ── Per-state low-res GeoJSON from Pages CDN (CF Cache, 24h) ────────────────
async function fetchStateGeoJson(stateCode) {
  const url = `${PAGES_BASE}/data/counties/${stateCode.toUpperCase()}.json`;
  const key = new Request(url);
  const cache = caches.default;
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`State GeoJSON ${res.status} (${stateCode})`);
  // Read body into memory so we can both cache and return
  const body = await res.text();
  const h = new Headers(res.headers); h.set('Cache-Control', 'public, max-age=86400');
  await cache.put(key, new Response(body, { status: 200, headers: h })).catch(() => {});
  return JSON.parse(body);
}

// ── TIGER single-county high-res (CF Cache, 24h) ───────────────────────────
async function fetchTigerCounty(fips5) {
  const geoid = String(fips5).padStart(5, '0');
  const u = new URL(TIGER_URL);
  u.searchParams.set('where', `GEOID='${geoid}'`);
  u.searchParams.set('outFields', 'GEOID,NAME,STATE,COUNTY');
  u.searchParams.set('returnGeometry', 'true');
  u.searchParams.set('f', 'geojson');
  const key = new Request(u.toString());
  const cache = caches.default;
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit.json();
  const res = await fetch(u, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`TIGER ${res.status}`);
  const body = await res.text();
  const h = new Headers(res.headers); h.set('Cache-Control', 'public, max-age=86400');
  await cache.put(key, new Response(body, { status: 200, headers: h })).catch(() => {});
  return JSON.parse(body);
}

// ── Data helpers ────────────────────────────────────────────────────────────
function isConfirmed(item) { return Number(item?.obsReviewed) === 1 && Number(item?.obsValid) === 1; }

function dedupeSpeciesLocation(data) {
  if (!Array.isArray(data)) return data;
  const g = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.comName || ''}|${item.locId || ''}`;
    if (!g.has(key)) { g.set(key, { ...item, confirmedAny: isConfirmed(item) }); }
    else {
      const e = g.get(key);
      e.confirmedAny = e.confirmedAny || isConfirmed(item);
      if (e.confirmedAny) { e.obsReviewed = 1; e.obsValid = 1; }
      if (item.obsDt && (!e.obsDt || item.obsDt > e.obsDt)) e.obsDt = item.obsDt;
    }
  }
  return Array.from(g.values());
}

function aggregateReports(data) {
  if (!Array.isArray(data)) return data;
  const g = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.comName || ''}|${item.locId || ''}`;
    if (!g.has(key)) { g.set(key, { ...item, reportCount: 1, subIds: new Set([item.subId]), confirmedAny: isConfirmed(item) }); }
    else {
      const e = g.get(key);
      if (item.subId && !e.subIds.has(item.subId)) { e.subIds.add(item.subId); e.reportCount = e.subIds.size; }
      e.confirmedAny = e.confirmedAny || isConfirmed(item);
      if (e.confirmedAny) { e.obsReviewed = 1; e.obsValid = 1; }
      if (item.obsDt && (!e.obsDt || item.obsDt > e.obsDt)) e.obsDt = item.obsDt;
    }
  }
  return Array.from(g.values()).map(({ subIds, ...rest }) => rest);
}

function isLower48(item) {
  const c = (item.subnational1Code || '').toUpperCase();
  return c.startsWith('US-') && c !== 'US-AK' && c !== 'US-HI';
}

function addAbaCodes(obs) {
  if (!Array.isArray(obs)) return obs;
  for (const item of obs) { const c = getAbaCode(item.comName || ''); if (c !== null) item.abaCode = c; }
  return obs;
}

// ── Main fetch handler ──────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    const origin = request.headers.get('Origin');
    if (origin && !getAllowedOrigin(request)) return jsonResponse(request, 403, { error: 'Forbidden origin' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse(request, 405, { error: 'Method not allowed' });

    try {

      // /api/aba_meta
      if (url.pathname === '/api/aba_meta') return jsonResponse(request, 200, { maxCode: ABA_MAX_CODE });

      // /api/regions
      if (url.pathname === '/api/regions') {
        const country = (url.searchParams.get('country') || 'US').toUpperCase();
        const res = await ebirdFetch(env, `/ref/region/list/subnational1/${country}`, { fmt: 'json' });
        const data = await res.json();
        const out = (Array.isArray(data) ? data : []).map((item) => {
          if (item && typeof item === 'object') { const c = item.code || item.regionCode; return c ? { code: c, name: item.name || item.regionName || c } : null; }
          return typeof item === 'string' ? { code: item, name: item } : null;
        }).filter(Boolean);
        return jsonResponse(request, 200, out);
      }

      // /api/rarities
      if (url.pathname === '/api/rarities') {
        const region = (url.searchParams.get('region') || 'US-CA').toUpperCase();
        if (!isValidRegionCode(region)) return jsonResponse(request, 400, { error: 'Invalid region code' });
        const back = Math.max(1, Math.min(14, parseInt(url.searchParams.get('back') || '14', 10) || 14));
        const res = await ebirdFetch(env, `/data/obs/${region}/recent/notable`, { detail: 'full', back });
        const data = addAbaCodes(dedupeSpeciesLocation(await res.json()));
        return jsonResponse(request, 200, data, { 'X-Data-Back': String(back), 'X-Data-Region': region });
      }

      // /api/lower48_rarities
      if (url.pathname === '/api/lower48_rarities') {
        const minAba = parseInt(url.searchParams.get('minAba') || '3', 10) || 3;
        const back = Math.max(1, Math.min(30, parseInt(url.searchParams.get('back') || '7', 10) || 7));
        const res = await ebirdFetch(env, '/data/obs/US/recent/notable', { detail: 'full', back });
        const raw = await res.json();
        if (!Array.isArray(raw)) return jsonResponse(request, 502, { error: 'Unexpected eBird response' });
        const filtered = [];
        for (const item of raw) {
          if (!item || !isLower48(item)) continue;
          const c = getAbaCode(item.comName || '');
          if (c === null || c < minAba) continue;
          item.abaCode = c; filtered.push(item);
        }
        return jsonResponse(request, 200, aggregateReports(filtered), {
          'X-Data-Back': String(back), 'X-Data-Region': 'US', 'X-ABA-Source': 'lower48-notable', 'X-ABA-Min': String(minAba), 'X-Lower48': '1',
        });
      }

      // /api/county_resolve — local PIP only, zero external calls
      if (url.pathname === '/api/county_resolve') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return jsonResponse(request, 400, { error: 'Invalid coordinates' });
        const result = findCountyByLatLng(lat, lon);
        if (!result) return jsonResponse(request, 404, { error: 'County not found' });
        return jsonResponse(request, 200, result, { 'Cache-Control': 'public, max-age=2592000' });
      }

      // /api/county_outline — low-res state GeoJSON from Pages CDN
      if (url.pathname === '/api/county_outline') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return jsonResponse(request, 400, { error: 'Invalid coordinates' });
        }
        const resolved = findCountyByLatLng(lat, lon);
        if (!resolved) return jsonResponse(request, 404, { error: 'County not found for coordinates' });
        const stateGeo = await fetchStateGeoJson(resolved.stateCode);
        if (!stateGeo?.features) return jsonResponse(request, 502, { error: 'State county data unavailable' });
        const features = stateGeo.features.map((f) => ({
          ...f,
          properties: { ...f.properties, isActiveCounty: f.properties?.fips5 === resolved.fips5 },
        }));
        const active = features.find((f) => f.properties.isActiveCounty);
        return jsonResponse(request, 200, {
          type: 'FeatureCollection',
          features,
          activeCountyFips: resolved.fips5,
          activeCountyRegion: resolved.countyRegion,
          stateFips: resolved.stateFips,
          countyName: active?.properties?.name || null,
        }, { 'Cache-Control': 'public, max-age=43200' });
      }

      // /api/county_hires — full-resolution single-county TIGER geometry
      if (url.pathname === '/api/county_hires') {
        const regionParam = String(url.searchParams.get('countyRegion') || '').toUpperCase();
        const parsed = parseCountyRegion(regionParam);
        if (!parsed?.fips5) return jsonResponse(request, 400, { error: 'Invalid countyRegion. Expected US-XX-NNN' });
        const geo = await fetchTigerCounty(parsed.fips5);
        if (!geo?.features?.length) return jsonResponse(request, 404, { error: 'County high-res geometry not found' });
        const features = geo.features.map((f) => ({
          ...f,
          properties: {
            fips5: parsed.fips5, countyRegion: parsed.countyRegion, stateCode: parsed.stateCode,
            countyCode: parsed.countyCode, stateFips: parsed.stateFips,
            name: f.properties?.NAME || '', isActiveCounty: true, hiRes: true,
          },
        }));
        return jsonResponse(request, 200, {
          type: 'FeatureCollection', features,
          countyRegion: parsed.countyRegion, fips5: parsed.fips5, hiRes: true,
        }, { 'Cache-Control': 'public, max-age=86400' });
      }

      // /api/county_notables
      if (url.pathname === '/api/county_notables') {
        const lat = Number(url.searchParams.get('lat'));
        const lon = Number(url.searchParams.get('lon'));
        const back = Math.max(1, Math.min(14, parseInt(url.searchParams.get('back') || '7', 10) || 7));
        const reqRegion = String(url.searchParams.get('countyRegion') || '').toUpperCase();
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return jsonResponse(request, 400, { error: 'Invalid coordinates' });
        }

        let countyFips5, stateFips, countyRegion;
        if (/^US-[A-Z]{2}-\d{3}$/.test(reqRegion)) {
          const p = parseCountyRegion(reqRegion);
          countyRegion = p.countyRegion; stateFips = p.stateFips; countyFips5 = p.fips5;
        } else {
          const r = findCountyByLatLng(lat, lon);
          if (!r) return jsonResponse(request, 404, { error: 'County not found for coordinates' });
          countyRegion = r.countyRegion; stateFips = r.stateFips; countyFips5 = r.fips5;
        }
        if (!countyRegion) return jsonResponse(request, 502, { error: 'Unable to derive county region code' });

        const stateRegion = stateRegionFromStateFips(stateFips);

        // Fire county + state IN PARALLEL — no sequential waits
        const [countyResult, stateResult] = await Promise.allSettled([
          ebirdFetch(env, `/data/obs/${countyRegion}/recent/notable`, { detail: 'full', back }).then(r => r.json()),
          stateRegion
            ? ebirdFetch(env, `/data/obs/${stateRegion}/recent/notable`, { detail: 'full', back }).then(r => r.json())
            : Promise.resolve(null),
        ]);

        const countyObs = countyResult.status === 'fulfilled' && Array.isArray(countyResult.value) ? countyResult.value : [];
        const stateObs  = stateResult.status  === 'fulfilled' && Array.isArray(stateResult.value)  ? stateResult.value  : [];

        let observations = []; let sourceRegion = countyRegion; let sourceStrategy = 'county-region';

        if (countyObs.length > 0) {
          observations = countyObs;
        } else if (stateObs.length > 0) {
          const filtered = stateObs.filter((item) => String(item?.subnational2Code || '').toUpperCase() === countyRegion);
          if (filtered.length > 0) {
            observations = filtered; sourceRegion = `${stateRegion}→${countyRegion}`; sourceStrategy = 'state-filter';
          } else {
            observations = stateObs; sourceRegion = stateRegion || countyRegion; sourceStrategy = 'state-wide-fallback';
          }
        }

        // Geo fallback only when both came back empty
        if (observations.length === 0) {
          try {
            const gr = await ebirdFetch(env, '/data/obs/geo/recent/notable', { lat, lng: lon, dist: 50, detail: 'full', back });
            const gd = await gr.json();
            observations = Array.isArray(gd)
              ? gd.filter((item) => String(item?.subnational2Code || '').toUpperCase() === countyRegion)
              : [];
            sourceRegion = `geo:${lat.toFixed(3)},${lon.toFixed(3)}`; sourceStrategy = 'geo-county-filter';
            if (observations.length === 0) { observations = Array.isArray(gd) ? gd : []; sourceStrategy = 'geo-broad-fallback'; }
          } catch (e) { console.warn('Geo fallback failed:', e); }
        }

        observations = addAbaCodes(dedupeSpeciesLocation(observations));

        return jsonResponse(request, 200, {
          countyRegion, countyFips: countyFips5, countyName: null,
          stateFips, back, sourceRegion, sourceStrategy,
          observations: observations || [],
        }, {
          'X-Data-Region': sourceRegion, 'X-Data-Back': String(back), 'Cache-Control': 'public, max-age=900',
        });
      }

      // /api/us_notable_counts — per-state notable count for the whole US, cached 30 min
      if (url.pathname === '/api/us_notable_counts') {
        const back = Math.max(1, Math.min(14, parseInt(url.searchParams.get('back') || '7', 10) || 7));
        const res = await ebirdFetch(env, '/data/obs/US/recent/notable', { detail: 'simple', back });
        const raw = await res.json();
        if (!Array.isArray(raw)) return jsonResponse(request, 502, { error: 'Unexpected eBird response' });
        const counts = {};
        for (const item of raw) {
          const code = (item.subnational1Code || '').toUpperCase();
          if (!code.startsWith('US-')) continue;
          const st = code.slice(3);
          counts[st] = (counts[st] || 0) + 1;
        }
        return jsonResponse(request, 200, { back, states: counts }, {
          'Cache-Control': 'public, max-age=1800',
        });
      }

      return jsonResponse(request, 404, { error: 'Not found' });

    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse(request, 502, { error: 'Upstream request failed', detail: err?.message });
    }
  },
};
