import { existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Cache de compilacao nao faz parte do site ou das funcoes executadas.
// A Netlify pode restaurar caches .sst de builds anteriores com variaveis
// sensiveis, mesmo depois que o codigo para de referenciar tais segredos.
// Removemos APENAS esses artefatos descartaveis apos um build bem-sucedido.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const subpath of [".next/cache/turbopack", ".netlify/.next/cache/turbopack"]) {
  const target = resolve(projectRoot, subpath);
  if (!target.startsWith(`${projectRoot}${sep}`)) {
    throw new Error("Caminho de cache fora do projeto.");
  }
  if (!existsSync(target)) continue;
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error(`Cache inesperadamente simbolico: ${subpath}`);
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`Cache temporario de compilacao removido: ${subpath}`);
}
