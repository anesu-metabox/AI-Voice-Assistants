/**
 * Utility to check if Mock Mode (standalone frontend development without DB / Backend / Auth) is active.
 */
export function isMockMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_MOCK_MODE === "true" ||
    process.env.MOCK_MODE === "true"
  );
}
