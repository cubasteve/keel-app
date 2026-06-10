// KEEL ICS Worker — serves voyage calendar events with a real text/calendar
// Content-Type so iOS Safari shows the native "Add All" calendar preview.
//
// GET /?s=<startUnix>&e=<endUnix>&t=<typeLabel>&b=<keelBurned>
//
// Deploy: npx wrangler deploy   (from this folder)

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

export default {
  fetch(request) {
    const url   = new URL(request.url);
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
