//! Unit tests for the NearHr invoice contract, run with the near-sdk mock
//! blockchain. No network, no keys: each test gets a fresh in memory chain.
//!
//! Run with:  cargo test
//!
//! The tests cover every access control rule in the contract, because the
//! whole point of this contract is that only the registered relayer and
//! registered employers may write invoice state.
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use near_sdk::env;
use nearhr_invoice::InvoiceContract;

const CONTRACT: &str = "nearhr.invoice.testnet";
const RELAYER: &str = "relay.testnet";
const EMPLOYER_A: &str = "acme.vault.testnet";
const EMPLOYER_B: &str = "globex.vault.testnet";
const OUTSIDER: &str = "mallory.testnet";

/// 1 USDC in base units (NEP 141).
const USDC: u128 = 1_000_000;

fn context(predecessor: &str) -> near_sdk::VMContext {
    let parse = |s: &str| near_sdk::AccountId::new_unvalidated(s.to_string());
    VMContextBuilder::new()
        .current_account_id(parse(CONTRACT))
        .predecessor_account_id(parse(predecessor))
        .block_timestamp(1_700_000_000_000_000_000u64)
        .build()
}

fn fresh() -> InvoiceContract {
    testing_env!(context(RELAYER));
    InvoiceContract::new(RELAYER.to_string(), vec![EMPLOYER_A.to_string(), EMPLOYER_B.to_string()])
}

#[test]
fn init_registers_relayer_and_employers() {
    let c = fresh();
    assert!(c.is_employer(&EMPLOYER_A.to_string()));
    assert!(c.is_employer(&EMPLOYER_B.to_string()));
    assert!(!c.is_employer(&OUTSIDER.to_string()));
    testing_env!(context(RELAYER));
    assert!(c.is_relayer());
    testing_env!(context(EMPLOYER_A));
    assert!(!c.is_relayer());
}

#[test]
#[should_panic(expected = "reinit not allowed")]
fn reinit_is_rejected() {
    let c = fresh();
    // A direct Rust call never persists to the mock storage, so write the
    // initialized state explicitly before attempting a second init. The
    // custom require!(storage_read(b"STATE").is_none(), ...) in the body
    // is what fires (not the #[init] macro guard, which only exists in the
    // generated wasm entrypoint).
    env::state_write(&c);
    testing_env!(context(RELAYER));
    let _ = InvoiceContract::new(RELAYER.to_string(), vec![]);
}

#[test]
fn employer_can_create_invoice_and_read_it_back() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice(
        "acme-001".to_string(),
        EMPLOYER_A.to_string(),
        "client1.testnet".to_string(),
        25 * USDC,
    );
    let inv = c.get("acme-001".to_string());
    assert_eq!(inv.employer, EMPLOYER_A);
    assert_eq!(inv.client, "client1.testnet");
    assert_eq!(inv.amount, 25 * USDC);
    assert_eq!(inv.status, 0);
    assert_eq!(c.status("acme-001".to_string()), 0);
}

#[test]
fn relayer_can_create_invoice_on_behalf_of_an_employer() {
    let mut c = fresh();
    testing_env!(context(RELAYER));
    c.create_invoice(
        "acme-002".to_string(),
        EMPLOYER_A.to_string(),
        "client2.testnet".to_string(),
        USDC,
    );
    assert_eq!(c.status("acme-002".to_string()), 0);
}

#[test]
#[should_panic(expected = "employer not registered")]
fn unregistered_employer_cannot_create_invoice() {
    let mut c = fresh();
    testing_env!(context(OUTSIDER));
    c.create_invoice(
        "x-001".to_string(),
        OUTSIDER.to_string(),
        "c.testnet".to_string(),
        USDC,
    );
}

#[test]
#[should_panic(expected = "only the employer or the relayer")]
fn employer_b_cannot_create_invoice_for_employer_a() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_B));
    c.create_invoice(
        "acme-003".to_string(),
        EMPLOYER_A.to_string(),
        "c.testnet".to_string(),
        USDC,
    );
}

#[test]
#[should_panic(expected = "slug exists")]
fn duplicate_slug_is_rejected() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-001".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), USDC);
    c.create_invoice("acme-001".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 2 * USDC);
}

#[test]
#[should_panic(expected = "amount below 0.1 USDC")]
fn amount_below_min_is_rejected() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-004".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), USDC / 10 - 1);
}

#[test]
fn minimum_amount_is_accepted() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-005".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), USDC / 10);
    assert_eq!(c.get("acme-005".to_string()).amount, 100_000);
}

