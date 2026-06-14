// keel-relayer — gasless meta-transaction relayer for the KEEL dApp.
//
// Members sign an EIP-712 message (free, no gas); this Worker verifies the
// signature came from the claimed member, then submits the matching ledger
// call from the OPERATOR_ROLE relayer wallet, paying the gas. On-chain the
// member is recorded as the actor (member is an explicit param), so all reads
// (history, balances, calendar) are unaffected.
//
// Secret:  RELAYER_KEY  — private key of the OPERATOR_ROLE relayer wallet.

import { ethers } from "ethers";

const LEDGER   = "0x5c27f0399C3737a68e0933183609b8a273A98eC0";
const RPC_URL  = "https://polygon-amoy.g.alchemy.com/v2/tocmMJjVYA0syE3coEuGB";
const CHAIN_ID = 80002;
const ALLOW_ORIGIN = "https://cubasteve.github.io";

const DOMAIN = { name: "KeelUsageLedger", version: "1", chainId: CHAIN_ID, verifyingContract: LEDGER };

const TYPES = {
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

const LEDGER_ABI = [
  "function logAndSettle(address member, uint16 boatId, uint64 startTs, uint64 endTs, uint32[8] h, bool competitive) external returns (bytes32)",
  "function cancelTrip(bytes32 tripId) external",
  "function setMemberProfile(address member, string displayName, string experienceLevel) external",
  "function trips(bytes32) view returns (address member, uint64 startTs, uint64 endTs, uint32 totalTenths, bool competitive, bool cancelled, uint16 boatId, uint256 burnHundredths, uint256 tokensBurned)"
];

const CORS = {
  "Access-Control-Allow-Origin":  ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST")    return json({ error: "POST only" }, 405);
    if (!env.RELAYER_KEY)             return json({ error: "Relayer not configured" }, 500);

    let req;
    try { req = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

    const { primaryType, message, signature } = req || {};
    if (!primaryType || !message || !signature || !TYPES[primaryType]) {
      return json({ error: "Missing or unknown request" }, 400);
    }

    // 1. Verify the EIP-712 signature recovers to the claimed member.
    let recovered;
    try {
      recovered = ethers.verifyTypedData(DOMAIN, { [primaryType]: TYPES[primaryType] }, message, signature);
    } catch (e) {
      return json({ error: "Invalid signature" }, 400);
    }
    if (!message.member || recovered.toLowerCase() !== String(message.member).toLowerCase()) {
      return json({ error: "Signature does not match member" }, 401);
    }

    // 2. Deadline guard (prevents stale-signature replay).
    const now = Math.floor(Date.now() / 1000);
    if (!message.deadline || Number(message.deadline) < now) {
      return json({ error: "Request expired — please try again" }, 400);
    }

    // 3. Build the operator signer + ledger.
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
    const wallet   = new ethers.Wallet(env.RELAYER_KEY, provider);
    const ledger   = new ethers.Contract(LEDGER, LEDGER_ABI, wallet);

    // Amoy enforces a ~25 gwei minimum priority fee; floor at 30.
    const tip = ethers.parseUnits("30", "gwei");
    const fees = { maxPriorityFeePerGas: tip, maxFeePerGas: ethers.parseUnits("80", "gwei") };

    try {
      let tx;
      if (primaryType === "Reserve") {
        tx = await ledger.logAndSettle(
          message.member, message.boatId, message.startTs, message.endTs,
          message.hours, message.competitive, fees
        );
      } else if (primaryType === "Cancel") {
        // Only let a member cancel their OWN trip.
        const t = await ledger.trips(message.tripId);
        if (t.member.toLowerCase() !== String(message.member).toLowerCase()) {
          return json({ error: "Not your trip" }, 403);
        }
        tx = await ledger.cancelTrip(message.tripId, fees);
      } else if (primaryType === "Profile") {
        tx = await ledger.setMemberProfile(message.member, message.displayName, message.experienceLevel, fees);
      } else {
        return json({ error: "Unsupported action" }, 400);
      }
      return json({ txHash: tx.hash });
    } catch (e) {
      // Surface the revert reason where possible (e.g. "slot unavailable").
      const reason = e?.revert?.args?.[0] || e?.shortMessage || e?.reason || e?.message || "relay failed";
      return json({ error: reason }, 400);
    }
  }
};
