// keel-logbook — signed trip & maintenance log entries, stored in D1 + R2.
//
// Members sign an EIP-712 LogEntry (free, no gas); this Worker verifies the
// signature, checks authorization (trip logs: signer owns the trip OR is an
// operator; maintenance logs: signer holds OPERATOR_ROLE), stores any photos
// in R2, and the row in D1. Reads are public (GET).
//
// Bindings: DB (D1), PHOTOS (R2). See wrangler.toml.

import { ethers } from "ethers";

const LEDGER   = "0x5c27f0399C3737a68e0933183609b8a273A98eC0";
const RPC_URL  = "https://polygon-amoy.g.alchemy.com/v2/tocmMJjVYA0syE3coEuGB";
const CHAIN_ID = 80002;
const ALLOW_ORIGIN = "https://cubasteve.github.io";
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 1_500_000; // ~1.5MB per photo after client-side resize

const DOMAIN = { name: "KeelLogbook", version: "1", chainId: CHAIN_ID };
const TYPES = {
  LogEntry: [
    { name: "author",   type: "address" },
    { name: "payload",  type: "string"  }, // canonical JSON of the entry fields
    { name: "deadline", type: "uint256" }
  ]
};

const LEDGER_ABI = [
  "function trips(bytes32) view returns (address member, uint64 startTs, uint64 endTs, uint32 totalTenths, bool competitive, bool cancelled, uint16 boatId, uint256 burnHundredths, uint256 tokensBurned)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function OPERATOR_ROLE() view returns (bytes32)"
];

const CORS = {
  "Access-Control-Allow-Origin":  ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    // ── Serve a photo from R2 ──────────────────────────────────────────────
    if (request.method === "GET" && url.pathname.startsWith("/photo/")) {
      const key = decodeURIComponent(url.pathname.slice("/photo/".length));
      const obj = await env.PHOTOS.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS });
      return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000", ...CORS } });
    }

    // ── List entries (public) ──────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/entries") {
      const tripId = url.searchParams.get("tripId");
      const boatId = url.searchParams.get("boatId");
      let stmt;
      if (tripId)      stmt = env.DB.prepare("SELECT * FROM log_entries WHERE trip_id = ? ORDER BY created_at DESC").bind(tripId);
      else if (boatId !== null) stmt = env.DB.prepare("SELECT * FROM log_entries WHERE boat_id = ? ORDER BY created_at DESC LIMIT 200").bind(Number(boatId || 0));
      else             stmt = env.DB.prepare("SELECT * FROM log_entries ORDER BY created_at DESC LIMIT 200");
      const { results } = await stmt.all();
      const base = url.origin;
      const out = (results || []).map(r => ({
        id: r.id, kind: r.kind, tripId: r.trip_id, boatId: r.boat_id, author: r.author,
        engineHours: r.engine_hours, fuelPct: r.fuel_pct, conditions: r.conditions,
        notes: r.notes, issue: !!r.issue, createdAt: r.created_at,
        photos: JSON.parse(r.photo_keys || "[]").map(k => base + "/photo/" + encodeURIComponent(k))
      }));
      return json({ entries: out });
    }

    if (request.method !== "POST" || url.pathname !== "/entry") return json({ error: "Not found" }, 404);

    // ── Create an entry ────────────────────────────────────────────────────
    let req;
    try { req = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    const { author, payload, deadline, signature, photos } = req || {};
    if (!author || !payload || !deadline || !signature) return json({ error: "Missing fields" }, 400);

    // 1. Verify signature.
    let recovered;
    try { recovered = ethers.verifyTypedData(DOMAIN, TYPES, { author, payload, deadline }, signature); }
    catch { return json({ error: "Invalid signature" }, 400); }
    if (recovered.toLowerCase() !== String(author).toLowerCase()) return json({ error: "Signature mismatch" }, 401);
    if (Number(deadline) < Math.floor(Date.now()/1000)) return json({ error: "Request expired" }, 400);

    let e;
    try { e = JSON.parse(payload); } catch { return json({ error: "Bad payload" }, 400); }
    const kind = e.kind === "maintenance" ? "maintenance" : "trip";

    // 2. Authorization.
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
    const ledger = new ethers.Contract(LEDGER, LEDGER_ABI, provider);
    try {
      if (kind === "trip") {
        if (!e.tripId) return json({ error: "tripId required" }, 400);
        const t = await ledger.trips(e.tripId);
        const isOwner = t.member.toLowerCase() === recovered.toLowerCase();
        const isOp = await ledger.hasRole(await ledger.OPERATOR_ROLE(), recovered);
        if (!isOwner && !isOp) return json({ error: "Not your trip" }, 403);
      } else {
        const isOp = await ledger.hasRole(await ledger.OPERATOR_ROLE(), recovered);
        if (!isOp) return json({ error: "Maintenance entries are operator-only" }, 403);
      }
    } catch (err) { return json({ error: "Authorization check failed" }, 502); }

    // 3. Store photos in R2.
    const photoKeys = [];
    try {
      const arr = Array.isArray(photos) ? photos.slice(0, MAX_PHOTOS) : [];
      for (let i = 0; i < arr.length; i++) {
        const m = /^data:(image\/\w+);base64,(.+)$/.exec(arr[i] || "");
        if (!m) continue;
        const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        if (bytes.length > MAX_PHOTO_BYTES) return json({ error: "Photo too large (max ~1.5MB each)" }, 400);
        const key = `${kind}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,8)}.jpg`;
        await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: m[1] } });
        photoKeys.push(key);
      }
    } catch (err) { return json({ error: "Photo upload failed" }, 500); }

    // 4. Insert row.
    try {
      await env.DB.prepare(
        `INSERT INTO log_entries (kind, trip_id, boat_id, author, engine_hours, fuel_pct, conditions, notes, issue, photo_keys, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        kind,
        kind === "trip" ? String(e.tripId) : null,
        Number.isFinite(+e.boatId) ? +e.boatId : 0,
        recovered,
        (e.engineHours === "" || e.engineHours == null) ? null : Number(e.engineHours),
        (e.fuelPct === "" || e.fuelPct == null) ? null : Math.max(0, Math.min(100, Math.round(Number(e.fuelPct)))),
        e.conditions ? String(e.conditions).slice(0, 200) : null,
        e.notes ? String(e.notes).slice(0, 2000) : null,
        e.issue ? 1 : 0,
        JSON.stringify(photoKeys),
        Math.floor(Date.now()/1000)
      ).run();
    } catch (err) { return json({ error: "Save failed: " + (err.message || err) }, 500); }

    return json({ ok: true, photos: photoKeys.length });
  }
};
