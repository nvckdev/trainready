import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Expo app IS linted now. It was ignored wholesale until 2026-08-05,
    // which meant `expo lint` walked up to this config, found every mobile
    // file ignored, and errored out — the app was never linted once in its
    // life. Only generated/vendored trees are skipped here.
    "mobile/node_modules/**",
    "mobile/.expo/**",
    "mobile/dist-check/**",
    "mobile/shims/**",
    // The engine symlink resolves back into engine/, already linted at its
    // real path — linting it twice would double every finding.
    "mobile/engine/**",
  ]),
  {
    // Metro's config and Expo's scaffold scripts are CommonJS by requirement —
    // Metro loads metro.config.js with require(), so ESM there breaks the
    // bundler. Not a style choice to correct.
    files: ["mobile/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // React Native, not the DOM. Next's web rules are the wrong referee for an
    // Expo app: everything here is a <Text>/<View>, never HTML.
    files: ["mobile/**/*.{ts,tsx}"],
    rules: {
      // JSX text in RN is a string prop, not markup — there is no entity to
      // escape, and `don't` is exactly what should render.
      "react/no-unescaped-entities": "off",
      // Next-specific web rules that cannot apply to a native app.
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-page-custom-font": "off",
      // Pre-existing findings from the first-ever lint of this app
      // (2026-08-05). Both are real but bounded, and neither is a crash:
      //   react-hooks/refs — `useRef(new Animated.Value(x)).current`, the
      //     common RN idiom, which also re-allocates the Value every render.
      //   react-hooks/set-state-in-effect — guarded populate-once effects
      //     that cost one extra render pass.
      // Held as warnings so they stay VISIBLE and counted while they are
      // scoped, not silenced. verify.sh pins the count, so a NEW one blocks —
      // the same contract as scripts/invariants-baseline.txt.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
