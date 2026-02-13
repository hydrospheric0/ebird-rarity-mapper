import { getAbaCode, ABA_MAX_CODE } from './aba-codes-data.js';

const EBIRD_API_BASE = 'https://api.ebird.org/v2';
const TRUSTED_ORIGINS = new Set([
  'https://hydrospheric0.github.io',
]);

// CORS configuration
function isAllowedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && TRUSTED_ORIGINS.has(`${u.protocol}//${u.host}`)) return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

function isValidRegionCode(region) {
  const value = String(region || '').toUpperCase();
  return value === 'US' || value === 'ABA' || /^US-[A-Z]{2}$/.test(value);
}

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return isAllowedOrigin(origin) ? origin : null;
}

function corsHeaders(request) {
  const allowedOrigin = getAllowedOrigin(request);
  return {
    'Access-Control-Allow-Origin': allowedOrigin ?? 'null',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(request, status, data, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  };
  return withCors(
    request,
    new Response(JSON.stringify(data), { status, headers })
  );
}

// Lower 48 state check
function isLower48(item) {
  const stateCode = (item.subnational1Code || '').toUpperCase();
  const excluded = ['US-AK', 'US-HI'];
  return stateCode.startsWith('US-') && !excluded.includes(stateCode);
}

// Dedupe species/location
function isConfirmedRecord(item) {
  return Number(item?.obsReviewed) === 1 && Number(item?.obsValid) === 1;
}

function dedupeSpeciesLocation(data) {
  if (!Array.isArray(data)) return data;
  const groups = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.comName || ''}|${item.locId || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ...item,
        confirmedAny: isConfirmedRecord(item),
      });
    } else {
      const existing = groups.get(key);
      const nextConfirmed = existing.confirmedAny || isConfirmedRecord(item);
      existing.confirmedAny = nextConfirmed;
      if (nextConfirmed) {
        existing.obsReviewed = 1;
        existing.obsValid = 1;
      }

      if (item.obsDt && (!existing.obsDt || item.obsDt > existing.obsDt)) {
        existing.obsDt = item.obsDt;
      }
    }
  }

  return Array.from(groups.values());
}

// Aggregate species/location reports
function aggregateSpeciesLocationReports(data) {
  if (!Array.isArray(data)) return data;
  const groups = new Map();
  
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.comName || ''}|${item.locId || ''}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        ...item,
        reportCount: 1,
        subIds: new Set([item.subId]),
        confirmedAny: isConfirmedRecord(item),
      });
    } else {
      const existing = groups.get(key);
      if (item.subId && !existing.subIds.has(item.subId)) {
        existing.subIds.add(item.subId);
        existing.reportCount = existing.subIds.size;
      }
      existing.confirmedAny = existing.confirmedAny || isConfirmedRecord(item);
      if (existing.confirmedAny) {
        existing.obsReviewed = 1;
        existing.obsValid = 1;
      }
      // Keep most recent date
      if (item.obsDt && (!existing.obsDt || item.obsDt > existing.obsDt)) {
        existing.obsDt = item.obsDt;
      }
    }
  }
  
  return Array.from(groups.values()).map(item => {
    const { subIds, ...rest } = item;
    return rest;
  });
}

// eBird API fetch with caching
async function ebirdFetch(env, path, params = {}) {
  const url = new URL(`${EBIRD_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cache = caches.default;
  
  // Try cache first
  let cached = await cache.match(cacheKey).catch(() => null);
  if (cached) return cached;
  
  // Fetch from eBird
  const response = await fetch(url, {
    headers: {
      'X-eBirdApiToken': env.EBIRD_API_KEY,
      'Accept': 'application/json',
      'User-Agent': 'ebird-rarity-mapper-worker',
    },
    method: 'GET',
  });
  
  if (!response.ok) {
    throw new Error(`eBird API error: ${response.status}`);
  }
  
  // Cache the response
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=900'); // 15 minutes
  const cachedResponse = new Response(response.body, { status: response.status, headers });
  
  await cache.put(cacheKey, cachedResponse.clone()).catch(() => {});
  
  return cachedResponse;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    
    // Origin check
    const origin = request.headers.get('Origin');
    if (origin && !getAllowedOrigin(request)) {
      return jsonResponse(request, 403, { error: 'Forbidden origin' });
    }
    
    // Only allow GET/HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse(request, 405, { error: 'Method not allowed' });
    }
    
    try {
      // Route: GET /api/aba_meta
      if (url.pathname === '/api/aba_meta') {
        return jsonResponse(request, 200, { maxCode: ABA_MAX_CODE });
      }
      
      // Route: GET /api/regions
      if (url.pathname === '/api/regions') {
        const country = (url.searchParams.get('country') || 'US').toUpperCase();
        const ebirdResp = await ebirdFetch(env, `/ref/region/list/subnational1/${country}`, { fmt: 'json' });
        const data = await ebirdResp.json();
        
        const normalized = [];
        if (Array.isArray(data)) {
          for (const item of data) {
            if (typeof item === 'object' && item) {
              const code = item.code || item.regionCode;
              const name = item.name || item.regionName || code;
              if (code) normalized.push({ code, name });
            } else if (typeof item === 'string') {
              normalized.push({ code: item, name: item });
            }
          }
        }
        
        return jsonResponse(request, 200, normalized);
      }
      
      // Route: GET /api/rarities
      if (url.pathname === '/api/rarities') {
        const region = (url.searchParams.get('region') || 'US-CA').toUpperCase();
        if (!isValidRegionCode(region)) {
          return jsonResponse(request, 400, { error: 'Invalid region code' });
        }
        const back = Math.max(1, Math.min(14, parseInt(url.searchParams.get('back') || '7', 10) || 7));
        
        const ebirdResp = await ebirdFetch(env, `/data/obs/${region}/recent/notable`, {
          detail: 'full',
          back,
        });
        let data = await ebirdResp.json();
        
        data = dedupeSpeciesLocation(data);
        if (Array.isArray(data)) {
          for (const item of data) {
            const code = getAbaCode(item.comName || '');
            if (code !== null) item.abaCode = code;
          }
        }
        
        return jsonResponse(request, 200, data, {
          'X-Data-Back': String(back),
          'X-Data-Region': region,
        });
      }
      
      // Route: GET /api/lower48_rarities
      if (url.pathname === '/api/lower48_rarities') {
        const minAba = parseInt(url.searchParams.get('minAba') || '3', 10) || 3;
        const back = Math.max(1, Math.min(30, parseInt(url.searchParams.get('back') || '7', 10) || 7));
        
        const ebirdResp = await ebirdFetch(env, `/data/obs/US/recent/notable`, {
          detail: 'full',
          back,
        });
        const raw = await ebirdResp.json();
        
        if (!Array.isArray(raw)) {
          return jsonResponse(request, 502, { error: 'Unexpected eBird response' });
        }
        
        const filtered = [];
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          if (!isLower48(item)) continue;
          
          const code = getAbaCode(item.comName || '');
          if (code === null || code < minAba) continue;
          
          item.abaCode = code;
          filtered.push(item);
        }
        
        const aggregated = aggregateSpeciesLocationReports(filtered);
        
        return jsonResponse(request, 200, aggregated, {
          'X-Data-Back': String(back),
          'X-Data-Region': 'US',
          'X-ABA-Source': 'lower48-notable',
          'X-ABA-Min': String(minAba),
          'X-Lower48': '1',
        });
      }
      
      // Not found
      return jsonResponse(request, 404, { error: 'Not found' });
      
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse(request, 502, { error: 'Upstream request failed' });
    }
  },
};
