const withCSS = require("@zeit/next-css");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const withFonts = require("next-fonts");

module.exports =
  withCSS(
    withFonts({
      pwa: {
        dest: 'public'
      },
      webpack: (config, { isServer }) => {
        // Fixes npm packages that depend on `fs` module
        if (!isServer) {
          config.node = {
            fs: "empty",
          };
        }
        config.optimization.minimizer = []
        config.optimization.minimize = false;

        config.module.rules.push(
          {
            test: /\.sqrl$/,
            use: "raw-loader",
          });

        config.plugins.push(
          new MonacoWebpackPlugin({
            languages: ["cpp"],
            filename: "static/[name].worker.js",
          })
        );
        return config;
      },
      cssLoaderOptions: { url: false },
    })
  );
