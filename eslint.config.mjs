import js from "@eslint/js";
import checkFile from "eslint-plugin-check-file";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

const tsFiles = ["src/**/*.{ts,tsx}"];

const typedTypeScriptConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({
  ...config,
  files: tsFiles,
}));

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
    ],
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
  },

  ...typedTypeScriptConfigs,

  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "check-file": checkFile,
      "import-x": importX,
    },
    rules: {
      "prefer-const": "error",
      "no-var": "error",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      "@typescript-eslint/array-type": [
        "error",
        {
          default: "generic",
          readonly: "generic",
        },
      ],

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],

      "@typescript-eslint/consistent-type-definitions": ["error", "type"],

      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],

      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        {
          accessibility: "explicit",
        },
      ],

      "@typescript-eslint/no-empty-object-type": [
        "error",
        {
          allowInterfaces: "never",
        },
      ],

      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Do not use TypeScript enums. Prefer readonly objects plus union types.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Do not use default exports unless the framework requires it.",
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Do not use process.env directly. Import validated env values from process-env.ts.",
        },
      ],

      "check-file/filename-naming-convention": [
        "error",
        {
          "src/**/*.{ts,tsx}": "KEBAB_CASE",
          "src/**/components/**/*.{ts,tsx}": "PASCAL_CASE",
        },
        {
          ignoreMiddleExtensions: true,
        },
      ],
    },
  },

  {
    files: [
      "src/**/app/**/page.tsx",
      "src/**/app/**/layout.tsx",
      "src/**/pages/**/*.{ts,tsx}",
      "src/**/*.config.{ts,mts,cts}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Do not use TypeScript enums. Prefer readonly objects plus union types.",
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Do not use process.env directly. Import validated env values from process-env.ts.",
        },
      ],
      "check-file/filename-naming-convention": "off",
    },
  },

  {
    files: ["src/**/*.d.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-restricted-syntax": "off",
    },
  },
);
