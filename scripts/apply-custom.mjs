/**
 * Prebuild: copy custom/src/*.ts → src/
 * Files in custom/src/ override or extend upstream src/ files.
 * The copies in src/ are gitignored — source of truth lives in custom/src/.
 */
import { readdirSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const customSrc = 'custom/src';
const targetSrc = 'src';

if (existsSync(customSrc)) {
  for (const file of readdirSync(customSrc)) {
    if (file.endsWith('.ts')) {
      copyFileSync(join(customSrc, file), join(targetSrc, file));
      console.log(`apply-custom: ${customSrc}/${file} → ${targetSrc}/${file}`);
    }
  }
}
