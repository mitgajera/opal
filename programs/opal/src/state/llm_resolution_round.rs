use anchor_lang::prelude::*;

#[repr(C, packed)]
#[account(zero_copy(unsafe))]
pub struct LlmResolutionRound {
    pub assertion: Pubkey,
    pub dispute: Pubkey,
    pub oracle_job_hash: [u8; 32],
    pub switchboard_program: Pubkey,
    pub switchboard_queue: Pubkey,
    pub switchboard_feed_hash: [u8; 32],
    pub switchboard_quote: Pubkey,
    pub switchboard_quote_slot: u64,
    pub max_staleness_slots: u64,
    pub prompt_hash: [u8; 32],
    pub variable_overrides_hash: [u8; 32],
    pub response_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub outcome: u8,
    pub requested_at: i64,
    pub resolved_at: i64,
    pub challenge_deadline: i64,
    pub bump: u8,
}
