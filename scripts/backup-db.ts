/**
 * Copia de seguridad de la base local (SQLite).
 *
 *   npm run backup
 *
 * Usa `VACUUM INTO`, que hace una copia consistente aunque la app esté
 * escribiendo en ese momento (no es copiar el fichero a pelo). Guarda las
 * últimas 10 copias en `backups/` y las nuevas no se suben a git.
 */

import { copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "../src/lib/db";

const DB_PATH = resolve(process.cwd(), "prisma/dev.db");
const BACKUP_DIR = resolve(process.cwd(), "backups");
const KEEP = 10;

function stamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

async function main() {
  await mkdir(BACKUP_DIR, { recursive: true });

  const target = join(BACKUP_DIR, `prospector-${stamp()}.db`);
  // VACUUM INTO genera una copia consistente con la base abierta.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  const info = await stat(target);
  console.log(`✓ Copia guardada: ${target} (${(info.size / 1024).toFixed(0)} KB)`);

  // Limpieza: sólo las 10 últimas.
  const files = (await readdir(BACKUP_DIR))
    .filter((name) => name.startsWith("prospector-") && name.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of files.slice(KEEP)) {
    await unlink(join(BACKUP_DIR, old));
    console.log(`  · copia antigua eliminada: ${old}`);
  }

  const total = files.length;
  console.log(`Copias guardadas: ${Math.min(total, KEEP)} (se conservan las ${KEEP} últimas)`);

  // Copia de seguridad del esquema, por si cambia la estructura.
  await copyFile(resolve(process.cwd(), "prisma/schema.prisma"), join(BACKUP_DIR, "schema.prisma.bak"));
}

main()
  .catch((err) => {
    console.error("No se pudo hacer la copia:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
