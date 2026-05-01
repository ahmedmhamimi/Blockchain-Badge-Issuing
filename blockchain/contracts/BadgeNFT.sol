// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =============================================================================
// BadgeNFT — Course Completion Badge Token
// =============================================================================
// Architecture:
//   1. Data model: BadgeData struct stored per tokenId.
//   2. Ownership: _owners mapping (tokenId -> address) + _ownedTokens (address -> tokenId[]).
//   3. Soul-bound: transfer / approve / setApprovalForAll all revert.
//   4. Access: onlyIssuer modifier guards mint and revoke.
//   5. Metadata: tokenURI stored on-chain as a string pointing to the API.
//   6. Audit: BadgeMinted and BadgeRevoked events for history queries.
// =============================================================================

contract BadgeNFT {

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    struct BadgeData {
        string  studentName;
        string  courseName;
        string  category;    // "Blockchain" | "Web Dev" | "Security" | "Data Science"
        string  grade;       // "Bronze" | "Silver" | "Gold"
        address recipient;
        uint256 issuedAt;    // block.timestamp at mint
        bool    exists;
    }

    // -------------------------------------------------------------------------
    // State variables
    // -------------------------------------------------------------------------

    address public immutable issuer;
    uint256 public totalSupply; // also serves as the last minted token ID

    mapping(uint256 => address)   private _owners;
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => string)    private _tokenURIs;
    mapping(uint256 => BadgeData) private _badges;
    mapping(uint256 => bool)      private _revoked;
    mapping(uint256 => string)    private _revocationReasons;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event BadgeMinted(
        uint256 indexed tokenId,
        address indexed recipient,
        string  courseName,
        string  category,
        address indexed issuer
    );

    event BadgeRevoked(
        uint256 indexed tokenId,
        string  reason,
        address indexed issuer
    );

    // -------------------------------------------------------------------------
    // Access control
    // -------------------------------------------------------------------------

    modifier onlyIssuer() {
        require(msg.sender == issuer, "Only issuer can perform this action.");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        issuer = msg.sender;
    }

    // -------------------------------------------------------------------------
    // Write functions
    // -------------------------------------------------------------------------

    /// @notice Mint a new soul-bound badge NFT for a student.
    /// @return tokenId The newly minted token ID.
    function mintBadge(
        address         recipient,
        string calldata studentName,
        string calldata courseName,
        string calldata category,
        string calldata grade,
        string calldata uri
    ) external onlyIssuer returns (uint256 tokenId) {
        require(recipient != address(0),      "Recipient cannot be zero address.");
        require(bytes(studentName).length > 0, "Student name is required.");
        require(bytes(courseName).length  > 0, "Course name is required.");
        require(bytes(category).length    > 0, "Category is required.");
        require(bytes(grade).length       > 0, "Grade is required.");
        require(bytes(uri).length         > 0, "Token URI is required.");

        totalSupply += 1;
        tokenId = totalSupply;

        _owners[tokenId]            = recipient;
        _ownedTokens[recipient].push(tokenId);
        _tokenURIs[tokenId]         = uri;

        _badges[tokenId] = BadgeData({
            studentName: studentName,
            courseName:  courseName,
            category:    category,
            grade:       grade,
            recipient:   recipient,
            issuedAt:    block.timestamp,
            exists:      true
        });

        emit BadgeMinted(tokenId, recipient, courseName, category, issuer);
    }

    /// @notice Revoke an existing badge. The record stays on-chain for audit.
    function revokeBadge(
        uint256         tokenId,
        string calldata reason
    ) external onlyIssuer {
        require(_badges[tokenId].exists, "Token does not exist.");
        require(!_revoked[tokenId],      "Badge already revoked.");
        require(bytes(reason).length > 0, "Revocation reason is required.");

        _revoked[tokenId]            = true;
        _revocationReasons[tokenId]  = reason;

        emit BadgeRevoked(tokenId, reason, issuer);
    }

    // -------------------------------------------------------------------------
    // Soul-bound enforcement — all transfer mechanisms revert
    // -------------------------------------------------------------------------

    function transfer(address, uint256) external pure {
        revert("Badges are non-transferable soul-bound tokens.");
    }

    function approve(address, uint256) external pure {
        revert("Badges are non-transferable soul-bound tokens.");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("Badges are non-transferable soul-bound tokens.");
    }

    // -------------------------------------------------------------------------
    // Read functions
    // -------------------------------------------------------------------------

    /// @notice Returns the owner of a token. Reverts if token does not exist.
    function ownerOf(uint256 tokenId) public view returns (address) {
        require(_badges[tokenId].exists, "Token does not exist.");
        return _owners[tokenId];
    }

    /// @notice Returns the metadata URI for a token.
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_badges[tokenId].exists, "Token does not exist.");
        return _tokenURIs[tokenId];
    }

    /// @notice Returns all token IDs owned by a given address.
    function getTokensByOwner(address owner) public view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    /// @notice Returns full badge data for a token.
    function getBadge(uint256 tokenId) public view returns (
        BadgeData memory data,
        bool             revoked,
        string memory    reason,
        string memory    uri
    ) {
        require(_badges[tokenId].exists, "Token does not exist.");
        return (
            _badges[tokenId],
            _revoked[tokenId],
            _revocationReasons[tokenId],
            _tokenURIs[tokenId]
        );
    }

    /// @notice Returns revocation status of a token.
    function isRevoked(uint256 tokenId) public view returns (bool) {
        return _revoked[tokenId];
    }

    /// @notice Safe summary — never reverts. Returns exists=false for missing tokens.
    function getBadgeSummary(uint256 tokenId) public view returns (
        address owner,
        bool    exists,
        bool    revoked,
        string  memory courseName,
        uint256 issuedAt
    ) {
        if (!_badges[tokenId].exists) {
            return (address(0), false, false, "", 0);
        }
        return (
            _owners[tokenId],
            true,
            _revoked[tokenId],
            _badges[tokenId].courseName,
            _badges[tokenId].issuedAt
        );
    }
}
