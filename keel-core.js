// ─────────────────────────────────────────────────────────────────────────────
// keel-core.js — shared, pure, stateless core for the KEEL dApp.
//
// Contains ONLY things with no DOM, no ethers, and no mutable app state:
//   • Contract addresses / network constants / ABIs
//   • Federal-holiday date math (US Eastern, computed from OPM rules)
//
// Loaded synchronously from index.html's head (document.write, versioned to
// APP_VERSION) so every value below is a plain global available to the app
// shell's inline script. Anything that touches the wallet, provider, live
// rate state, or the DOM stays in index.html.
//
// Deploy note: this file is cache-busted via ?v=APP_VERSION, so bumping
// APP_VERSION in index.html (and version.txt) also refreshes this file.
// ─────────────────────────────────────────────────────────────────────────────

// Cloudflare Worker that serves voyage .ics files with a text/calendar
// Content-Type — required for iOS Safari to show the native calendar preview.
const KEEL_ICS_ENDPOINT = "https://keel-ics.keel-app.workers.dev/";
const KEEL_TOKEN_ADDRESS  = "0xd4Ca4D559ccE5025e198B0EBb351BD7cE9C4164A";
const KEEL_LEDGER_ADDRESS = "0x5c27f0399C3737a68e0933183609b8a273A98eC0";
const AMOY_CHAIN_ID = 80002;
// Dedicated RPC for reading logs/history (public RPC caps getLogs at ~100 blocks).
const READ_RPC_URL = "https://polygon-amoy.g.alchemy.com/v2/tocmMJjVYA0syE3coEuGB";
// Reown AppKit (WalletConnect): set your project ID in the head <script> that
// defines window.__REOWN_PROJECT_ID, and add your deployed domain to the
// project's allowed origins at dashboard.reown.com.
const MAX_CAP = 300;
const MONTHLY_ISSUED = 100; // KEEL issued per member per month (matches token cap)

// ── Gasless relayer (members sign, the relayer pays gas) ──────────────────────
// Empty = disabled (app uses normal member-paid transactions). Set this to the
// deployed keel-relayer Worker URL to turn on gasless member actions.
const KEEL_RELAYER_ENDPOINT = "https://keel-relayer.keel-app.workers.dev";
// ── Digital logbook (signed trip & maintenance entries; D1 + R2) ──────────────
// Empty = feature hidden. Set to the deployed keel-logbook Worker URL to enable.
const KEEL_LOGBOOK_ENDPOINT = "https://keel-logbook.keel-app.workers.dev";
// MUST match logbook/worker.js exactly.
const LOGBOOK_DOMAIN = { name: "KeelLogbook", version: "1", chainId: AMOY_CHAIN_ID };
const LOGBOOK_TYPES = {
  LogEntry: [
    { name: "author",   type: "address" },
    { name: "payload",  type: "string"  },
    { name: "deadline", type: "uint256" }
  ]
};

