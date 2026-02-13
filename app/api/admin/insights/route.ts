import OpenAI from "openai";
import { client } from "@/sanity/lib/client";

import {
  ORDERS_LAST_7_DAYS_QUERY,
  ORDER_STATUS_DISTRIBUTION_QUERY,
  TOP_SELLING_PRODUCTS_QUERY,
  PRODUCTS_INVENTORY_QUERY,
  UNFULFILLED_ORDERS_QUERY,
  REVENUE_BY_PERIOD_QUERY,
} from "@/sanity/queries/stats";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

interface InsightResponse {
  executiveSummary: string;
  revenueInsights: string[];
  productInsights: string[];
  inventoryRisks: string[];
  operationalAlerts: string[];
  growthOpportunities: string[];
  recommendedActions: string[];
}

export async function GET() {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

    const [
      recentOrders,
      statusDistribution,
      productSales,
      productsInventory,
      unfulfilledOrders,
      revenuePeriod,
    ] = await Promise.all([
      client.fetch(ORDERS_LAST_7_DAYS_QUERY, {
        startDate: sevenDaysAgo.toISOString(),
      }),
      client.fetch(ORDER_STATUS_DISTRIBUTION_QUERY),
      client.fetch(TOP_SELLING_PRODUCTS_QUERY),
      client.fetch(PRODUCTS_INVENTORY_QUERY),
      client.fetch(UNFULFILLED_ORDERS_QUERY),
      client.fetch(REVENUE_BY_PERIOD_QUERY, {
        currentStart: sevenDaysAgo.toISOString(),
        previousStart: fourteenDaysAgo.toISOString(),
      }),
    ]);

    const currentRevenue = revenuePeriod?.currentPeriod || 0;
    const previousRevenue = revenuePeriod?.previousPeriod || 0;

    const revenueChange =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;

    const avgOrderValue =
      recentOrders.length > 0
        ? recentOrders.reduce((sum: number, o: any) => sum + o.total, 0) /
          recentOrders.length
        : 0;

    const lowStockProducts = productsInventory.filter(
      (p: any) => p.stock <= 5
    );

    const highStockNoSales = productsInventory.filter(
      (p: any) =>
        p.stock > 10 &&
        !productSales.find((s: any) => s.productId === p._id)
    );

    const urgentOrders = unfulfilledOrders.filter((o: any) => {
      const days =
        (now.getTime() - new Date(o.createdAt).getTime()) / 86400000;
      return days > 2;
    });

    const structuredData = {
      revenue: {
        currentRevenue,
        previousRevenue,
        revenueChangePercent: revenueChange.toFixed(2),
        avgOrderValue: avgOrderValue.toFixed(2),
      },
      orders: {
        totalRecentOrders: recentOrders.length,
        statusDistribution,
        urgentOrders: urgentOrders.length,
      },
      products: {
        topSelling: productSales.slice(0, 5),
        lowStockProducts: lowStockProducts.slice(0, 5),
        highStockNoSales: highStockNoSales.slice(0, 5),
      },
    };

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You are a senior e-commerce data analyst.
Return structured JSON only.

Output format:
{
  executiveSummary: string,
  revenueInsights: string[],
  productInsights: string[],
  inventoryRisks: string[],
  operationalAlerts: string[],
  growthOpportunities: string[],
  recommendedActions: string[]
}
          `,
        },
        {
          role: "user",
          content: JSON.stringify(structuredData),
        },
      ],
    });

    const insights: InsightResponse = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    return Response.json({
      success: true,
      insights,
      meta: {
        revenueChangePercent: revenueChange.toFixed(2),
        urgentOrders: urgentOrders.length,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Advanced Insights Error:", error);
    return Response.json(
      { success: false, message: "Failed to generate insights" },
      { status: 500 }
    );
  }
}
