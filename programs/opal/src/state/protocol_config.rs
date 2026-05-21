use anchor_lang::prelude::*;

#[repr(C, packed)]
#[account(zero_copy(unsafe))]
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub pusd_mint: Pubkey,
    pub treasury: Pubkey,
    pub assertion_bond_min_pusd: u64,
    pub llm_dispute_bond_ratio_bps: u16,
    pub vote_dispute_bond_ratio_bps: u16,
    pub protocol_fee_bps: u16,
    pub llm_disputer_reward_share_bps: u16,
    pub vote_disputer_reward_share_bps: u16,
    pub voter_reward_share_bps: u16,
    pub treasury_share_bps: u16,
    pub supermajority_bps: u16,
    pub liveness_window_seconds: i64,
    pub llm_challenge_window_seconds: i64,
    pub vote_setup_window_seconds: i64,
    pub voting_window_seconds: i64,
    pub oracle_job_hash: [u8; 32],
    pub bump: u8,
}
