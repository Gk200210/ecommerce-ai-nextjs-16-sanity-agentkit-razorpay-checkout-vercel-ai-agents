"use server";

import Razorpay from "razorpay";
import { auth, currentUser } from "@clerk/nextjs/server";
import { client } from "@/sanity/lib/client";
import { PRODUCTS_BY_IDS_QUERY } from "@/sanity/queries/products";

const ORDER_QUERY = `
  *[_type == "order" && razorpayPaymentId == $paymentId][0]{
    orderNumber,
    email,
    total,
    status,
    address,
    items[]{
      quantity,
      priceAtPurchase,
      product->{ name }
    }
  }
`;
/**
 * Get Razorpay instance with lazy initialization
 * Only initializes when actually needed
 */
function getRazorpayInstance() {
  if (
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
    throw new Error("Razorpay keys are not defined. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your environment variables.");
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

/* ------------------ Types ------------------ */

interface CartItem {
  productId: string;
  quantity: number;
}

interface CheckoutResult {
  success: boolean;
  order?: {
    id: string;
    amount: number|string;
    currency: string;
  };
  error?: string;
}

/* ------------------ MAIN FUNCTION ------------------ */

export async function createCheckoutSession(
  items: CartItem[]
): Promise<CheckoutResult> {
  try {
    /* 1. Auth */
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return { success: false, error: "Please sign in to checkout" };
    }

    if (!items.length) {
      return { success: false, error: "Your cart is empty" };
    }

    /* 2. Fetch products from Sanity */
    const productIds = items.map((i) => i.productId);
    const products = await client.fetch(PRODUCTS_BY_IDS_QUERY, {
      ids: productIds,
    });

    /* 3. Validate & calculate total */
    let totalAmount = 0;

    for (const item of items) {
      const product = products.find(
        (p: any) => p._id === item.productId
      );

      if (!product) {
        return {
          success: false,
          error: "One or more products are unavailable",
        };
      }

      if ((product.stock ?? 0) < item.quantity) {
        return {
          success: false,
          error: `Only ${product.stock} of "${product.name}" available`,
        };
      }

      totalAmount += (product.price ?? 0) * item.quantity;
    }

    /* 4. Create Razorpay Order (THIS IS THE CHECKOUT SESSION) */
    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // paise
      currency: "INR",
      receipt: `order_${Date.now()}`,
      notes: {
        clerkUserId: userId,
        email: user.emailAddresses[0]?.emailAddress ?? "",
      },
    });

    return {
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    };
  } catch (err) {
    console.error("Checkout error:", err);
    return {
      success: false,
      error: "Something went wrong. Please try again.",
    };
  }
}

export async function getRazorpayOrder(paymentId: string) {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false };

    const order = await client.fetch(ORDER_QUERY, { paymentId });
    if (!order) return { success: false };

    return {
      success: true,
      order: {
        customerEmail: order.email,
        customerName: order.address?.name,
        amountTotal: order.total,
        paymentStatus: order.status,
        shippingAddress: order.address,
        lineItems: order.items.map((i: any) => ({
          name: i.product?.name,
          quantity: i.quantity,
          amount: i.priceAtPurchase,
        })),
      },
    };
  } catch (e) {
    return { success: false };
  }
}