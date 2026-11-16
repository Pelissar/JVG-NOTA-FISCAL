import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/service-orders/route.ts", import.meta.url), "utf8");
const technicians = readFileSync(new URL("../app/api/company/technicians/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20261116_jvg_service_order_technicians.sql", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/erp/service-orders.js", import.meta.url), "utf8");

test("a OS numerada fica com o técnico que confirmar e o comercial pode remover", () => {
  assert.match(route, /jvg_allocate_service_order_number/);
  assert.match(route, /action === "claim"/);
  assert.match(route, /claimed_by !== userId/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /Somente o comercial pode remover/);
  assert.match(ui, /data-os-action="claim"/);
  assert.match(ui, /data-os-action="remove"/);
});

test("o login de técnico não devolve a senha e a migration limita a numeração", () => {
  assert.match(technicians, /role: "technician"/);
  assert.match(technicians, /email_confirm: true/);
  assert.doesNotMatch(technicians, /password: password/);
  assert.match(migration, /'technician'/);
  assert.match(migration, /next_number <= 10000/);
  assert.match(migration, /revoke all on public\.jvg_company_technicians from public, anon, authenticated/);
});
