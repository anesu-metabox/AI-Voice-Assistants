import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Neon Auth owns user and session identity for every branch.
  auth: true,
});
