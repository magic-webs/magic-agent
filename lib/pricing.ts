import { api } from "@/convex/_generated/api";
import { publicPricing, type PublicPricing } from "@/convex/lib/plans";
import { convexServerClient } from "@/lib/convex-server";

/** The plans on sale, or the ones billing starts with when Convex is unreachable. */
export async function loadPricing(): Promise<PublicPricing> {
  try {
    return await convexServerClient().query(api.plans.publicCatalogue, {});
  } catch {
    return publicPricing(null, []);
  }
}
