import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { client, writeClient } from "@/sanity/lib/client";

const ORDER_BY_RAZORPAY_PAYMENT_ID_QUERY = `
  *[_type == "order" && razorpayPaymentId == $razorpayPaymentId][0]
`;

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  try {
    console.log("🔥 WEBHOOK HIT");

    // 🔍 DEBUG SANITY ENV
    console.log(
      "WRITE TOKEN:",
      process.env.SANITY_API_WRITE_TOKEN?.slice(0, 10)
    );
    console.log("PROJECT:", process.env.NEXT_PUBLIC_SANITY_PROJECT_ID);
    console.log("DATASET:", process.env.NEXT_PUBLIC_SANITY_DATASET);

    const body = await req.text();

    // ✅ Correct header usage
    const signature = (await headers()).get("x-razorpay-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    // 🔐 Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("Signature mismatch");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(body);

    if (event.event !== "payment.captured") {
      return NextResponse.json({ received: true });
    }

    const payment = event.payload.payment.entity;
    await handlePaymentCaptured(payment);

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ error: "Webhook failure" }, { status: 500 });
  }
}

async function handlePaymentCaptured(payment: any) {
  const razorpayPaymentId = payment.id;

  // 🛑 Idempotency check
  const existingOrder = await client.fetch(
    ORDER_BY_RAZORPAY_PAYMENT_ID_QUERY,
    { razorpayPaymentId }
  );

  if (existingOrder) {
    console.log("Webhook already processed");
    return;
  }

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
    console.error("Missing order metadata");
    return;
  }

  const productIds = productIdsString.split(",");
  const quantities = quantitiesString.split(",").map(Number);

  const orderItems = productIds.map((productId: string, index: number) => ({
    _key: `item-${index}`,
    product: { _type: "reference" as const, _ref: productId },
    quantity: quantities[index],
    priceAtPurchase: payment.amount / 100 / productIds.length,
  }));

  const orderNumber = `ORD-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  await writeClient.create({
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
    razorpayOrderId: payment.order_id,
    address: { name: customerName ?? "", country: "IN" },
    createdAt: new Date().toISOString(),
  });

  // 📉 Stock update
  await productIds
    .reduce(
      (tx: any, productId: string, i: number) =>
        tx.patch(productId, (p: any) => p.dec({ stock: quantities[i] })),
      writeClient.transaction()
    )
    .commit();

  console.log("Order saved + stock updated");
}
