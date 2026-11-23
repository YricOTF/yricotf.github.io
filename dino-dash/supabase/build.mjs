import { mkdir, readFile, writeFile } from "node:fs/promises";

const output = new URL("./functions/dino-rank/engine/", import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ["replay", "runner", "course", "challenge", "movement", "layouts", "catalog", "sections"]) {
  const source = await readFile(new URL(`../game/${name}.js`, import.meta.url), "utf8");
  await writeFile(new URL(`${name}.js`, output), source.replace(/(\.js)\?v=\d+/g, "$1"));
}
