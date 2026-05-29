const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  mode: "production",
  entry: {
    options: "./src/options/options.js",
    contentScript: "./src/contentScript.js",
    background: "./src/background.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  performance: {
    assetFilter: (assetFilename) => assetFilename !== "background.js",
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      filename: "options.html",
      template: "./src/options/options.html",
      chunks: ["options"],
    }),
    new webpack.ProvidePlugin({
      process: "process/browser",
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: "." },
        { from: "icon.png", to: "." },
      ],
    }),
  ],
  resolve: {
    fallback: {},
  },
};
