import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
async function main() {
  assert.ok(process.env.DATABASE_URL?.startsWith("file:/tmp/"), "Se requiere una base temporal");
  assert.equal(await prisma.conversation.count(), 0, "El seed no debe crear conversaciones");
  assert.equal(await prisma.activity.count({ where: { type: "inbox.reply" } }), 0, "El seed no debe crear respuestas");
  console.log("PASS: seed sin conversaciones ni respuestas de ejemplo");
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
