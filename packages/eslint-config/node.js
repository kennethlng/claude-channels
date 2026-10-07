import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * ESLint config for Node + TypeScript library/CLI packages.
 * Adds Node globals and tolerant unused-var handling on top of the base config.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
