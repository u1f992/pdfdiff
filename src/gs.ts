export async function gsCall(call: () => number | Promise<number>): Promise<number> {
  try {
    return await call();
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "number") {
      return code;
    }
    throw error;
  }
}
