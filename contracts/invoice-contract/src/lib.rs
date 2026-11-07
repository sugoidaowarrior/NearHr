use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near, require};

/// 1 USDC = 10^6 (USDC.e NEP 141).
pub const USDC_ONE: u128 = 1_000_000;

#[derive(BorshDeserialize, BorshSerialize, serde::Serialize, Debug, Clone)]
pub struct Invoice {
    pub employer: String,
    pub client: String,
    pub amount: u128, // USDC base units
    pub status: u8,   // 0 open, 1 pending, 2 paid, 3 refunded, 4 void
    pub near_tx: String,
    pub updated_at: u64,
}

#[near(contract_state)]
pub struct InvoiceContract {
    invoices: near_sdk::collections::UnorderedMap<String, Invoice>,
    owners: near_sdk::collections::LookupSet<String>,
    relayer: String,
}

impl Default for InvoiceContract {
    fn default() -> Self {
        Self {
            invoices: near_sdk::collections::UnorderedMap::new(&b"i"[..]),
            owners: near_sdk::collections::LookupSet::new(&b"o"[..]),
            relayer: String::new(),
        }
    }
}

#[near]
impl InvoiceContract {
    /// Create the contract and register the relayer account that may pay gas
    /// for create_invoice / mark_paid / mark_refunded / status / get calls.
    #[init]
    pub fn new(relayer: String, employers: Vec<String>) -> Self {
        require!(env::storage_read(b"STATE").is_none(), "reinit not allowed");
        let mut owners = near_sdk::collections::LookupSet::new(&b"o"[..]);
        for e in employers {
            owners.insert(&e);
        }
        Self {
            invoices: near_sdk::collections::UnorderedMap::new(&b"i"[..]),
            owners,
            relayer,
        }
    }

    /// Only the deployer may rotate the relayer.
    pub fn set_relayer(&mut self, relayer: String) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "only the contract owner"
        );
        self.relayer = relayer;
    }

    /// Only the deployer may register employers.
    pub fn register_employer(&mut self, employer: String) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "only the contract owner"
        );
        self.owners.insert(&employer);
    }

    pub fn is_relayer(&self) -> bool {
        env::predecessor_account_id().to_string() == self.relayer
    }

    pub fn is_employer(&self, employer: &String) -> bool {
        self.owners.contains(employer)
    }

    /// True when the caller is the registered relayer account, OR the caller is
    /// itself a registered employer (which is what the on chain predecessor is
    /// when a call arrives via a NEP 366 meta transaction relayed on their
    /// behalf: the delegate sender becomes the predecessor).
    pub fn is_authorized(&self) -> bool {
        self.is_relayer() || self.owners.contains(&env::predecessor_account_id().to_string())
    }

    /// Employer (or the relayer on their behalf) records a new invoice.
    pub fn create_invoice(&mut self, slug: String, employer: String, client: String, amount: u128) {
        require!(self.is_employer(&employer), "employer not registered");
        require!(
            env::predecessor_account_id().to_string() == employer || self.is_relayer(),
            "only the employer or the relayer"
        );
        require!(self.invoices.get(&slug).is_none(), "slug exists");
        require!(amount >= USDC_ONE / 10, "amount below 0.1 USDC");
        self.invoices.insert(
            &slug,
            &Invoice {
                employer,
                client,
                amount,
                status: 0,
                near_tx: String::new(),
                updated_at: env::block_timestamp(),
            },
        );
    }

    /// The relayer (or the employer via their own meta transaction) marks an
    /// invoice paid once 1Click has delivered the USDC to the employer's wallet.
    pub fn mark_paid(&mut self, slug: String, near_tx: String) {
        require!(self.is_authorized(), "only the relayer or an employer may mark paid");
        let inv = self.invoices.get(&slug).expect("no such invoice");
        if inv.status == 2 {
            return; // idempotent: relayer retry after a timeout
        }
        let updated = Invoice {
            status: 2,
            near_tx,
            updated_at: env::block_timestamp(),
            ..inv
        };
        self.invoices.insert(&slug, &updated);
    }

    /// The relayer (or the employer) marks an invoice refunded when the swap
    /// failed and the client was paid back on their chain.
    pub fn mark_refunded(&mut self, slug: String) {
        require!(self.is_authorized(), "only the relayer or an employer may mark refunded");
        let inv = self.invoices.get(&slug).expect("no such invoice");
        if inv.status == 3 {
            return; // idempotent
        }
        require!(inv.status != 2, "paid invoices cannot be refunded here");
        let updated = Invoice {
            status: 3,
            updated_at: env::block_timestamp(),
            ..inv
        };
        self.invoices.insert(&slug, &updated);
    }

    pub fn status(&self, slug: String) -> u8 {
        let inv = self.invoices.get(&slug).expect("no such invoice");
        inv.status
    }

    pub fn get(&self, slug: String) -> Invoice {
        self.invoices.get(&slug).expect("no such invoice")
    }
}
