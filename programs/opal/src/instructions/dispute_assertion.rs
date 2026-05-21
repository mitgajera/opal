use crate::{
    constants::{
        ASSERTION_SEED, ASSERTION_STATE_ASSERTED, ASSERTION_STATE_PENDING_LLM, BOND_VAULT_SEED,
        LLM_DISPUTE_SEED, LLM_ROUND_SEED, OUTCOME_NONE, PROTOCOL_CONFIG_SEED, TIMESTAMP_NONE,
    },
    errors::OpalError,
    state::{AssertionAccount, LlmDisputeAccount, LlmResolutionRound, ProtocolConfig},
    utils::{checked_bps, is_pubkey_default},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DisputeAssertionArgs {
    pub assertion_id: Pubkey,
}

#[derive(Accounts)]
#[instruction(args: DisputeAssertionArgs)]
pub struct DisputeAssertion<'info> {
    #[account(mut)]
    pub disputer: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    pub pusd_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [ASSERTION_SEED, args.assertion_id.as_ref()],
        bump = assertion.load()?.bump,
    )]
    pub assertion: AccountLoader<'info, AssertionAccount>,

    #[account(
        init,
        payer = disputer,
        space = 8 + std::mem::size_of::<LlmDisputeAccount>(),
        seeds = [LLM_DISPUTE_SEED, assertion.key().as_ref()],
        bump
    )]
    pub llm_dispute: AccountLoader<'info, LlmDisputeAccount>,

    #[account(
        init,
        payer = disputer,
        space = 8 + std::mem::size_of::<LlmResolutionRound>(),
        seeds = [LLM_ROUND_SEED, assertion.key().as_ref()],
        bump
    )]
    pub llm_resolution_round: AccountLoader<'info, LlmResolutionRound>,

    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, args.assertion_id.as_ref()],
        bump,
        token::mint = pusd_mint,
        token::authority = assertion,
    )]
    pub bond_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = pusd_mint,
        token::authority = disputer,
    )]
    pub disputer_pusd: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DisputeAssertion>, _args: DisputeAssertionArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let assertion = ctx.accounts.assertion.load()?;
    let protocol_config = ctx.accounts.protocol_config.load()?;

    require!(
        assertion.state == ASSERTION_STATE_ASSERTED,
        OpalError::InvalidState
    );
    require!(now < assertion.liveness_deadline, OpalError::DeadlinePassed);
    require!(
        assertion.dispute_count == 0 && is_pubkey_default(&assertion.llm_dispute),
        OpalError::AssertionAlreadyDisputed
    );

    let bond_amount = checked_bps(
        assertion.assertion_bond_amount_pusd,
        protocol_config.llm_dispute_bond_ratio_bps,
    )?;
    let oracle_job_hash = protocol_config.oracle_job_hash;
    drop(assertion);
    drop(protocol_config);
    require!(bond_amount > 0, OpalError::InsufficientBondAmount);
    require!(
        oracle_job_hash != [0u8; 32],
        OpalError::OracleJobHashNotConfigured
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.disputer_pusd.to_account_info(),
                to: ctx.accounts.bond_vault.to_account_info(),
                authority: ctx.accounts.disputer.to_account_info(),
            },
        ),
        bond_amount,
    )?;

    let llm_round_key = ctx.accounts.llm_resolution_round.key();

    let mut llm_dispute = ctx.accounts.llm_dispute.load_init()?;
    llm_dispute.assertion = ctx.accounts.assertion.key();
    llm_dispute.disputer = ctx.accounts.disputer.key();
    llm_dispute.bond_amount_pusd = bond_amount;
    llm_dispute.created_at = now;
    llm_dispute.resolution_round = llm_round_key;
    llm_dispute.settlement_resolution = OUTCOME_NONE;
    llm_dispute.bump = ctx.bumps.llm_dispute;

    let mut llm_round = ctx.accounts.llm_resolution_round.load_init()?;
    llm_round.assertion = ctx.accounts.assertion.key();
    llm_round.dispute = ctx.accounts.llm_dispute.key();
    llm_round.oracle_job_hash = oracle_job_hash;
    llm_round.switchboard_program = Pubkey::default();
    llm_round.switchboard_queue = Pubkey::default();
    llm_round.switchboard_feed_hash = [0; 32];
    llm_round.switchboard_quote = Pubkey::default();
    llm_round.switchboard_quote_slot = 0;
    llm_round.max_staleness_slots = 0;
    llm_round.prompt_hash = [0; 32];
    llm_round.variable_overrides_hash = [0; 32];
    llm_round.response_hash = [0; 32];
    llm_round.evidence_hash = [0; 32];
    llm_round.outcome = OUTCOME_NONE;
    llm_round.requested_at = now;
    llm_round.resolved_at = TIMESTAMP_NONE;
    llm_round.challenge_deadline = TIMESTAMP_NONE;
    llm_round.bump = ctx.bumps.llm_resolution_round;

    let mut assertion = ctx.accounts.assertion.load_mut()?;
    assertion.state = ASSERTION_STATE_PENDING_LLM;
    assertion.dispute_count = 1;
    assertion.llm_dispute = ctx.accounts.llm_dispute.key();
    assertion.llm_resolution_round = llm_round_key;

    Ok(())
}
