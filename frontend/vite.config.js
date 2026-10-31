import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'planner-offline-manifest',
      apply: 'build',
      enforce: 'post',

      generateBundle(_, bundle) {
        const assets = [
          '/index.html',
          ...Object.keys(bundle)
            .filter(
              (name) =>
                !name.endsWith('.map') &&
                name !== 'index.html'
            )
            .map((name) => `/${name}`),
        ];

        const hash = createHash('sha256');

        for (const [name, item] of Object.entries(bundle)) {
          hash.update(name);
          hash.update(
            item.type === 'chunk'
              ? item.code
              : item.source
          );
        }

        this.emitFile({
          type: 'asset',
          fileName: 'planner-precache.js',
          source:
            `self.PLANNER_BUILD=${JSON.stringify(
              hash.digest('hex').slice(0, 16)
            )};` +
            `self.PLANNER_ASSETS=${JSON.stringify(assets)};`,
        });
      },
    },
  ],
});