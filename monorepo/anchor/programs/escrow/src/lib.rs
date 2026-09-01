// escrow — per-order on-chain escrow for the stablecoin on/off-ramp (M2, rebuilt 2026-08-30).
// One escrow account per order, seeded by the order's reference code. USDC is held in a vault token
// account owned by the escrow PDA. `deposit` is user-signed AND authority-signed; `release`/`refund`
// are authority-signed (the platform fee-payer). Both terminal instructions CLOSE the escrow + vault,
// so a second release/refund fails on-chain (account does not exist) — the authoritative double-spend
// guard, and the one fact the backend uses to tell "already settled" from "never sent".
//
// The platform fee lives INSIDE the escrow (docs/15). The vault holds the full amount; `release`
// pays the LP `amount − fee` and the earnings wallet `fee` in one instruction; `refund` returns the
// whole amount. Before this the fee left for the fee-payer's own token account at deposit time so a
// refund could claw it back — which made the fee-payer a fee sink as well as a gas payer, and made
// every refund a two-transfer tx. Now the fee-payer holds gas and nothing else.
//
// LAYOUT: `Escrow` changed shape here (fee, platform). That is safe ONLY because this is a NEW program
// id with zero live escrows. Never change this struct on an in-place upgrade without a version field.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("9UfJyNduUw6hJexd7zbwc6ivqPLs2ie2edQrqYAYVv3i");

#[program]
pub mod escrow {
    use super::*;

    /// User funds a new per-order escrow vault. `reference` is the order's PAY-XXXXXXXX code; `fee` is
    /// the platform's cut, carried inside `amount` and paid out only on release.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, fee: u64, reference: String) -> Result<()> {
        require!(reference.len() <= 32, EscrowError::ReferenceTooLong);
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(fee < amount, EscrowError::FeeTooLarge);

        let escrow = &mut ctx.accounts.escrow;
        escrow.user = ctx.accounts.user.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.fee = fee;
        escrow.platform = ctx.accounts.platform.key();
        escrow.bump = ctx.bumps.escrow;

        // user_token_account -> vault, signed by the user (the token authority). The FULL amount.
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Deposited { escrow: escrow.key(), user: escrow.user, amount, fee, reference });
        Ok(())
    }

    /// Platform authority releases the escrowed USDC: `amount − fee` to the merchant, `fee` to the
    /// earnings wallet recorded at deposit, then closes the escrow.
    pub fn release(ctx: Context<Release>, reference: String) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        let fee = ctx.accounts.escrow.fee;
        let bump_seed = [ctx.accounts.escrow.bump];
        let decimals = ctx.accounts.mint.decimals;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", reference.as_bytes(), &bump_seed]];

        // vault -> destination (merchant), signed by the escrow PDA.
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            amount - fee,
            decimals,
        )?;

        // vault -> platform earnings, same signer. Skipped when there is no fee (a non-primary leg
        // of a split payment) so the vault still empties and closes.
        if fee > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.platform_ata.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                decimals,
            )?;
        }

        // Reclaim the vault's rent to the authority; the escrow account is closed via `close`.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(Released {
            escrow: ctx.accounts.escrow.key(),
            destination: ctx.accounts.destination.key(),
            amount: amount - fee,
            fee,
        });
        Ok(())
    }

    /// Platform authority refunds the whole escrowed amount — fee included — to the user, then closes
    /// the escrow. One transfer: the fee never left the vault, so there is nothing to claw back.
    pub fn refund(ctx: Context<Refund>, reference: String) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        let bump_seed = [ctx.accounts.escrow.bump];
        let decimals = ctx.accounts.mint.decimals;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", reference.as_bytes(), &bump_seed]];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer_seeds,
        ))?;

        emit!(Refunded { escrow: ctx.accounts.escrow.key(), user: ctx.accounts.destination.key(), amount });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub user: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    /// The full deposit, fee included.
    pub amount: u64,
    /// The platform's cut, paid to `platform`'s token account on release; returned to the user on refund.
    pub fee: u64,
    /// The earnings wallet OWNER. Release pays its associated token account for `mint`.
    pub platform: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(amount: u64, fee: u64, reference: String)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    /// The platform: recorded as the escrow authority AND a signer at deposit, so nobody but the
    /// platform can create an escrow under a reference — a squatted PDA can never be funded or
    /// released. Costs nothing: the fee-payer is this same key and already signs the tx.
    pub authority: Signer<'info>,
    /// CHECK: the earnings wallet owner, recorded only. Release constrains the payout account to it.
    pub platform: UncheckedAccount<'info>,
    #[account(
        init,
        payer = fee_payer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", reference.as_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = fee_payer,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token_account.mint == mint.key() @ EscrowError::MintMismatch,
        constraint = user_token_account.owner == user.key() @ EscrowError::OwnerMismatch,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(reference: String)]
pub struct Release<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", reference.as_bytes()],
        bump = escrow.bump,
        has_one = authority @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        close = authority
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    /// The merchant treasury token account that receives the released USDC.
    #[account(mut, constraint = destination.mint == mint.key() @ EscrowError::MintMismatch)]
    pub destination: Account<'info, TokenAccount>,
    /// The earnings wallet's token account — owned by the `platform` recorded at deposit, no other.
    #[account(
        mut,
        constraint = platform_ata.mint == mint.key() @ EscrowError::MintMismatch,
        constraint = platform_ata.owner == escrow.platform @ EscrowError::PlatformMismatch,
    )]
    pub platform_ata: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(reference: String)]
pub struct Refund<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", reference.as_bytes()],
        bump = escrow.bump,
        has_one = authority @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        close = authority
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    /// The user token account that receives the refund (made whole, fee included).
    #[account(mut, constraint = destination.mint == mint.key() @ EscrowError::MintMismatch)]
    pub destination: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct Deposited {
    pub escrow: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub reference: String,
}

#[event]
pub struct Released {
    pub escrow: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct Refunded {
    pub escrow: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Reference too long (max 32 bytes)")]
    ReferenceTooLong,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Fee must be smaller than the amount")]
    FeeTooLarge,
    #[msg("Only the recorded authority may release or refund")]
    Unauthorized,
    #[msg("Token account mint does not match the escrow mint")]
    MintMismatch,
    #[msg("Token account owner mismatch")]
    OwnerMismatch,
    #[msg("Earnings account is not owned by the platform recorded at deposit")]
    PlatformMismatch,
}
