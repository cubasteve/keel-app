// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract KeelToken is ERC20, ERC20Burnable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant LEDGER_ROLE = keccak256("LEDGER_ROLE");

    uint256 public monthlyIssuanceCap = 100 * 10 ** 18;

    mapping(bytes32 => uint256) public monthlyMinted;

    event TokensMinted(address indexed to, uint256 amount, uint256 year, uint256 month);
    event TokensBurnedForUsage(address indexed member, uint256 amount, bytes32 tripId);
    event TokensRefunded(address indexed member, uint256 amount, bytes32 tripId);
    event MonthlyCapUpdated(uint256 newCap);

    constructor(address admin) ERC20("Keel Token", "KEEL") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(LEDGER_ROLE, admin);
    }

    function mintMonthlyAllocation(
        address member,
        uint256 amount,
        uint256 year,
        uint256 month
    ) external onlyRole(MINTER_ROLE) {
        bytes32 key = keccak256(abi.encodePacked(member, year, month));
        require(
            monthlyMinted[key] + amount <= monthlyIssuanceCap,
            "KeelToken: exceeds monthly cap"
        );
        monthlyMinted[key] += amount;
        _mint(member, amount);
        emit TokensMinted(member, amount, year, month);
    }

    function burnForUsage(
        address member,
        uint256 amount,
        bytes32 tripId
    ) external onlyRole(LEDGER_ROLE) {
        _burn(member, amount);
        emit TokensBurnedForUsage(member, amount, tripId);
    }

    /**
     * @notice Refund tokens to a member on trip cancellation. Called by the
     *         ledger only. Does NOT count against the monthly issuance cap —
     *         it is a straight re-mint of tokens that were already burned.
     */
    function refundCancellation(
        address member,
        uint256 amount,
        bytes32 tripId
    ) external onlyRole(LEDGER_ROLE) {
        _mint(member, amount);
        emit TokensRefunded(member, amount, tripId);
    }

    function setMonthlyIssuanceCap(uint256 newCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        monthlyIssuanceCap = newCap;
        emit MonthlyCapUpdated(newCap);
    }
}
