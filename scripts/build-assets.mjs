// assets/scenes/ にある素材を走査し、assets/manifest.json を作る。素材を置いたり消したりしたら実行する。
// 使い方: node scripts/build-assets.mjs
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const walk = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).flatMap((f) => {
        const p = `${dir}/${f}`;
        return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
      })
    : [];
const files = walk('assets/scenes').filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
writeFileSync(join(root, 'assets/manifest.json'), JSON.stringify({ files }, null, 1) + '\n');
console.log(`assets/manifest.json: ${files.length}ファイル`);
