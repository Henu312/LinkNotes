import type { RuleSetRule } from 'webpack';

export const rules: RuleSetRule[] = [
  {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    use: {
      loader: 'ts-loader'
    }
  },
  {
    test: /\.css$/,
    use: ['style-loader', 'css-loader']
  },
  {
    test: /native_modules\\.+\.node$/,
    use: 'node-loader'
  },
  {
    test: /\\.(m?js|node)$/,
    parser: {
      amd: false
    },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules'
      }
    }
  }
];