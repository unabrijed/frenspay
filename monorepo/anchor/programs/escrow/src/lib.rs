// escrow — per-order on-chain escrow for the stablecoin on/off-ramp (M2).
// One escrow account per order, seeded by the order's reference code. USDC is held in a vault token
// account owned by the escrow PDA. `deposit` is user-signed; `release`/`refund` are authority-signed
// (the platform fee-payer). Both terminal instructions CLOSE the escrow + vault, so a second
// release/refund fails on-chain (account does not exist) — the authoritative double-spend guard.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("9UfJyNduUw6hJexd7zbwc6ivqPLs2ie2edQrqYAYVv3i");

#[program]
pub mod escrow {
    use super::*;

    /// User funds a new per-order escrow vault. `reference` is the order's PAY-XXXXXXXX code.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, reference: String) -> Result<()> {
        require!(reference.len() <= 32, EscrowError::ReferenceTooLong);
        require!(amount > 0, EscrowError::ZeroAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.user = ctx.accounts.user.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.bump = ctx.bumps.escrow;

        // user_token_account -> vault, signed by the user (the token authority).
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

        emit!(Deposited { escrow: escrow.key(), user: escrow.user, amount, reference });
        Ok(())
    }

    /// Platform authority releases the escrowed USDC to the merchant, then closes the escrow.
    pub fn release(ctx: Context<Release>, reference: String) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
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
            amount,
            decimals,
        )?;

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

        emit!(Released { escrow: ctx.accounts.escrow.key(), destination: ctx.accounts.destination.key(), amount });
        Ok(())
    }

    /// Platform authority refunds the escrowed USDC to the user (made whole), then closes the escrow.
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
    pub amount: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: String)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    /// CHECK: recorded as the escrow authority (the platform); not a signer at deposit.
    pub authority: UncheckedAccount<'info>,
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
    /// The user token account that receives the refund (made whole).
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
    pub reference: String,
}

#[event]
pub struct Released {
    pub escrow: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
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
    #[msg("Only the recorded authority may release or refund")]
    Unauthorized,
    #[msg("Token account mint does not match the escrow mint")]
    MintMismatch,
    #[msg("Token account owner mismatch")]
    OwnerMismatch,
}
