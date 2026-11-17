import { apiJson, dbRequest } from "../../../../lib/jvg-backend";
import { businessTypeLabel } from "../../../../lib/business-types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [content, plans] = await Promise.all([
      dbRequest<Array<{ id: string; content_type: string; slug: string; title: string; summary: string; body: string; published_at: string }>>(
        "/rest/v1/jvg_platform_content?status=eq.published&select=id,content_type,slug,title,summary,body,published_at&order=published_at.desc&limit=12",
      ),
      dbRequest<Array<{ code: string; name: string; description: string; billing_interval: string; amount_minor: number | null; currency: string; enabled_business_types: string[]; features: Record<string, unknown> }>>(
        "/rest/v1/jvg_subscription_plans?active=eq.true&is_public=eq.true&select=code,name,description,billing_interval,amount_minor,currency,enabled_business_types,features&order=sort_order.asc,name.asc&limit=20",
      ),
    ]);
    return apiJson({
      content: content.map((item) => ({ ...item, body: item.body.slice(0, 6000) })),
      plans: plans.map((plan) => ({
        code: plan.code, name: plan.name, description: plan.description,
        interval: plan.billing_interval,
        amountMinor: Number.isSafeInteger(plan.amount_minor) ? plan.amount_minor : null,
        currency: plan.currency,
        businessTypes: Array.isArray(plan.enabled_business_types) ? plan.enabled_business_types.map(businessTypeLabel) : [],
        features: plan.features,
      })),
    });
  } catch {
    // The public landing page remains available before the optional CMS migration is applied.
    return apiJson({ content: [], plans: [] });
  }
}
