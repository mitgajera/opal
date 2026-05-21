use crate::{
    constants::{BPS_DENOMINATOR, PROTOCOL_CONFIG_SEED},
    errors::OpalError,
    state::ProtocolConfig,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeProtocolConfigArgs {
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
}

#[derive(Accounts)]
pub struct InitializeProtocolConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<ProtocolConfig>(),
        seeds = [PROTOCOL_CONFIG_SEED],
        bump
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    pub pusd_mint: Account<'info, Mint>,

    #[account(
        token::mint = pusd_mint,
    )]
    pub treasury_pusd: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeProtocolConfig>,
    args: InitializeProtocolConfigArgs,
) -> Result<()> {
    // !TBD: PLACEHOLDER — uncomment before mainnet to restrict init to deployer.
    // require!(ctx.accounts.authority.key() == crate::ID, OpalError::Unauthorized);

    require!(
        args.assertion_bond_min_pusd > 0,
        OpalError::InvalidAssertionBondMinimum
    );
    require!(
        u64::from(args.llm_dispute_bond_ratio_bps) <= BPS_DENOMINATOR,
        OpalError::ConfigInvariantViolation
    );
    require!(
        u64::from(args.vote_dispute_bond_ratio_bps) <= BPS_DENOMINATOR,
        OpalError::ConfigInvariantViolation
    );
    require!(
        u64::from(args.protocol_fee_bps) <= BPS_DENOMINATOR,
        OpalError::ConfigInvariantViolation
    );
    require!(
        u64::from(args.supermajority_bps) <= BPS_DENOMINATOR
            && u64::from(args.supermajority_bps) > BPS_DENOMINATOR / 2,
        OpalError::ConfigInvariantViolation
    );
    require!(
        args.liveness_window_seconds > 0
            && args.llm_challenge_window_seconds > 0
            && args.vote_setup_window_seconds >= 0
            && args.voting_window_seconds > 0,
        OpalError::InvalidWindowConfiguration
    );

    let total_shares = u64::from(args.llm_disputer_reward_share_bps)
        .checked_add(u64::from(args.vote_disputer_reward_share_bps))
        .ok_or(OpalError::MathOverflow)?
        .checked_add(u64::from(args.voter_reward_share_bps))
        .ok_or(OpalError::MathOverflow)?
        .checked_add(u64::from(args.treasury_share_bps))
        .ok_or(OpalError::MathOverflow)?;

    require!(
        total_shares <= BPS_DENOMINATOR,
        OpalError::ConfigInvariantViolation
    );

    let mut config = ctx.accounts.protocol_config.load_init()?;
    config.authority = ctx.accounts.authority.key();
    config.pusd_mint = ctx.accounts.pusd_mint.key();
    config.treasury = ctx.accounts.treasury_pusd.key();
    config.assertion_bond_min_pusd = args.assertion_bond_min_pusd;
    config.llm_dispute_bond_ratio_bps = args.llm_dispute_bond_ratio_bps;
    config.vote_dispute_bond_ratio_bps = args.vote_dispute_bond_ratio_bps;
    config.protocol_fee_bps = args.protocol_fee_bps;
    config.llm_disputer_reward_share_bps = args.llm_disputer_reward_share_bps;
    config.vote_disputer_reward_share_bps = args.vote_disputer_reward_share_bps;
    config.voter_reward_share_bps = args.voter_reward_share_bps;
    config.treasury_share_bps = args.treasury_share_bps;
    config.supermajority_bps = args.supermajority_bps;
    config.liveness_window_seconds = args.liveness_window_seconds;
    config.llm_challenge_window_seconds = args.llm_challenge_window_seconds;
    config.vote_setup_window_seconds = args.vote_setup_window_seconds;
    config.voting_window_seconds = args.voting_window_seconds;
    config.oracle_job_hash = [0u8; 32];
    config.bump = ctx.bumps.protocol_config;

    Ok(())
}
