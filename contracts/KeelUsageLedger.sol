// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IKeelToken {
    function burnForUsage(address member, uint256 amount, bytes32 tripId) external;
    function refundCancellation(address member, uint256 amount, bytes32 tripId) external;
}

/**
 * @title KeelUsageLedger v5
 * @notice Burns KEEL to RESERVE + pay for an upcoming boat-share voyage. The
 *         burn is a checkout that happens before the trip, so the trip records
 *         are the reservation ledger. Settlement enforces no double-booking:
 *         a new trip may not overlap an existing active trip on the same boat.
 *
 *  FLEET-READY: each trip carries a boatId (uint16). Today there is one boat
 *  (id 0). To add a fleet later, just settle trips with other ids; the overlap
 *  check is already per-boat. A cancelled flag lets a slot be freed.
 *
 *  PRICING (unchanged from v4): base rateGrid + per-slot holiday/competitive
 *  multipliers, hours passed as a uint32[8] bucket array.
 *
 *  BASE rate grid (hundredths of KEEL per hour), evening = half daytime:
 *    Weekday day=200 evening=100 ; Weekend day=400 evening=200
 *  MULTIPLIERS (bps, 10000=1.00x), per slot (0=day,1=evening):
 *    holiday day=11500 eve=11000 ; competitive day=11000 eve=11000
 */
