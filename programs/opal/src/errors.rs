use anchor_lang::prelude::*;

#[error_code]
pub enum OpalError {
    #[msg("Invalid assertion state for this transition")]
    InvalidState,
    #[msg("Operation deadline has already passed")]
    DeadlinePassed,
    #[msg("Operation deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Assertion has already been disputed")]
    AssertionAlreadyDisputed,
    #[msg("Vote dispute already exists")]
    VoteDisputeAlreadyExists,
    #[msg("LLM outcome is missing")]
    LlmOutcomeMissing,
    #[msg("Invalid outcome code")]
    InvalidOutcomeCode,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Bond amount is below required minimum")]
    InsufficientBondAmount,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Token mint does not match protocol config")]
    InvalidMint,
    #[msg("Protocol config invariants are invalid")]
    ConfigInvariantViolation,
    #[msg("Dispute has already been settled")]
    AlreadySettled,
    #[msg("Vote is not open")]
    VoteNotOpen,
    #[msg("Voting window is still open")]
    VoteWindowNotClosed,
    #[msg("Challenge deadline is missing")]
    MissingChallengeDeadline,
    #[msg("Assertion statement exceeds max length")]
    StatementTooLong,
    #[msg("Auxiliary hash exceeds max length")]
    AuxiliaryHashTooLong,
    #[msg("Invalid treasury token account")]
    InvalidTreasuryAccount,
    #[msg("Invalid asserter token account")]
    InvalidAsserterTokenAccount,
    #[msg("Invalid disputer token account")]
    InvalidDisputerTokenAccount,
    #[msg("Assertion and related account link mismatch")]
    AssertionLinkMismatch,
    #[msg("Resolution round link mismatch")]
    RoundLinkMismatch,
    #[msg("Insufficient balance in bond vault")]
    InsufficientVaultBalance,
    #[msg("Assertion bond minimum must be greater than zero")]
    InvalidAssertionBondMinimum,
    #[msg("Invalid window configuration")]
    InvalidWindowConfiguration,
    #[msg("Feed account does not match the stored council feed pubkey")]
    WrongFeed,
    #[msg("Failed to parse Switchboard pull-feed account data")]
    FeedParseFailed,
    #[msg("Feed is stale or does not have enough verified oracle signatures")]
    FeedStaleOrUnverified,
    #[msg("Feed returned a value outside the valid verdict range (0–3)")]
    InvalidVerdictEncoding,
    #[msg("Council feeds are not configured — call set_council_feeds first")]
    CouncilFeedsNotConfigured,
    #[msg("Oracle job hash is not configured — call set_oracle_job first")]
    OracleJobHashNotConfigured,
}