#[test]
fn relayer_can_mark_paid_and_it_is_idempotent() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-101".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 10 * USDC);
    testing_env!(context(RELAYER));
    c.mark_paid("acme-101".to_string(), "txhash-1111".to_string());
    assert_eq!(c.status("acme-101".to_string()), 2);
    assert_eq!(c.get("acme-101".to_string()).near_tx, "txhash-1111");
    // A relayer retry after a timeout must not fail and must not overwrite.
    c.mark_paid("acme-101".to_string(), "txhash-2222".to_string());
    assert_eq!(c.get("acme-101".to_string()).near_tx, "txhash-1111");
}

#[test]
fn registered_employer_can_mark_own_invoice_paid() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-102".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 5 * USDC);
    c.mark_paid("acme-102".to_string(), "txhash-3333".to_string());
    assert_eq!(c.status("acme-102".to_string()), 2);
}

#[test]
#[should_panic(expected = "only the relayer or an employer may mark paid")]
fn outsider_cannot_mark_paid() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-103".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 5 * USDC);
    testing_env!(context(OUTSIDER));
    c.mark_paid("acme-103".to_string(), "tx".to_string());
}

#[test]
#[should_panic(expected = "no such invoice")]
fn mark_paid_unknown_slug_panics() {
    let mut c = fresh();
    testing_env!(context(RELAYER));
    c.mark_paid("ghost".to_string(), "tx".to_string());
}

#[test]
fn relayer_can_mark_refunded_from_open() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-201".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 5 * USDC);
    testing_env!(context(RELAYER));
    c.mark_refunded("acme-201".to_string());
    assert_eq!(c.status("acme-201".to_string()), 3);
    // Idempotent.
    c.mark_refunded("acme-201".to_string());
    assert_eq!(c.status("acme-201".to_string()), 3);
}

#[test]
fn paid_invoice_can_be_refunded() {
    // The app refunds a paid invoice and then records the refund on chain, so
    // the paid to refunded transition must be legal (and idempotent).
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-202".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 5 * USDC);
    testing_env!(context(RELAYER));
    c.mark_paid("acme-202".to_string(), "tx".to_string());
    c.mark_refunded("acme-202".to_string());
    assert_eq!(c.status("acme-202".to_string()), 3);
    c.mark_refunded("acme-202".to_string());
    assert_eq!(c.status("acme-202".to_string()), 3);
}

#[test]
#[should_panic(expected = "only the relayer or an employer may mark refunded")]
fn outsider_cannot_mark_refunded() {
    let mut c = fresh();
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-203".to_string(), EMPLOYER_A.to_string(), "c.testnet".to_string(), 5 * USDC);
    testing_env!(context(OUTSIDER));
    c.mark_refunded("acme-203".to_string());
}

#[test]
fn only_the_contract_owner_can_rotate_the_relayer() {
    let mut c = fresh();
    // Owner call: predecessor == current account id.
    testing_env!(context(CONTRACT));
    c.set_relayer("newrelay.testnet".to_string());
    testing_env!(context("newrelay.testnet"));
    assert!(c.is_relayer());
}

#[test]
#[should_panic(expected = "only the contract owner")]
fn relayer_cannot_rotate_the_relayer() {
    let mut c = fresh();
    testing_env!(context(RELAYER));
    c.set_relayer("sneaky.testnet".to_string());
}

#[test]
fn only_the_contract_owner_can_register_employers() {
    let mut c = fresh();
    testing_env!(context(CONTRACT));
    c.register_employer("newco.vault.testnet".to_string());
    assert!(c.is_employer(&"newco.vault.testnet".to_string()));
}

#[test]
#[should_panic(expected = "only the contract owner")]
fn outsider_cannot_register_employers() {
    let mut c = fresh();
    testing_env!(context(OUTSIDER));
    c.register_employer(OUTSIDER.to_string());
}

#[test]
fn full_invoice_lifecycle() {
    let mut c = fresh();
    // Employer opens an invoice.
    testing_env!(context(EMPLOYER_A));
    c.create_invoice("acme-999".to_string(), EMPLOYER_A.to_string(), "client9.testnet".to_string(), 123 * USDC);
    assert_eq!(c.status("acme-999".to_string()), 0);
    // The payer delivers the USDC to the vault; the relayer records the tx.
    testing_env!(context(RELAYER));
    c.mark_paid("acme-999".to_string(), "deadbeef".to_string());
    assert_eq!(c.status("acme-999".to_string()), 2);
    let inv = c.get("acme-999".to_string());
    assert_eq!(inv.amount, 123 * USDC);
    assert_eq!(inv.near_tx, "deadbeef");
    assert_eq!(inv.updated_at, 1_700_000_000_000_000_000u64);
}