contract KeelUsageLedger is AccessControl {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IKeelToken public immutable keelToken;

    uint16[2][2] public rateGrid = [
        [uint16(200), uint16(100)],
        [uint16(400), uint16(200)]
    ];
    uint16[2] public holidayMultiplierBps     = [uint16(11500), uint16(11000)];
    uint16[2] public competitiveMultiplierBps = [uint16(11000), uint16(11000)];

    struct TripRecord {
        address member;
        uint64  startTs;
        uint64  endTs;
        uint32  totalTenths;
        bool    competitive;
        bool    cancelled;
        uint16  boatId;
        uint256 burnHundredths;
        uint256 tokensBurned;
    }

    mapping(bytes32 => TripRecord) public trips;
    bytes32[] public tripIds;                       // global list (all boats)
    mapping(uint16 => bytes32[]) public boatTrips;  // per-boat list for overlap scan

    event TripSettled(bytes32 indexed tripId, address indexed member, uint16 indexed boatId, uint256 tokensBurned, uint32 totalTenths, uint64 startTs, uint64 endTs);
    event TripCancelled(bytes32 indexed tripId, address indexed member, uint16 indexed boatId, uint256 refundAmount, bool refunded);

    constructor(address admin, address token) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        keelToken = IKeelToken(token);
    }

    function _slotTH(
        uint32 tenths, uint16 baseRate, uint8 slot, bool holiday, bool competitive
    ) internal view returns (uint256) {
        uint256 th = uint256(tenths) * baseRate;
        if (holiday)     th = (th * holidayMultiplierBps[slot])     / 10000;
        if (competitive) th = (th * competitiveMultiplierBps[slot]) / 10000;
        return th;
    }

    /**
     * @notice Pure pricing preview. h = eight hour-buckets in tenths:
     *   [0]wdDay [1]wdEve [2]weDay [3]weEve
     *   [4]holWdDay [5]holWdEve [6]holWeDay [7]holWeEve
     */
    function quoteHundredths(uint32[8] calldata h, bool competitive)
        public view returns (uint256 burnHundredths, uint32 totalTenths)
    {
        totalTenths = h[0]+h[1]+h[2]+h[3]+h[4]+h[5]+h[6]+h[7];
        uint256 totalTH = 0;
        totalTH += _slotTH(h[0], rateGrid[0][0], 0, false, competitive);
        totalTH += _slotTH(h[1], rateGrid[0][1], 1, false, competitive);
        totalTH += _slotTH(h[2], rateGrid[1][0], 0, false, competitive);
        totalTH += _slotTH(h[3], rateGrid[1][1], 1, false, competitive);
        totalTH += _slotTH(h[4], rateGrid[0][0], 0, true,  competitive);
        totalTH += _slotTH(h[5], rateGrid[0][1], 1, true,  competitive);
        totalTH += _slotTH(h[6], rateGrid[1][0], 0, true,  competitive);
        totalTH += _slotTH(h[7], rateGrid[1][1], 1, true,  competitive);
        burnHundredths = (totalTH + 9) / 10;
    }

    /**
     * @notice True if [startTs,endTs) is free on `boatId` (no overlap with an
     *         active, non-cancelled trip). Exact half-open interval overlap.
     */
    function isAvailable(uint16 boatId, uint64 startTs, uint64 endTs)
        public view returns (bool)
    {
        bytes32[] storage ids = boatTrips[boatId];
        for (uint256 i = 0; i < ids.length; i++) {
            TripRecord storage t = trips[ids[i]];
            if (t.cancelled) continue;
            // overlap iff startA < endB && startB < endA
            if (startTs < t.endTs && t.startTs < endTs) return false;
        }
        return true;
    }

    /**
     * @notice Reserve + settle a trip. Reverts if the window overlaps an
     *         existing active trip on the same boat (no double-booking).
     */
    function logAndSettle(
        address member,
        uint16  boatId,
        uint64  startTs,
        uint64  endTs,
        uint32[8] calldata h,
        bool    competitive
    ) external returns (bytes32 tripId) {
        require(member == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not member or operator");
        require(endTs > startTs, "bad time range");
        require(isAvailable(boatId, startTs, endTs), "slot unavailable");

        (uint256 burnHundredths, uint32 totalTenths) = quoteHundredths(h, competitive);
        require(totalTenths > 0, "no hours");

        uint256 tokenAmount = burnHundredths * 1e16;
        tripId = keccak256(abi.encodePacked(member, boatId, startTs, endTs, block.timestamp));
        require(trips[tripId].member == address(0), "dup trip");

        trips[tripId] = TripRecord({
            member:         member,
            startTs:        startTs,
            endTs:          endTs,
            totalTenths:    totalTenths,
            competitive:    competitive,
            cancelled:      false,
            boatId:         boatId,
            burnHundredths: burnHundredths,
            tokensBurned:   tokenAmount
        });
        tripIds.push(tripId);
        boatTrips[boatId].push(tripId);

        keelToken.burnForUsage(member, tokenAmount, tripId);
        emit TripSettled(tripId, member, boatId, tokenAmount, totalTenths, startTs, endTs);
    }

    /**
     * @notice Cancel a trip to free its slot. Only the member or an operator.
     *         If cancelled before the trip starts, tokens are refunded in full.
     *         If the trip is already underway or past, the slot is freed but
     *         no refund is issued (tokens already used).
     */
    function cancelTrip(bytes32 tripId) external {
        TripRecord storage t = trips[tripId];
        require(t.member != address(0), "no such trip");
        require(t.member == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not allowed");
        require(!t.cancelled, "already cancelled");
        t.cancelled = true;

        bool refunded = block.timestamp < t.startTs;
        if (refunded) {
            keelToken.refundCancellation(t.member, t.tokensBurned, tripId);
        }
        emit TripCancelled(tripId, t.member, t.boatId, refunded ? t.tokensBurned : 0, refunded);
    }

    function tripCount() external view returns (uint256) { return tripIds.length; }
    function boatTripCount(uint16 boatId) external view returns (uint256) { return boatTrips[boatId].length; }

    function setRate(uint8 period, uint16 dayRate, uint16 eveningRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(period < 2, "bad period");
        rateGrid[period][0] = dayRate;
        rateGrid[period][1] = eveningRate;
    }
    function setHolidayMultiplier(uint8 slot, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(slot < 2, "bad slot");
        require(bps >= 10000, "must be >= 1.00x");
        holidayMultiplierBps[slot] = bps;
    }
    function setCompetitiveMultiplier(uint8 slot, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(slot < 2, "bad slot");
        require(bps >= 10000, "must be >= 1.00x");
        competitiveMultiplierBps[slot] = bps;
    }
}
