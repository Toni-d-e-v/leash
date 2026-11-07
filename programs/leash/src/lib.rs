//! Leash: onchain spending limits for AI agents.
//!
//! An owner locks tokens in a vault controlled by a `Policy` PDA. An agent
//! session key may move funds out of the vault only through `spend`, which
//! enforces a kill switch, an expiry, a recipient allowlist, a per-transaction
//! cap and a rolling 24h budget. Everything else is owner-only.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface,
    TransferChecked,
};

declare_id!("5tbQ7LteAdDS9MTbLDqaZiHxiPsoY6EuXUoh3KBKN65n");

/// Length of the spending window in seconds (24h).
pub const WINDOW_SECS: i64 = 86_400;
/// Maximum number of allowlisted recipient wallets.
pub const MAX_ALLOWLIST: usize = 8;

#[program]
pub mod leash {
    use super::*;

    /// Owner creates a policy for one agent key and initializes its vault ATA.
    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        policy_id: u64,
        agent: Pubkey,
        per_tx_cap: u64,
        daily_cap: u64,
        expires_at: i64,
        allowlist: Vec<Pubkey>,
    ) -> Result<()> {
        validate_limits(per_tx_cap, daily_cap)?;
        require!(allowlist.len() <= MAX_ALLOWLIST, LeashError::AllowlistTooLong);

        let policy = &mut ctx.accounts.policy;
        policy.set_inner(Policy {
            owner: ctx.accounts.owner.key(),
            agent,
            mint: ctx.accounts.mint.key(),
            policy_id,
            per_tx_cap,
            daily_cap,
            spent_in_window: 0,
            window_start: Clock::get()?.unix_timestamp,
            total_spent: 0,
            expires_at,
            paused: false,
            allowlist,
            bump: ctx.bumps.policy,
        });
        Ok(())
    }

    /// Owner moves tokens from their token account into the vault.
    pub fn deposit(ctx: Context<OwnerTransfer>, amount: u64) -> Result<()> {
        require!(amount > 0, LeashError::InvalidAmount);
        let a = &ctx.accounts;
        let cpi = TransferChecked {
            from: a.owner_token.to_account_info(),
            mint: a.mint.to_account_info(),
            to: a.vault.to_account_info(),
            authority: a.owner.to_account_info(),
        };
        transfer_checked(
            CpiContext::new(a.token_program.to_account_info(), cpi),
            amount,
            a.mint.decimals,
        )
    }

    /// Agent pays a recipient from the vault. Every rule is checked here, in
    /// order, each with its own error. `request_id` binds the payment to one
    /// API request (the 402 nonce); `reason_hash` is sha256 of the agent's
    /// stated reason, so anyone can audit why it paid.
    pub fn spend(
        ctx: Context<Spend>,
        amount: u64,
        request_id: [u8; 32],
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let recipient_token = &ctx.accounts.recipient_token;
        let policy = &mut ctx.accounts.policy;

        // 1. Kill switch
        require!(!policy.paused, LeashError::PolicyPaused);
        // 2. Expiry
        require!(
            policy.expires_at == 0 || now < policy.expires_at,
            LeashError::PolicyExpired
        );
        // 3. Only the current agent key may spend
        require_keys_eq!(
            ctx.accounts.agent.key(),
            policy.agent,
            LeashError::UnauthorizedAgent
        );
        // 4. Recipient must be an allowlisted wallet holding the policy mint
        require!(
            recipient_token.mint == policy.mint
                && policy.allowlist.contains(&recipient_token.owner),
            LeashError::RecipientNotAllowed
        );
        // 5. Per-transaction cap
        require!(
            amount > 0 && amount <= policy.per_tx_cap,
            LeashError::OverPerTxCap
        );
        // 6. Roll the 24h window
        let elapsed = now
            .checked_sub(policy.window_start)
            .ok_or(LeashError::MathOverflow)?;
        if elapsed >= WINDOW_SECS {
            policy.spent_in_window = 0;
            policy.window_start = now;
        }
        // 7. Daily budget
        let spent_in_window = policy
            .spent_in_window
            .checked_add(amount)
            .ok_or(LeashError::MathOverflow)?;
        require!(spent_in_window <= policy.daily_cap, LeashError::OverDailyCap);

        // 8. Transfer with the policy PDA as signer, then record and emit
        let decimals = ctx.accounts.mint.decimals;
        let cpi = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: recipient_token.to_account_info(),
            authority: policy.to_account_info(),
        };
        let id_bytes = policy.policy_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"policy", policy.owner.as_ref(), &id_bytes, &[policy.bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi,
                &[seeds],
            ),
            amount,
            decimals,
        )?;

        policy.spent_in_window = spent_in_window;
        policy.total_spent = policy
            .total_spent
            .checked_add(amount)
            .ok_or(LeashError::MathOverflow)?;

        emit!(SpendEvent {
            policy: policy.key(),
            recipient: recipient_token.owner,
            amount,
            request_id,
            reason_hash,
            spent_in_window,
            ts: now,
        });
        Ok(())
    }

    /// Owner changes the caps and expiry.
    pub fn update_limits(
        ctx: Context<OwnerOnly>,
        per_tx_cap: u64,
        daily_cap: u64,
        expires_at: i64,
    ) -> Result<()> {
        validate_limits(per_tx_cap, daily_cap)?;
        let policy = &mut ctx.accounts.policy;
        policy.per_tx_cap = per_tx_cap;
        policy.daily_cap = daily_cap;
        policy.expires_at = expires_at;
        Ok(())
    }

    /// Owner replaces the recipient allowlist (max 8 wallets).
    pub fn set_allowlist(ctx: Context<OwnerOnly>, allowlist: Vec<Pubkey>) -> Result<()> {
        require!(allowlist.len() <= MAX_ALLOWLIST, LeashError::AllowlistTooLong);
        ctx.accounts.policy.allowlist = allowlist;
        Ok(())
    }

    /// Kill switch: while paused the agent cannot spend. The owner still can withdraw.
    pub fn set_paused(ctx: Context<OwnerOnly>, paused: bool) -> Result<()> {
        ctx.accounts.policy.paused = paused;
        Ok(())
    }

    /// Owner replaces the agent key, instantly revoking the old one.
    pub fn rotate_agent(ctx: Context<OwnerOnly>, new_agent: Pubkey) -> Result<()> {
        ctx.accounts.policy.agent = new_agent;
        Ok(())
    }

    /// Owner pulls tokens from the vault back to their own token account.
    pub fn withdraw(ctx: Context<OwnerTransfer>, amount: u64) -> Result<()> {
        require!(amount > 0, LeashError::InvalidAmount);
        ctx.accounts.vault_to_owner(amount)
    }

    /// Owner drains the vault, closes it and the policy, and gets the rent back.
    pub fn close_policy(ctx: Context<OwnerTransfer>) -> Result<()> {
        let a = &ctx.accounts;
        let balance = a.vault.amount;
        if balance > 0 {
            a.vault_to_owner(balance)?;
        }
        let policy = &a.policy;
        let id_bytes = policy.policy_id.to_le_bytes();
        let seeds: &[&[u8]] = &[b"policy", policy.owner.as_ref(), &id_bytes, &[policy.bump]];
        close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.vault.to_account_info(),
                destination: a.owner.to_account_info(),
                authority: policy.to_account_info(),
            },
            &[seeds],
        ))?;
        ctx.accounts.policy.close(ctx.accounts.owner.to_account_info())
    }
}

