import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".venv"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // refs-паттерн для интервалов — осознанный, warnings допустимы
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["*.ts", "*.js", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
);
