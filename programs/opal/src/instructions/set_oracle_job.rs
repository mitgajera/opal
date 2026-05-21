use crate::{
    constants::PROTOCOL_CONFIG_SEED,
    errors::OpalError,
    state::ProtocolConfig,
};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SetOracleJobArgs {
    pub oracle_job_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct SetOracleJob<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.load()?.bump,
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<SetOracleJob>, args: SetOracleJobArgs) -> Result<()> {
    let mut config = ctx.accounts.protocol_config.load_mut()?;
    require!(
        ctx.accounts.authority.key() == config.authority,
        OpalError::Unauthorized
    );
    require!(
        args.oracle_job_hash != [0u8; 32],
        OpalError::ConfigInvariantViolation
    );
    config.oracle_job_hash = args.oracle_job_hash;
    Ok(())
}
