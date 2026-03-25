import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'linknotes'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      config: {},
      platforms: ['win32']
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.ts',
        renderer: {
          config: './webpack.renderer.config.ts',
          entryPoints: [
            {
              name: 'main_window',
              html: './src/renderer/index.html',
              js: './src/renderer/main.tsx',
              preload: {
                js: './src/preload/index.ts'
              }
            }
          ]
        }
      }
    }
  ]
};

export default config;