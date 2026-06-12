import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist-electron/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // We intentionally sync local UI state with props/path on change.
      // This is a valid pattern for the cases in this app.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Electron main/preload 은 CommonJS(.cjs) 라 require() 가 정상이다.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
