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
            approval_threshold: 0,
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
        let a = ctx.accounts;
        // 1-5: kill switch, expiry, agent key, recipient allowlist, per-tx cap
        a.policy.check_agent_spend(now, a.agent.key(), &a.recipient_token, amount)?;
        // 6-7: roll the 24h window, daily budget
        let spent_in_window = a.policy.roll_and_check_daily(now, amount)?;
        // Large payments need the owner's approval (see `request_spend`)
        require!(
            a.policy.approval_threshold == 0 || amount <= a.policy.approval_threshold,
            LeashError::NeedsApproval
        );
        // 8. Transfer with the policy PDA as signer, record, emit
        pay_out(&a.policy, &a.mint, &a.vault, &a.recipient_token, &a.token_program, amount)?;
        a.policy.record(spent_in_window, amount)?;
        emit!(SpendEvent {
            policy: a.policy.key(),
            recipient: a.recipient_token.owner,
            amount,
            request_id,
            reason_hash,
            spent_in_window,
            ts: now,
        });
        Ok(())
    }

    /// Agent asks the owner to approve a payment above `approval_threshold`.
    /// The same rules as `spend` apply; nothing moves until `approve_spend`.
    pub fn request_spend(
        ctx: Context<RequestSpend>,
        amount: u64,
        request_id: [u8; 32],
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = ctx.accounts;
        a.policy.check_agent_spend(now, a.agent.key(), &a.recipient_token, amount)?;
        a.policy.check_daily_preview(now, amount)?;
        require!(
            a.policy.approval_threshold > 0 && amount > a.policy.approval_threshold,
            LeashError::ApprovalNotRequired
        );
        a.pending.set_inner(PendingSpend {
            policy: a.policy.key(),
            requester: a.agent.key(),
            recipient_token: a.recipient_token.key(),
            amount,
            request_id,
            reason_hash,
            created_at: now,
            bump: ctx.bumps.pending,
        });
        emit!(ApprovalRequested {
            policy: a.policy.key(),
            pending: a.pending.key(),
            recipient: a.recipient_token.owner,
            amount,
            request_id,
            reason_hash,
            ts: now,
        });
        Ok(())
    }

    /// Owner approves a pending payment: rules are re-checked (the allowlist or
    /// budget may have changed), then the vault pays and a `SpendEvent` is emitted.
    pub fn approve_spend(ctx: Context<ResolveSpend>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = ctx.accounts;
        let p = &a.pending;
        require!(
            a.policy.expires_at == 0 || now < a.policy.expires_at,
            LeashError::PolicyExpired
        );
        require!(
            a.policy.allowlist.contains(&a.recipient_token.owner),
            LeashError::RecipientNotAllowed
        );
        require!(p.amount <= a.policy.per_tx_cap, LeashError::OverPerTxCap);
        let spent_in_window = a.policy.roll_and_check_daily(now, p.amount)?;
        pay_out(&a.policy, &a.mint, &a.vault, &a.recipient_token, &a.token_program, p.amount)?;
        a.policy.record(spent_in_window, p.amount)?;
        emit!(SpendEvent {
            policy: a.policy.key(),
            recipient: a.recipient_token.owner,
            amount: p.amount,
            request_id: p.request_id,
            reason_hash: p.reason_hash,
            spent_in_window,
            ts: now,
        });
        Ok(()) // `close = requester` refunds the pending account's rent to the agent
    }

    /// Owner declines a pending payment. Nothing moves; rent goes back to the agent.
    pub fn reject_spend(ctx: Context<ResolveSpend>) -> Result<()> {
        emit!(ApprovalRejected {
            policy: ctx.accounts.policy.key(),
            pending: ctx.accounts.pending.key(),
            request_id: ctx.accounts.pending.request_id,
            ts: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Owner sets the amount above which a payment needs approval (0 = never).
    pub fn set_approval_threshold(ctx: Context<OwnerOnly>, threshold: u64) -> Result<()> {
        ctx.accounts.policy.approval_threshold = threshold;
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

impl Policy {
    /// Spend rules 1-5, in order, each with its own error.
    fn check_agent_spend(
        &self,
        now: i64,
        signer: Pubkey,
        recipient: &InterfaceAccount<TokenAccount>,
        amount: u64,
    ) -> Result<()> {
        // 1. Kill switch
        require!(!self.paused, LeashError::PolicyPaused);
        // 2. Expiry
        require!(self.expires_at == 0 || now < self.expires_at, LeashError::PolicyExpired);
        // 3. Only the current agent key may spend
        require_keys_eq!(signer, self.agent, LeashError::UnauthorizedAgent);
        // 4. Recipient must be an allowlisted wallet holding the policy mint
        require!(
            recipient.mint == self.mint && self.allowlist.contains(&recipient.owner),
            LeashError::RecipientNotAllowed
        );
        // 5. Per-transaction cap
        require!(amount > 0 && amount <= self.per_tx_cap, LeashError::OverPerTxCap);
        Ok(())
    }

    /// Rules 6-7: reset the window after 24h, then check the daily cap.
    /// Returns the new `spent_in_window` (recorded only after the transfer).
    fn roll_and_check_daily(&mut self, now: i64, amount: u64) -> Result<u64> {
        let elapsed = now.checked_sub(self.window_start).ok_or(LeashError::MathOverflow)?;
        if elapsed >= WINDOW_SECS {
            self.spent_in_window = 0;
            self.window_start = now;
        }
        let spent = self.spent_in_window.checked_add(amount).ok_or(LeashError::MathOverflow)?;
        require!(spent <= self.daily_cap, LeashError::OverDailyCap);
        Ok(spent)
    }

    /// Daily-cap check without touching state (used when only requesting approval).
    fn check_daily_preview(&self, now: i64, amount: u64) -> Result<()> {
        let elapsed = now.checked_sub(self.window_start).ok_or(LeashError::MathOverflow)?;
        let base = if elapsed >= WINDOW_SECS { 0 } else { self.spent_in_window };
        let spent = base.checked_add(amount).ok_or(LeashError::MathOverflow)?;
        require!(spent <= self.daily_cap, LeashError::OverDailyCap);
        Ok(())
    }

    fn record(&mut self, spent_in_window: u64, amount: u64) -> Result<()> {
        self.spent_in_window = spent_in_window;
        self.total_spent = self.total_spent.checked_add(amount).ok_or(LeashError::MathOverflow)?;
        Ok(())
    }
}

/// Vault → recipient transfer signed by the policy PDA.
fn pay_out<'info>(
    policy: &Account<'info, Policy>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let id_bytes = policy.policy_id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"policy", policy.owner.as_ref(), &id_bytes, &[policy.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: policy.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
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
    /// Payments above this need the owner's approval (0 = never).
    pub approval_threshold: u64,
}

/// A payment waiting for the owner. PDA seeds: `["pending", policy, request_id]`.
#[account]
#[derive(InitSpace)]
pub struct PendingSpend {
    pub policy: Pubkey,
    pub requester: Pubkey,
    pub recipient_token: Pubkey,
    pub amount: u64,
    pub request_id: [u8; 32],
    pub reason_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

#[event]
pub struct ApprovalRequested {
    pub policy: Pubkey,
    pub pending: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub request_id: [u8; 32],
    pub reason_hash: [u8; 32],
    pub ts: i64,
}

#[event]
pub struct ApprovalRejected {
    pub policy: Pubkey,
    pub pending: Pubkey,
    pub request_id: [u8; 32],
    pub ts: i64,
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
    #[msg("Amount is above the approval threshold: use request_spend")]
    NeedsApproval,
    #[msg("Amount is within the approval threshold: use spend")]
    ApprovalNotRequired,
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
#[instruction(amount: u64, request_id: [u8; 32])]
pub struct RequestSpend<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    pub policy: Account<'info, Policy>,
    #[account(
        init,
        payer = agent,
        space = 8 + PendingSpend::INIT_SPACE,
        seeds = [b"pending", policy.key().as_ref(), &request_id],
        bump,
    )]
    pub pending: Account<'info, PendingSpend>,
    /// Destination token account; checked against the allowlist in `request_spend`.
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

/// Owner approves or rejects a pending payment.
#[derive(Accounts)]
pub struct ResolveSpend<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, has_one = mint)]
    pub policy: Account<'info, Policy>,
    #[account(
        mut,
        close = requester,
        has_one = policy,
        has_one = requester,
        has_one = recipient_token,
    )]
    pub pending: Account<'info, PendingSpend>,
    /// CHECK: the agent that paid the pending account's rent; refunded on close.
    #[account(mut)]
    pub requester: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = policy,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub policy: Account<'info, Policy>,
}
