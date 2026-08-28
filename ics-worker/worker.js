// KEEL ICS Worker — serves voyage calendar events with a real text/calendar
// Content-Type so iOS Safari shows the native "Add All" calendar preview.
//
// GET /?s=<startUnix>&e=<endUnix>&t=<typeLabel>&b=<keelBurned>
//
// Also proxies Tomorrow.io precipitation forecast tiles for the weather page,
// with the API key kept in a Worker secret (TOMORROW_KEY) and tiles cached at
// the Cloudflare edge so the tiny free-tier quota is shared, not per-browser:
//
// GET /tile/<z>/<x>/<y>/<isoTime>.png
//
// Deploy: npx wrangler deploy   (from this folder)
// Key:    npx wrangler secret put TOMORROW_KEY

function icsDate(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
    + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "00Z";
}

// iCal TEXT values need commas/semicolons/backslashes escaped.
function icsEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

async function handleTile(request, env, ctx) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/tile\/(\d{1,2})\/(\d+)\/(\d+)\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\.png$/);
  if (!m) return new Response("Bad tile path", { status: 400 });
  const [, z, x, y, iso] = m;
  if (+z > 12) return new Response("Zoom too deep", { status: 400 });

  const cache = caches.default;
  const cacheKey = new Request("https://keel-tile-cache/" + z + "/" + x + "/" + y + "/" + iso);
  let res = await cache.match(cacheKey);
  if (res) return res;

  const up = await fetch("https://api.tomorrow.io/v4/map/tile/" + z + "/" + x + "/" + y +
    "/precipitationIntensity/" + iso + ".png?apikey=" + env.TOMORROW_KEY);
  if (!up.ok) {
    // Pass 429 through so the client can fall back; don't cache failures
    return new Response("upstream " + up.status, {
      status: up.status === 429 ? 429 : 502,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
  // Edge TTL, and why it is 65 minutes rather than 15.
  //
  // A client anchors its forecast to the current half hour and asks for
  // +1h/+2h/+3h from it, so every absolute time is asked for three times,
  // an hour apart: the tile for 17:00 is fetched by the 14:00 slot, the
  // 15:00 slot and the 16:00 slot. At 15 minutes nothing was ever reused
  // - not even between two devices in the same 30-minute slot - so every
  // build cost the full 12 calls against a 25/hour free tier.
  //
  //   900s   every build pays 12          24 calls/hour
  //   1800s  a slot is shared aboard      24 calls/hour, one build's worth
  //   3900s  the hour-later reuse hits    16 calls/hour   <- here
  //   7800s  both reuses hit               8 calls/hour
  //
  // 7800 is cheaper still, but it would serve the +1h frame from a model
  // run two hours old, and the near hour is the one you are dodging
  // squalls with. 65 minutes keeps every tile under an hour old and still
  // takes a third off the bill.
  //
  // s-maxage is what the Cloudflare edge reads; max-age is left short so a
  // browser that lingers on the page still comes back for a fresher tile.
  res = new Response(up.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=900, s-maxage=3900",
      "Access-Control-Allow-Origin": "*"
    }
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url   = new URL(request.url);
    if (url.pathname.startsWith("/tile/")) return handleTile(request, env, ctx);
    const start = parseInt(url.searchParams.get("s"), 10);
    const end   = parseInt(url.searchParams.get("e"), 10);
    const type  = icsEscape((url.searchParams.get("t") || "Voyage").slice(0, 60));
    const burn  = icsEscape((url.searchParams.get("b") || "").slice(0, 20));

    if (!start || !end || end <= start) {
      return new Response("Bad params — need s=<startUnix>&e=<endUnix>", { status: 400 });
    }
    // Sanity window: 2020-2100
    if (start < 1577836800 || start > 4102444800) {
      return new Response("Timestamp out of range", { status: 400 });
    }

    const hrs  = ((end - start) / 3600).toFixed(1);
    const desc = `KEEL Token Voyage\\nType: ${type}\\nDuration: ${hrs}h`
      + (burn ? `\\nKEEL burned: ${burn}` : "")
      + `\\nSettled on Polygon Amoy blockchain.`;

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KEEL Token//Boat Share//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:keel-trip-${start}-${end}@keeltoken`,
      `DTSTAMP:${icsDate(Math.floor(Date.now() / 1000))}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:⛵ ${type} — KEEL Boat Share`,
      `DESCRIPTION:${desc}`,
      "LOCATION:Boat · All times US Eastern",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="keel-voyage.ics"',
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
