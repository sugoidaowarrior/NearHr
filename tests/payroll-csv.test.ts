/**
 * Payroll CSV: parsing, quoting, CRLF, validation, duplicates, the 50 person cap.
 * No DB, no network (parsePayrollCsv is pure).
 */
import "./_setup";
import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePayrollCsv, MAX_EMPLOYEES_PER_RUN } from "../src/lib/payroll";

test("parses a well formed CSV", () => {
  const text = [
    "email,name,amount,near_account",
    "alice@acme.com,Alice,1500,alice.near",
    "bob@acme.com, Bob ,1.5,bob.near",
  ].join("\n");
  const { employees, errors } = parsePayrollCsv(text);
  assert.deepEqual(errors, []);
  assert.equal(employees.length, 2);
  assert.equal(employees[0].email, "alice@acme.com");
  assert.equal(employees[0].name, "Alice");
  assert.equal(employees[0].amount, "1500");
  assert.equal(employees[0].nearAccount, "alice.near");
  assert.equal(employees[1].name, "Bob"); // trimmed
  assert.equal(employees[1].amount, "1.5");
});

test("handles quoted fields with commas and escaped quotes", () => {
  const text = [
    "email,name,amount",
    '"carol@acme.com","Carol, ""the rock"" Jones",99.99',
  ].join("\n");
  const { employees, errors } = parsePayrollCsv(text);
  assert.deepEqual(errors, []);
  assert.equal(employees[0].email, "carol@acme.com");
  assert.equal(employees[0].name, 'Carol, "the rock" Jones');
  assert.equal(employees[0].amount, "99.99");
});

test("handles CRLF line endings", () => {
  const text = "email,name,amount\r\ndan@acme.com,Dan,10\r\n";
  const { employees, errors } = parsePayrollCsv(text);
  assert.deepEqual(errors, []);
  assert.equal(employees.length, 1);
  assert.equal(employees[0].amount, "10");
});

test("empty CSV is an error", () => {
  const { employees, errors } = parsePayrollCsv("");
  assert.equal(employees.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /empty/i);
});

test("header is case insensitive and column order is flexible", () => {
  const { employees, errors } = parsePayrollCsv("NAME,Email,AMOUNT\nZoe,zoe@example.com,42\n");
  assert.deepEqual(errors, []);
  assert.equal(employees[0].email, "zoe@example.com");
  assert.equal(employees[0].name, "Zoe");
});

test("missing required columns is an error", () => {
  const { errors } = parsePayrollCsv("name,amount\nAlice,10\n");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /email.*amount/i);
});

test("invalid and zero and negative amounts are rejected per row", () => {
  const text = [
    "email,name,amount",
    "ok@acme.com,Ok,10",
    "bad1@acme.com,Bad1,1.2345678", // 7 decimals
    "bad2@acme.com,Bad2,0",
    "bad3@acme.com,Bad3,-5",
    "bad4@acme.com,Bad4,abc",
  ].join("\n");
  const { employees, errors } = parsePayrollCsv(text);
  assert.equal(employees.length, 1);
  assert.equal(employees[0].email, "ok@acme.com");
  assert.equal(errors.length, 4);
  for (const e of errors) assert.match(e, /bad amount/);
});

test("invalid emails are rejected with the row number", () => {
  const { employees, errors } = parsePayrollCsv(
    ["email,name,amount", "not-an-email,Nope,10", "ok@acme.com,Ok,10"].join("\n")
  );
  assert.equal(employees.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /row 2/);
  assert.match(errors[0], /invalid email/);
});

test("missing email is rejected", () => {
  const { errors } = parsePayrollCsv(["email,name,amount", ",NoEmail,10"].join("\n"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing email/);
});

test("duplicate emails are rejected (case insensitive)", () => {
  const { employees, errors } = parsePayrollCsv(
    ["email,name,amount", "a@acme.com,One,10", "A@ACME.com,Two,20"].join("\n")
  );
  assert.equal(employees.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate/);
});

test("more than 50 employees is rejected", () => {
  const rows = ["email,name,amount"];
  for (let i = 0; i < MAX_EMPLOYEES_PER_RUN + 1; i++) rows.push(`e${i}@acme.com,E${i},10`);
  const { employees, errors } = parsePayrollCsv(rows.join("\n"));
  assert.equal(employees.length, MAX_EMPLOYEES_PER_RUN + 1); // parsed, then capped
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many/);
});

test("exactly 50 employees is accepted", () => {
  const rows = ["email,name,amount"];
  for (let i = 0; i < MAX_EMPLOYEES_PER_RUN; i++) rows.push(`e${i}@acme.com,E${i},10`);
  const { employees, errors } = parsePayrollCsv(rows.join("\n"));
  assert.deepEqual(errors, []);
  assert.equal(employees.length, MAX_EMPLOYEES_PER_RUN);
});

test("unknown extra columns are ignored", () => {
  const { employees, errors } = parsePayrollCsv(
    ["email,amount,department", "a@acme.com,10,Eng"].join("\n")
  );
  assert.deepEqual(errors, []);
  assert.equal(employees.length, 1);
});
