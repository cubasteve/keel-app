// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IKeelToken {
    function burnForUsage(address member, uint256 amount, bytes32 tripId) external;
    function refundCancellation(address member, uint256 amount, bytes32 tripId) external;
}

/**
 * @title KeelUsageLedger
 * @notice UUPS-upgradeable ledger: reserves boat-share voyages, burns KEEL,
 *         enforces no double-booking, issues refunds on pre-trip cancellations,
 *         and maintains a public member profile registry.
 */
contract KeelUsageLedger is Initializable, AccessControlUpgradeable, UUPSUpgradeable {

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IKeelToken public keelToken;

    uint16[2][2] public rateGrid;
    uint16[2] public holidayMultiplierBps;
    uint16[2] public competitiveMultiplierBps;

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
    bytes32[] public tripIds;
    mapping(uint16 => bytes32[]) public boatTrips;

    // ── Member Registry ──────────────────────────────────────────────────────
    struct MemberProfile {
        string  displayName;
        string  experienceLevel;
        uint64  memberSince;
    }
    mapping(address => MemberProfile) public memberProfiles;
    address[] public memberList;

    // ── Events ───────────────────────────────────────────────────────────────
    event TripSettled(bytes32 indexed tripId, address indexed member, uint16 indexed boatId, uint256 tokensBurned, uint32 totalTenths, uint64 startTs, uint64 endTs);
    event TripCancelled(bytes32 indexed tripId, address indexed member, uint16 indexed boatId, uint256 refundAmount, bool refunded);
    event MemberProfileUpdated(address indexed member, string displayName);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin, address token) public initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        keelToken = IKeelToken(token);
        rateGrid              = [[uint16(200), uint16(100)], [uint16(400), uint16(200)]];
        holidayMultiplierBps  = [uint16(11500), uint16(11000)];
        competitiveMultiplierBps = [uint16(11000), uint16(11000)];
    }

    // ── Pricing ──────────────────────────────────────────────────────────────
    function _slotTH(uint32 tenths, uint16 baseRate, uint8 slot, bool holiday, bool competitive)
        internal view returns (uint256)
    {
        uint256 th = uint256(tenths) * baseRate;
        if (holiday)     th = (th * holidayMultiplierBps[slot])     / 10000;
        if (competitive) th = (th * competitiveMultiplierBps[slot]) / 10000;
        return th;
    }

    function quoteHundredths(uint32[8] calldata h, bool competitive)
        public view returns (uint256 burnHundredths, uint32 totalTenths)
    {
        totalTenths = h[0]+h[1]+h[2]+h[3]+h[4]+h[5]+h[6]+h[7];
        uint256 total = 0;
        total += _slotTH(h[0], rateGrid[0][0], 0, false, competitive);
        total += _slotTH(h[1], rateGrid[0][1], 1, false, competitive);
        total += _slotTH(h[2], rateGrid[1][0], 0, false, competitive);
        total += _slotTH(h[3], rateGrid[1][1], 1, false, competitive);
        total += _slotTH(h[4], rateGrid[0][0], 0, true,  competitive);
        total += _slotTH(h[5], rateGrid[0][1], 1, true,  competitive);
        total += _slotTH(h[6], rateGrid[1][0], 0, true,  competitive);
        total += _slotTH(h[7], rateGrid[1][1], 1, true,  competitive);
        burnHundredths = (total + 9) / 10;
    }

    // ── Availability ─────────────────────────────────────────────────────────
    function isAvailable(uint16 boatId, uint64 startTs, uint64 endTs)
        public view returns (bool)
    {
        bytes32[] storage ids = boatTrips[boatId];
        for (uint256 i = 0; i < ids.length; i++) {
            TripRecord storage t = trips[ids[i]];
            if (t.cancelled) continue;
            if (startTs < t.endTs && t.startTs < endTs) return false;
        }
        return true;
    }

    // ── Trip Settlement ───────────────────────────────────────────────────────
    function logAndSettle(
        address member, uint16 boatId, uint64 startTs, uint64 endTs,
        uint32[8] calldata h, bool competitive
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
            member: member, startTs: startTs, endTs: endTs,
            totalTenths: totalTenths, competitive: competitive,
            cancelled: false, boatId: boatId,
            burnHundredths: burnHundredths, tokensBurned: tokenAmount
        });
        tripIds.push(tripId);
        boatTrips[boatId].push(tripId);

        keelToken.burnForUsage(member, tokenAmount, tripId);
        emit TripSettled(tripId, member, boatId, tokenAmount, totalTenths, startTs, endTs);
    }

    // ── Cancellation ─────────────────────────────────────────────────────────
    function cancelTrip(bytes32 tripId) external {
        TripRecord storage t = trips[tripId];
        require(t.member != address(0), "no such trip");
        require(t.member == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not allowed");
        require(!t.cancelled, "already cancelled");
        t.cancelled = true;
        bool refunded = block.timestamp < t.startTs;
        if (refunded) keelToken.refundCancellation(t.member, t.tokensBurned, tripId);
        emit TripCancelled(tripId, t.member, t.boatId, refunded ? t.tokensBurned : 0, refunded);
    }

    // ── Member Registry ──────────────────────────────────────────────────────
    function setMemberProfile(
        address member,
        string calldata displayName,
        string calldata experienceLevel
    ) external {
        require(member == msg.sender || hasRole(OPERATOR_ROLE, msg.sender), "not allowed");
        MemberProfile storage p = memberProfiles[member];
        if (p.memberSince == 0) {
            p.memberSince = uint64(block.timestamp);
            memberList.push(member);
        }
        p.displayName     = displayName;
        p.experienceLevel = experienceLevel;
        emit MemberProfileUpdated(member, displayName);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function tripCount()                  external view returns (uint256) { return tripIds.length; }
    function boatTripCount(uint16 boatId) external view returns (uint256) { return boatTrips[boatId].length; }
    function getMemberCount()             external view returns (uint256) { return memberList.length; }

    // ── Admin setters ─────────────────────────────────────────────────────────
    function setRate(uint8 period, uint16 dayRate, uint16 eveningRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(period < 2, "bad period");
        rateGrid[period][0] = dayRate; rateGrid[period][1] = eveningRate;
    }
    function setHolidayMultiplier(uint8 slot, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(slot < 2, "bad slot"); require(bps >= 10000, "must be >= 1.00x");
        holidayMultiplierBps[slot] = bps;
    }
    function setCompetitiveMultiplier(uint8 slot, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(slot < 2, "bad slot"); require(bps >= 10000, "must be >= 1.00x");
        competitiveMultiplierBps[slot] = bps;
    }

    // Required by UUPS — only admin can authorize upgrades
    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