// EIP-712 domain + types — MUST stay byte-for-byte identical to relayer/worker.js.
const RELAY_DOMAIN = { name: "KeelUsageLedger", version: "1", chainId: AMOY_CHAIN_ID, verifyingContract: KEEL_LEDGER_ADDRESS };
const RELAY_TYPES = {
  Reserve: [
    { name: "member",      type: "address"   },
    { name: "boatId",      type: "uint16"    },
    { name: "startTs",     type: "uint64"    },
    { name: "endTs",       type: "uint64"    },
    { name: "hours",       type: "uint32[8]" },
    { name: "competitive", type: "bool"      },
    { name: "deadline",    type: "uint256"   }
  ],
  Cancel: [
    { name: "member",   type: "address" },
    { name: "tripId",   type: "bytes32" },
    { name: "deadline", type: "uint256" }
  ],
  Profile: [
    { name: "member",          type: "address" },
    { name: "displayName",     type: "string"  },
    { name: "experienceLevel", type: "string"  },
    { name: "deadline",        type: "uint256" }
  ]
};
const TOKEN_ABI  = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function monthlyIssuanceCap() view returns (uint256)",
  "function monthlyMinted(bytes32) view returns (uint256)",
  "function mintMonthlyAllocation(address member, uint256 amount, uint256 year, uint256 month) external",
  "function issueMonthlyAllocation(address member, uint256 year, uint256 month) external returns (uint256 issued)",
  "function onboardMember(address member, uint256 allocation, uint256 year, uint256 month) external returns (uint256 issued)",
  "function setMemberAllocation(address member, uint256 allocation) external",
  "function memberAllocation(address) view returns (uint256)",
  "function allocationOf(address) view returns (uint256)",
  "function capOf(address) view returns (uint256)",
  "function walletCap() view returns (uint256)",
  "function monthlyAllocation() view returns (uint256)",
  "function expiringWithin(address member, uint256 window) view returns (uint256)",
  "function pendingExpiry(address member) view returns (uint256)",
  "function nextExpiryAt(address member) view returns (uint64)",
  "function tranchesOf(address member) view returns (uint256[] amounts, uint64[] expiresAts)",
  "function sweepExpired(address member) external returns (uint256)",
  "function setWalletCap(uint256 newCap) external",
  "function setMonthlyAllocation(uint256 newAmount) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)"
];

// Flat-parameter ABI — no struct, so no ethers tuple-encoding issues.
const LEDGER_ABI = [
  "function logAndSettle(address member, uint16 boatId, uint64 startTs, uint64 endTs, uint32[8] h, bool competitive) external returns (bytes32)",
  "function isAvailable(uint16 boatId, uint64 startTs, uint64 endTs) view returns (bool)",
  "function cancelTrip(bytes32 tripId) external",
  "function boatTripCount(uint16 boatId) view returns (uint256)",
  "function boatTrips(uint16, uint256) view returns (bytes32)",
  "event TripSettled(bytes32 indexed tripId, address indexed member, uint256 tokensBurned, uint32 totalTenths)",
  "event TripCancelled(bytes32 indexed tripId, address indexed member, uint16 indexed boatId, uint256 refundAmount, bool refunded)",
  "function trips(bytes32) view returns (address member, uint64 startTs, uint64 endTs, uint32 totalTenths, bool competitive, bool cancelled, uint16 boatId, uint256 burnHundredths, uint256 tokensBurned)",
  "function quoteHundredths(uint32[8] h, bool competitive) view returns (uint256 burnHundredths, uint32 totalTenths)",
  "function rateGrid(uint256, uint256) view returns (uint16)",
  "function holidayMultiplierBps(uint256) view returns (uint16)",
  "function competitiveMultiplierBps(uint256) view returns (uint16)",
  "function tripCount() view returns (uint256)",
  "function setMemberProfile(address member, string displayName, string experienceLevel) external",
  "function memberProfiles(address) view returns (string displayName, string experienceLevel, uint64 memberSince)",
  "function getMemberCount() view returns (uint256)",
  "function memberList(uint256) view returns (address)",
  "function tripIds(uint256) view returns (bytes32)"
];

// ── Federal holidays computed from OPM rules for ANY year (US Eastern) ──
// No annual maintenance: fixed-date holidays shift to their OBSERVED weekday,
// floating holidays (nth weekday) and Black Friday are computed from rules.
// A holiday runs 12:00am–11:59pm ET on its observed date. Holiday rate wins.

// nth weekday of a month: weekday 0=Sun..6=Sat, n=1..4 (or -1 for "last")
function nthWeekday(year, month /*1-12*/, weekday, n) {
  if (n === -1) {
    const last = new Date(year, month, 0).getDate(); // last day of month
    for (let d = last; d >= 1; d--) {
      if (new Date(year, month-1, d).getDay() === weekday) return d;
    }
  } else {
    let count = 0;
    const dim = new Date(year, month, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      if (new Date(year, month-1, d).getDay() === weekday) {
        if (++count === n) return d;
      }
    }
  }
  return null;
}

