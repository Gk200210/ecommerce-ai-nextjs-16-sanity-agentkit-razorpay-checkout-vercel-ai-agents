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

interface OrderItem {
  quantity: number;
  priceAtPurchase: number;
  productName: string;
  productId: string;
}

interface Order {
  _id: string;
  orderNumber: string;
  total: number;
  status: string;
  createdAt: string;
  itemCount: number;
  items: OrderItem[];
}

interface StatusDistribution {
  paid: number;
  shipped: number;
  delivered: number;
  cancelled: number;
}

interface ProductSale {
  productId: string;
  productName: string;
  productPrice: number;
  quantity: number;
}

interface Product {
  _id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

interface UnfulfilledOrder {
  _id: string;
  orderNumber: string;
  total: number;
  createdAt: string;
  email: string;
  itemCount: number;
}

interface RevenuePeriod {
  currentPeriod: number;
  previousPeriod: number;
  currentOrderCount: number;
  previousOrderCount: number;
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
      client.fetch<Order[]>(ORDERS_LAST_7_DAYS_QUERY, {
        startDate: sevenDaysAgo.toISOString(),
      }),
      client.fetch<StatusDistribution>(ORDER_STATUS_DISTRIBUTION_QUERY),
      client.fetch<ProductSale[]>(TOP_SELLING_PRODUCTS_QUERY),
      client.fetch<Product[]>(PRODUCTS_INVENTORY_QUERY),
      client.fetch<UnfulfilledOrder[]>(UNFULFILLED_ORDERS_QUERY),
      client.fetch<RevenuePeriod>(REVENUE_BY_PERIOD_QUERY, {
        currentStart: sevenDaysAgo.toISOString(),
        previousStart: fourteenDaysAgo.toISOString(),
      }),
    ]);

    const productSalesMap = new Map<
      string,
      { name: string; totalQuantity: number; revenue: number }
    >();

    for (const sale of productSales) {
      if (!sale.productId) continue;
      const existing = productSalesMap.get(sale.productId);
      if (existing) {
        existing.totalQuantity += sale.quantity;
        existing.revenue += sale.quantity * (sale.productPrice || 0);
      } else {
        productSalesMap.set(sale.productId, {
          name: sale.productName || "Unknown",
          totalQuantity: sale.quantity,
          revenue: sale.quantity * (sale.productPrice || 0),
        });
      }
    }

    const topProducts = Array.from(productSalesMap.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5);

    const productSalesById = new Map(
      Array.from(productSalesMap.entries()).map(([id, data]) => [
        id,
        data.totalQuantity,
      ])
    );

    const needsRestock = productsInventory
      .filter((p) => (productSalesById.get(p._id) || 0) > 0 && p.stock <= 5)
      .slice(0, 5);

    const slowMoving = productsInventory
      .filter((p) => (productSalesById.get(p._id) || 0) === 0 && p.stock > 10)
      .slice(0, 5);

    const getDaysSinceOrder = (createdAt: string) =>
      Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000);

    const currentRevenue = revenuePeriod.currentPeriod || 0;
    const previousRevenue = revenuePeriod.previousPeriod || 0;

    const revenueChange =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;

    const avgOrderValue =
      recentOrders.length > 0
        ? recentOrders.reduce((sum, o) => sum + o.total, 0) /
          recentOrders.length
        : 0;

    const dataSummary = {
      salesTrends: {
        currentWeekRevenue: currentRevenue,
        previousWeekRevenue: previousRevenue,
        revenueChangePercent: revenueChange.toFixed(1),
        currentWeekOrders: revenuePeriod.currentOrderCount || 0,
        previousWeekOrders: revenuePeriod.previousOrderCount || 0,
        avgOrderValue: avgOrderValue.toFixed(2),
        topProducts,
      },
      inventory: {
        needsRestock,
        slowMoving,
      },
      operations: {
        statusDistribution,
        urgentOrders: unfulfilledOrders.filter(
          (o) => getDaysSinceOrder(o.createdAt) > 2
        ).length,
      },
    };

    // 🔥 OPENAI CALL
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are an expert e-commerce analytics assistant. Return JSON only.",
        },
        {
          role: "user",
          content: `Analyze store data:\n${JSON.stringify(
            dataSummary,
            null,
            2
          )}`,
        },
      ],
    });

    const text = completion.choices[0].message.content || "";

    let insights;
    try {
      insights = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch {
      insights = { error: "AI response parsing failed" };
    }

    return Response.json({
      success: true,
      insights,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed:", error);
    return Response.json({ success: false }, {  status: 500 });
  }
}
