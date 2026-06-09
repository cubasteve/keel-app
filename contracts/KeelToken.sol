// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract KeelToken is
    Initializable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant LEDGER_ROLE = keccak256("LEDGER_ROLE");

    uint256 public monthlyIssuanceCap;
    mapping(bytes32 => uint256) public monthlyMinted;

    event TokensMinted(address indexed to, uint256 amount, uint256 year, uint256 month);
    event TokensBurnedForUsage(address indexed member, uint256 amount, bytes32 tripId);
    event TokensRefunded(address indexed member, uint256 amount, bytes32 tripId);
    event MonthlyCapUpdated(uint256 newCap);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __ERC20_init("Keel Token", "KEEL");
        __ERC20Burnable_init();
        __AccessControl_init();
        monthlyIssuanceCap = 100 * 10 ** 18;
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
        require(monthlyMinted[key] + amount <= monthlyIssuanceCap, "KeelToken: exceeds monthly cap");
        monthlyMinted[key] += amount;
        _mint(member, amount);
        emit TokensMinted(member, amount, year, month);
    }

    function burnForUsage(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        _burn(member, amount);
        emit TokensBurnedForUsage(member, amount, tripId);
    }

    function refundCancellation(address member, uint256 amount, bytes32 tripId)
        external onlyRole(LEDGER_ROLE)
    {
        _mint(member, amount);
        emit TokensRefunded(member, amount, tripId);
    }

    function setMonthlyIssuanceCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        monthlyIssuanceCap = newCap;
        emit MonthlyCapUpdated(newCap);
    }

    // Required by UUPS — only admin can authorize upgrades
    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
