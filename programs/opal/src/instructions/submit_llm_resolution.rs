use crate::{
    constants::{
        ASSERTION_SEED, ASSERTION_STATE_ASSERTED_LLM, ASSERTION_STATE_PENDING_LLM,
        LLM_ROUND_SEED, OUTCOME_UNRESOLVABLE, PROTOCOL_CONFIG_SEED,
    },
    errors::OpalError,
    state::{AssertionAccount, LlmResolutionRound, ProtocolConfig},
    utils::checked_add_i64,
};
use anchor_lang::prelude::*;
use switchboard_on_demand::prelude::rust_decimal::prelude::ToPrimitive;
use switchboard_on_demand::prelude::PullFeedAccountData;

#[derive(Accounts)]
pub struct SubmitLlmResolution<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [ASSERTION_SEED, assertion.load()?.id.as_ref()],
        bump = assertion.load()?.bump,
    )]
    pub assertion: AccountLoader<'info, AssertionAccount>,

    #[account(
        mut,
        seeds = [LLM_ROUND_SEED, assertion.key().as_ref()],
        bump = llm_resolution_round.load()?.bump,
    )]
    pub llm_resolution_round: AccountLoader<'info, LlmResolutionRound>,

    /// CHECK: Oracle quote account from Switchboard On-Demand
    pub oracle_quote: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SubmitLlmResolution>) -> Result<()> {
    let assertion_state = ctx.accounts.assertion.load()?.state;
    require!(
        assertion_state == ASSERTION_STATE_PENDING_LLM,
        OpalError::InvalidState
    );

    let round = ctx.accounts.llm_resolution_round.load()?;
    let oracle_job_hash = round.oracle_job_hash;
    drop(round);

    let protocol_config = ctx.accounts.protocol_config.load()?;
    let challenge_window = protocol_config.llm_challenge_window_seconds;
    require!(
        oracle_job_hash == protocol_config.oracle_job_hash,
        OpalError::ConfigInvariantViolation
    );
    drop(protocol_config);

    let clock = Clock::get()?;

    let quote_data = ctx.accounts.oracle_quote.try_borrow_data()?;
    let feed = PullFeedAccountData::parse(quote_data)
        .map_err(|_| error!(OpalError::FeedParseFailed))?;

    let value = feed
        .get_value(clock.slot, 250, 3, false)
        .map_err(|_| error!(OpalError::FeedStaleOrUnverified))?;

    require!(value.is_integer(), OpalError::InvalidVerdictEncoding);
    let verdict = value.to_u8().ok_or(OpalError::InvalidVerdictEncoding)?;
    require!(verdict <= OUTCOME_UNRESOLVABLE, OpalError::InvalidVerdictEncoding);

    let now = clock.unix_timestamp;
    let challenge_deadline = checked_add_i64(now, challenge_window)?;

    let mut round = ctx.accounts.llm_resolution_round.load_mut()?;
    round.outcome = verdict;
    round.resolved_at = now;
    round.challenge_deadline = challenge_deadline;
    drop(round);

    let mut assertion = ctx.accounts.assertion.load_mut()?;
    assertion.state = ASSERTION_STATE_ASSERTED_LLM;
    assertion.llm_challenge_deadline = challenge_deadline;

    Ok(())
}
