import type { Configuration } from 'webpack';

const rules = [
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
  }
];

const config: Configuration = {
  module: {
    rules
  },
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json']
  }
};

export default config;