// Apply OPM observed-date rule to a FIXED-date holiday:
// Saturday -> observed Friday (prior); Sunday -> observed Monday (next).
function observed(year, month /*1-12*/, day) {
  const dow = new Date(year, month-1, day).getDay();
  let dt = new Date(year, month-1, day);
  if (dow === 6) dt = new Date(year, month-1, day-1);      // Sat -> Fri
  else if (dow === 0) dt = new Date(year, month-1, day+1); // Sun -> Mon
  return dt;
}

// Build the set of observed federal-holiday date keys for a given year.
function holidayKeysForYear(year) {
  const keys = new Set();
  const add = (dt) => keys.add(
    dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0")
  );

  // Fixed-date holidays (shift to observed weekday)
  add(observed(year, 1, 1));    // New Year's Day
  add(observed(year, 6, 19));   // Juneteenth
  add(observed(year, 7, 4));    // Independence Day
  add(observed(year, 11, 11));  // Veterans Day
  add(observed(year, 12, 25));  // Christmas

  // Floating holidays (nth weekday — never need observed shift)
  add(new Date(year, 0,  nthWeekday(year, 1, 1, 3)));   // MLK: 3rd Mon Jan
  add(new Date(year, 1,  nthWeekday(year, 2, 1, 3)));   // Washington: 3rd Mon Feb
  add(new Date(year, 4,  nthWeekday(year, 5, 1, -1)));  // Memorial: last Mon May
  add(new Date(year, 8,  nthWeekday(year, 9, 1, 1)));   // Labor: 1st Mon Sep
  add(new Date(year, 9,  nthWeekday(year, 10, 1, 2)));  // Columbus: 2nd Mon Oct

  const thanksgivingDay = nthWeekday(year, 11, 4, 4);   // 4th Thu Nov
  add(new Date(year, 10, thanksgivingDay));             // Thanksgiving
  add(new Date(year, 10, thanksgivingDay + 1));         // Black Friday (always day after)

  // Cross-year case: if NEXT year's New Year's Day (Jan 1) falls on a Saturday,
  // it is observed on Friday Dec 31 of THIS year — include it here.
  const nextNYD = observed(year + 1, 1, 1);
  if (nextNYD.getFullYear() === year) add(nextNYD);

  return keys;
}

// Cache computed years so we only build each once.
const _holidayCache = {};
function isFederalHoliday(y, m, d) {
  if (!_holidayCache[y]) _holidayCache[y] = holidayKeysForYear(y);
  const key = y + "-" + String(m).padStart(2,"0") + "-" + String(d).padStart(2,"0");
  return _holidayCache[y].has(key);
}

// Long-weekend rule: a federal holiday landing on Friday or Monday pulls the
// adjacent Saturday & Sunday into the holiday rate.
//   Monday holiday  -> Sat, Sun, Mon all holiday
//   Friday holiday  -> Fri, Sat, Sun all holiday
//   Midweek holiday -> that day only
// Returns true if the given date should be billed at the HOLIDAY rate.
function isHolidayRate(y, m, d) {
  if (isFederalHoliday(y, m, d)) return true;

  const dow = new Date(y, m-1, d).getDay(); // 0=Sun ... 6=Sat
  if (dow === 6) {
    const fri = new Date(y, m-1, d-1); // Friday before
    const mon = new Date(y, m-1, d+2); // Monday after
    if (isFederalHoliday(fri.getFullYear(), fri.getMonth()+1, fri.getDate())) return true;
    if (isFederalHoliday(mon.getFullYear(), mon.getMonth()+1, mon.getDate())) return true;
  } else if (dow === 0) {
    const fri = new Date(y, m-1, d-2); // Friday before
    const mon = new Date(y, m-1, d+1); // Monday after
    if (isFederalHoliday(fri.getFullYear(), fri.getMonth()+1, fri.getDate())) return true;
    if (isFederalHoliday(mon.getFullYear(), mon.getMonth()+1, mon.getDate())) return true;
  }
  return false;
}
