import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { whatsappLink } from "../lib/whatsapp-link.ts";

const events = readFileSync(new URL("../app/api/service-orders/events/route.ts", import.meta.url), "utf8");
const orders = readFileSync(new URL("../app/api/service-orders/route.ts", import.meta.url), "utf8");

test("o WhatsApp só abre o aplicativo oficial e exige telefone com DDD", () => {
  assert.equal(whatsappLink("(18) 99999-0000", "OS-00001"), "https://wa.me/5518999990000?text=OS-00001");
  assert.equal(whatsappLink("123", "oi"), "");
  assert.match(events, /whatsappLink\(phone, message\)/);
  assert.match(readFileSync(new URL("../public/erp/service-orders.js", import.meta.url), "utf8"), /https:\/\/wa\.me\//);
  assert.doesNotMatch(events, /graph\.facebook|api\.whatsapp/);
  assert.match(orders, /event_type: eventType/);
});
