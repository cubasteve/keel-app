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
 *   - EXPIRY: every mint creates a tranche that expires `expiryDuration` (default
 *     90 days) after issuance. Expired tranches are burned automatically on the
 *     next issue/burn touching the wallet (or via the public sweepExpired()).
 *     Burns consume the OLDEST tranches first (FIFO), so members always spend
 *     their soonest-to-expire tokens.
 *   - NON-TRANSFERABLE: KEEL can only be minted and burned. Wallet-to-wallet
 *     transfers are blocked — otherwise the cap and expiry could be dodged by
 *     parking tokens in a second wallet.
 *   - Balances minted before the expiry upgrade have no tranche and never expire.
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
    // Slot 2-3: tokenomics config
    uint256 public walletCap;           // max KEEL any wallet may hold at once (default 300e18)
    uint256 public monthlyAllocation;   // standard monthly drip per member (default 100e18)
    // Slot 4+: expiry tranches (appended in expiry upgrade)
    struct Tranche {
        uint128 amount;     // remaining tokens in this tranche
        uint64  expiresAt;  // unix time after which this tranche is dead
    }
    mapping(address => Tranche[]) private _tranches;     // FIFO queue per member
    mapping(address => uint256)  private _trancheHead;   // index of oldest live tranche
    uint256 public expiryDuration;                        // 0 = use default (90 days)

    // ── Events ───────────────────────────────────────────────────────────────
    event TokensMinted(address indexed to, uint256 amount, uint256 year, uint256 month);
    event TokensBurnedForUsage(address indexed member, uint256 amount, bytes32 tripId);
    event TokensRefunded(address indexed member, uint256 amount, bytes32 tripId);
    event TokensExpired(address indexed member, uint256 amount);
    event WalletCapUpdated(uint256 newCap);
    event MonthlyAllocationUpdated(uint256 newAmount);
    event ExpiryDurationUpdated(uint256 newDuration);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __ERC20_init("Keel Token", "KEEL");
        __ERC20Burnable_init();
        __AccessControl_init();
        monthlyIssuanceCap = 100 * 10 ** 18;
        walletCap          = 300 * 10 ** 18;
        monthlyAllocation  = 100 * 10 ** 18;
        expiryDuration     = 90 days;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(LEDGER_ROLE, admin);
    }

    // ── Expiry engine ────────────────────────────────────────────────────────

    function _expiryWindow() internal view returns (uint256) {
        return expiryDuration == 0 ? 90 days : expiryDuration;
    }

    /// Record a new tranche for freshly minted tokens.
    function _pushTranche(address member, uint256 amount) internal {
        _tranches[member].push(Tranche({
            amount:    uint128(amount),
            expiresAt: uint64(block.timestamp + _expiryWindow())
        }));
    }

    /**
     * @dev Burn any tranches that have passed their expiry. Burn amount is
     *      capped at the live balance so legacy (untracked) tokens are safe.
     */
    function _sweepExpired(address member) internal returns (uint256 expired) {
        Tranche[] storage ts = _tranches[member];
        uint256 h = _trancheHead[member];
        while (h < ts.length && ts[h].expiresAt <= block.timestamp) {
            expired += ts[h].amount;
            delete ts[h];
            h++;
        }
        _trancheHead[member] = h;
        if (expired > 0) {
            uint256 bal = balanceOf(member);
            uint256 toBurn = expired > bal ? bal : expired;
            if (toBurn > 0) {
                _burn(member, toBurn);
                emit TokensExpired(member, toBurn);
            }
        }
    }

    /// @dev Consume tranches FIFO to account for a spend. Any remainder beyond
    ///      tracked tranches is legacy balance and needs no accounting.
    function _consumeTranches(address member, uint256 amount) internal {
        Tranche[] storage ts = _tranches[member];
        uint256 h = _trancheHead[member];
        uint256 rem = amount;
        while (rem > 0 && h < ts.length) {
            uint128 a = ts[h].amount;
            if (a <= rem) {
                rem -= a;
                delete ts[h];
                h++;
            } else {
                ts[h].amount = uint128(a - rem);
                rem = 0;
            }
        }
        _trancheHead[member] = h;
    }

    /// @notice Anyone may sweep a member's expired tokens (keeper-friendly).
    function sweepExpired(address member) external returns (uint256) {
        return _sweepExpired(member);
    }

    // ── Expiry views ─────────────────────────────────────────────────────────

    /// @notice Tokens already past expiry but not yet swept/burned.
    function pendingExpiry(address member) external view returns (uint256 amount) {
        Tranche[] storage ts = _tranches[member];
        for (uint256 i = _trancheHead[member]; i < ts.length; i++) {
            if (ts[i].expiresAt <= block.timestamp) amount += ts[i].amount;
            else break;
        }
    }

    /// @notice Tokens that will expire within the next `window` seconds
    ///         (includes any already-expired-but-unswept tokens).
    function expiringWithin(address member, uint256 window) external view returns (uint256 amount) {
        Tranche[] storage ts = _tranches[member];
        uint256 cutoff = block.timestamp + window;
        for (uint256 i = _trancheHead[member]; i < ts.length; i++) {
            if (ts[i].expiresAt <= cutoff) amount += ts[i].amount;
            else break;
        }
    }

    /// @notice Expiry timestamp of the member's oldest live tranche (0 = none).
    function nextExpiryAt(address member) external view returns (uint64) {
        Tranche[] storage ts = _tranches[member];
        uint256 h = _trancheHead[member];
        return h < ts.length ? ts[h].expiresAt : 0;
    }

    // ── Core monthly issuance ────────────────────────────────────────────────

    /**
     * @notice Issue the standard monthly allocation to a member. Sweeps any
     *         expired tokens first, then mints min(monthlyAllocation, cap space).
     *         Idempotent per member per month.
     */
    function issueMonthlyAllocation(
        address member,
        uint256 year,
        uint256 month
    ) external onlyRole(MINTER_ROLE) returns (uint256 issued) {
        bytes32 key = keccak256(abi.encodePacked(member, year, month));
        // Already issued this month — idempotent, return 0.
        if (monthlyMinted[key] > 0) return 0;

        _sweepExpired(member); // expired tokens free up cap space before the drip

        uint256 balance = balanceOf(member);
        if (balance >= walletCap) return 0; // already at cap

        uint256 space = walletCap - balance;
        issued = monthlyAllocation < space ? monthlyAllocation : space;
        if (issued == 0) return 0;

        monthlyMinted[key] = issued;
        _mint(member, issued);
        _pushTranche(member, issued);
        emit TokensMinted(member, issued, year, month);
    }

    /**
     * @notice Manual mint override — for admin corrections.
     *         Still enforces the wallet cap; minted tokens get a normal tranche.
     */
    function mintMonthlyAllocation(
        address member,
        uint256 amount,
        uint256 year,
        uint256 month
    ) external onlyRole(MINTER_ROLE) {
        _sweepExpired(member);
        require(balanceOf(member) + amount <= walletCap, "KeelToken: exceeds wallet cap");
        bytes32 key = keccak256(abi.encodePacked(member, year, month));
        require(monthlyMinted[key] + amount <= monthlyAllocation, "KeelToken: exceeds monthly allocation");
        monthlyMinted[key] += amount;
        _mint(member, amount);
        _pushTranche(member, amount);
        emit TokensMinted(member, amount, year, month);
    }

    // ── Ledger hooks ─────────────────────────────────────────────────────────

    function burnForUsage(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        _sweepExpired(member);
        _burn(member, amount);
        _consumeTranches(member, amount); // FIFO: oldest tokens are spent first
        emit TokensBurnedForUsage(member, amount, tripId);
    }

    function refundCancellation(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        _sweepExpired(member);
        require(balanceOf(member) + amount <= walletCap, "KeelToken: refund would exceed wallet cap");
        _mint(member, amount);
        _pushTranche(member, amount); // refunded tokens get a fresh 90-day life
        emit TokensRefunded(member, amount, tripId);
    }

    // ── Self-service burns (ERC20Burnable) keep tranche accounting in sync ───

    function burn(uint256 amount) public override {
        _sweepExpired(_msgSender());
        super.burn(amount);
        _consumeTranches(_msgSender(), amount);
    }

    function burnFrom(address account, uint256 amount) public override {
        _sweepExpired(account);
        super.burnFrom(account, amount);
        _consumeTranches(account, amount);
    }

    // ── Non-transferable: mint and burn only ─────────────────────────────────

    function _update(address from, address to, uint256 value) internal override {
        require(from == address(0) || to == address(0), "KeelToken: non-transferable");
        super._update(from, to, value);
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

    function setExpiryDuration(uint256 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDuration > 0, "KeelToken: zero duration");
        expiryDuration = newDuration;
        emit ExpiryDurationUpdated(newDuration);
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
