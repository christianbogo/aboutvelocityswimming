import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/components/{Footer,Hero,ImageWithLightbox,ProductDetailGallery,StoreProductGallery}.tsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
  {
    files: ["src/lib/auth.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "src/lib/**/*.ts",
      "src/app/api/**/*.ts",
      "src/features/swimming/domain/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/*",
                "**/components/collection/*",
                "**/components/data/*",
              ],
              message:
                "Shared contracts and domain rules belong in the owning feature, not a UI component directory.",
            },
          ],
        },
      ],
    },
  },
  // Native gallery images retain source aspect ratios and third-party product URLs.
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "backups/**",
    "scripts/legacy-firebase/**",
    "tests/legacy-firebase/**",
    "firebase/**",
    ".next-velocity-test/**",
  ]),
]);

export default eslintConfig;