fn validate_limits(per_tx_cap: u64, daily_cap: u64) -> Result<()> {
    require!(
        per_tx_cap > 0 && per_tx_cap <= daily_cap,
        LeashError::InvalidLimits
    );
    Ok(())
}

// ---------------------------------------------------------------- state

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub policy_id: u64,
    pub per_tx_cap: u64,
    pub daily_cap: u64,
    pub spent_in_window: u64,
    pub window_start: i64,
    pub total_spent: u64,
    pub expires_at: i64,
    pub paused: bool,
    #[max_len(8)]
    pub allowlist: Vec<Pubkey>,
    pub bump: u8,
}

#[event]
pub struct SpendEvent {
    pub policy: Pubkey,
    /// Recipient wallet (owner of the destination token account).
    pub recipient: Pubkey,
    pub amount: u64,
    pub request_id: [u8; 32],
    pub reason_hash: [u8; 32],
    pub spent_in_window: u64,
    pub ts: i64,
}

#[error_code]
pub enum LeashError {
    #[msg("Policy is paused by its owner")]
    PolicyPaused,
    #[msg("Policy has expired")]
    PolicyExpired,
    #[msg("Signer is not the policy's agent")]
    UnauthorizedAgent,
    #[msg("Recipient is not on the allowlist")]
    RecipientNotAllowed,
    #[msg("Amount is zero or above the per-transaction cap")]
    OverPerTxCap,
    #[msg("Amount would exceed the daily cap")]
    OverDailyCap,
    #[msg("Allowlist has more than 8 entries")]
    AllowlistTooLong,
    #[msg("Caps must be > 0 and per-tx cap <= daily cap")]
    InvalidLimits,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
#[instruction(policy_id: u64)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Policy::INIT_SPACE,
        seeds = [b"policy", owner.key().as_ref(), &policy_id.to_le_bytes()],
        bump,
    )]
    pub policy: Account<'info, Policy>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = policy,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Owner-signed instructions that move tokens between the owner and the vault.
#[derive(Accounts)]
pub struct OwnerTransfer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, has_one = mint)]
    pub policy: Account<'info, Policy>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = policy,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> OwnerTransfer<'info> {
    fn vault_to_owner(&self, amount: u64) -> Result<()> {
        let id_bytes = self.policy.policy_id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            b"policy",
            self.policy.owner.as_ref(),
            &id_bytes,
            &[self.policy.bump],
        ];
        transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: self.owner_token.to_account_info(),
                    authority: self.policy.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            self.mint.decimals,
        )
    }
}

#[derive(Accounts)]
pub struct Spend<'info> {
    pub agent: Signer<'info>,
    #[account(mut, has_one = mint)]
    pub policy: Account<'info, Policy>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = policy,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// Destination token account; its owner must be allowlisted (checked in `spend`).
    #[account(mut)]
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub policy: Account<'info, Policy>,
}
