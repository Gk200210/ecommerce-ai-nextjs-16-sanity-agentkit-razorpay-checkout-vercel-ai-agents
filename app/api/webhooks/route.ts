import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { client, writeClient } from "@/sanity/lib/client";

// 🔎 GROQ query to prevent duplicate orders
const ORDER_BY_RAZORPAY_PAYMENT_ID_QUERY = `
  *[_type == "order" && razorpayPaymentId == $razorpayPaymentId][0]
`;

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = headers();
  const signature = (await headersList).get("x-razorpay-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // ✅ Verify webhook authenticity
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");

  if (expectedSignature !== signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body);

  // We only care about successful payments
  if (event.event !== "payment.captured") {
    return NextResponse.json({ received: true });
  }

  const payment = event.payload.payment.entity;

  await handlePaymentCaptured(payment);

  return NextResponse.json({ received: true });
}

async function handlePaymentCaptured(payment: any) {
  const razorpayPaymentId = payment.id;
  const razorpayOrderId = payment.order_id;

  try {
    // 🛑 Prevent duplicate processing (idempotency)
    const existingOrder = await client.fetch(
      ORDER_BY_RAZORPAY_PAYMENT_ID_QUERY,
      { razorpayPaymentId }
    );

    if (existingOrder) {
      console.log("Webhook already processed, skipping");
      return;
    }

    // 📦 Get metadata you attached while creating Razorpay order
    const notes = payment.notes || {};
    const {
      clerkUserId,
      userEmail,
      sanityCustomerId,
      productIds: productIdsString,
      quantities: quantitiesString,
      customerName,
    } = notes;

    if (!productIdsString || !quantitiesString) {
      console.error("Missing order metadata in Razorpay notes");
      return;
    }

    const productIds = productIdsString.split(",");
    const quantities = quantitiesString.split(",").map(Number);

    // 🧮 Build order items
    const orderItems = productIds.map((productId: string, index: number) => ({
      _key: `item-${index}`,
      product: { _type: "reference" as const, _ref: productId },
      quantity: quantities[index],
      priceAtPurchase: payment.amount / 100 / productIds.length, // adjust logic if needed
    }));

    // 🔢 Generate order number
    const orderNumber = `ORD-${Date.now()
      .toString(36)
      .toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // 📍 Address (Razorpay doesn't provide full shipping address by default)
    const address = {
      name: customerName ?? "",
      line1: "",
      city: "",
      postcode: "",
      country: "IN",
    };

    // 🧾 Create order in Sanity
    const order = await writeClient.create({
      _type: "order",
      orderNumber,
      ...(sanityCustomerId && {
        customer: { _type: "reference", _ref: sanityCustomerId },
      }),
      clerkUserId,
      email: userEmail ?? payment.email ?? "",
      items: orderItems,
      total: payment.amount / 100,
      status: "paid",
      razorpayPaymentId,
      razorpayOrderId,
      address,
      createdAt: new Date().toISOString(),
    });

    console.log(`Order created: ${order._id}`);

    // 📉 Reduce stock safely (transaction)
    await productIds
      .reduce(
        (tx: any, productId: string, i: number) =>
          tx.patch(productId, (p: any) => p.dec({ stock: quantities[i] })),
        writeClient.transaction()
      )
      .commit();

    console.log("Stock updated successfully");
  } catch (error) {
    console.error("Error handling Razorpay webhook:", error);
    throw error; // Forces Razorpay to retry webhook
  }
}
