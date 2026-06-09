// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title KeelToken
 * @notice ERC-20 usage token for the KEEL boat-share system.
 *
 * Tokenomics:
 *   - walletCap:         max KEEL any single wallet may hold at once (default 300)
 *   - monthlyAllocation: standard monthly drip per member (default 100)
 *   - issueMonthlyAllocation() mints min(monthlyAllocation, walletCap - balance),
 *     so it never pushes a wallet over the cap and is idempotent per member per month.
 *   - Burns (voyages) reduce balance, freeing space for the next drip.
 */
contract KeelToken is
    Initializable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant LEDGER_ROLE = keccak256("LEDGER_ROLE");

    // ── Storage layout (append-only — never reorder) ─────────────────────────
    // Slot 0: monthlyIssuanceCap — original field, kept for ABI compat
    uint256 public monthlyIssuanceCap;
    // Slot 1: monthlyMinted — per-member per-month issuance tracker
    mapping(bytes32 => uint256) public monthlyMinted;
    // Slot 2+: new fields appended after existing ones
    uint256 public walletCap;           // max KEEL any wallet may hold at once (default 300e18)
    uint256 public monthlyAllocation;   // standard monthly drip per member (default 100e18)

    // ── Events ───────────────────────────────────────────────────────────────
    event TokensMinted(address indexed to, uint256 amount, uint256 year, uint256 month);
    event TokensBurnedForUsage(address indexed member, uint256 amount, bytes32 tripId);
    event TokensRefunded(address indexed member, uint256 amount, bytes32 tripId);
    event WalletCapUpdated(uint256 newCap);
    event MonthlyAllocationUpdated(uint256 newAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __ERC20_init("Keel Token", "KEEL");
        __ERC20Burnable_init();
        __AccessControl_init();
        monthlyIssuanceCap = 100 * 10 ** 18;
        walletCap          = 300 * 10 ** 18;
        monthlyAllocation  = 100 * 10 ** 18;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(LEDGER_ROLE, admin);
    }

    // ── Core monthly issuance ────────────────────────────────────────────────

    /**
     * @notice Issue the standard monthly allocation to a member.
     *         Smart-caps the amount so the member never exceeds walletCap.
     *         Idempotent: calling again for the same member+month is a no-op.
     * @return issued The actual amount minted (may be less than monthlyAllocation,
     *                or zero if the member is already at cap or already received
     *                their allocation this month).
     */
    function issueMonthlyAllocation(
        address member,
        uint256 year,
        uint256 month
    ) external onlyRole(MINTER_ROLE) returns (uint256 issued) {
        bytes32 key = keccak256(abi.encodePacked(member, year, month));
        // Already issued this month — idempotent, return 0.
        if (monthlyMinted[key] > 0) return 0;

        uint256 balance = balanceOf(member);
        if (balance >= walletCap) return 0; // already at cap

        uint256 space = walletCap - balance;
        issued = monthlyAllocation < space ? monthlyAllocation : space;
        if (issued == 0) return 0;

        monthlyMinted[key] = issued;
        _mint(member, issued);
        emit TokensMinted(member, issued, year, month);
    }

    /**
     * @notice Manual mint override — for admin corrections.
     *         Still enforces the wallet cap.
     */
    function mintMonthlyAllocation(
        address member,
        uint256 amount,
        uint256 year,
        uint256 month
    ) external onlyRole(MINTER_ROLE) {
        require(balanceOf(member) + amount <= walletCap, "KeelToken: exceeds wallet cap");
        bytes32 key = keccak256(abi.encodePacked(member, year, month));
        require(monthlyMinted[key] + amount <= monthlyAllocation, "KeelToken: exceeds monthly allocation");
        monthlyMinted[key] += amount;
        _mint(member, amount);
        emit TokensMinted(member, amount, year, month);
    }

    // ── Ledger hooks ─────────────────────────────────────────────────────────

    function burnForUsage(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        _burn(member, amount);
        emit TokensBurnedForUsage(member, amount, tripId);
    }

    function refundCancellation(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        require(balanceOf(member) + amount <= walletCap, "KeelToken: refund would exceed wallet cap");
        _mint(member, amount);
        emit TokensRefunded(member, amount, tripId);
    }

    // ── Admin config ─────────────────────────────────────────────────────────

    function setWalletCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        walletCap = newCap;
        emit WalletCapUpdated(newCap);
    }

    function setMonthlyAllocation(uint256 newAmount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        monthlyAllocation  = newAmount;
        monthlyIssuanceCap = newAmount; // keep legacy field in sync
        emit MonthlyAllocationUpdated(newAmount);
    }

    // Legacy setter — kept for ABI compatibility
    function setMonthlyIssuanceCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        monthlyIssuanceCap = newCap;
        monthlyAllocation  = newCap;
        emit MonthlyAllocationUpdated(newCap);
    }

    // Required by UUPS — only admin can authorize upgrades
    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
