import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    files: [
      "bin/auth-manager.js",
      "bin/integration-manager.js",
      "bin/live/**/*.js",
    ],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["integration/companion.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
