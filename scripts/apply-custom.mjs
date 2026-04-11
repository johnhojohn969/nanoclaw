/**
 * Prebuild: copy custom overlay files into their target locations.
 *
 * Overlays:
 *   custom/src/*.ts     → src/          (TypeScript overrides)
 *   custom/host-exec/*  → host-exec/    (host exec webhook server)
 *
 * The copies are gitignored — source of truth lives in custom/.
 */
import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

function copyDir(srcDir, destDir) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(srcDir)) {
    copyFileSync(join(srcDir, file), join(destDir, file));
    console.log(`apply-custom: ${srcDir}/${file} → ${destDir}/${file}`);
  }
}

// TypeScript source overrides
copyDir('custom/src', 'src');

// Host exec webhook server
copyDir('custom/host-exec', 'host-exec');
