import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { client, writeClient } from "@/sanity/lib/client";

const ORDER_BY_PAYMENT_ID_QUERY = `
  *[_type == "order" && razorpayPaymentId == $razorpayPaymentId][0]
`;

export async function POST(req: Request) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("Missing RAZORPAY_WEBHOOK_SECRET");
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    // 🔹 Get raw body EXACTLY as Razorpay sends it
    const rawBody = await req.text();

     const signature = (await headers()).get("x-razorpay-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing signature" },
        { status: 400 }
      );
    }

    // 🔐 Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("Invalid webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    const event = JSON.parse(rawBody);

    if (event.event !== "payment.captured") {
      return NextResponse.json({ received: true });
    }

    const payment = event.payload.payment.entity;

    await handlePaymentCaptured(payment);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}

async function handlePaymentCaptured(payment: any) {
  const razorpayPaymentId = payment.id;

  // 🛑 Idempotency check
  const existingOrder = await client.fetch(
    ORDER_BY_PAYMENT_ID_QUERY,
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
    productIds,
    quantities,
    customerName,
  } = notes;

  if (!productIds || !quantities) {
    console.error("Missing order metadata in payment notes");
    return;
  }

  const productIdArray = productIds.split(",");
  const quantityArray = quantities.split(",").map(Number);

  // 🔎 Fetch products to get correct prices
  const products = await client.fetch(
    `*[_type == "product" && _id in $ids]{
      _id,
      price,
      stock
    }`,
    { ids: productIdArray }
  );

  if (!products.length) {
    console.error("Products not found");
    return;
  }

  // 🔐 Validate stock
  for (let i = 0; i < productIdArray.length; i++) {
    const product = products.find(
      (p: any) => p._id === productIdArray[i]
    );

    if (!product || product.stock < quantityArray[i]) {
      console.error("Insufficient stock for", productIdArray[i]);
      return;
    }
  }

  const orderItems = productIdArray.map((productId: string, index: number) => {
    const product = products.find((p: any) => p._id === productId);

    return {
      _key: `item-${index}`,
      product: { _type: "reference", _ref: productId },
      quantity: quantityArray[index],
      priceAtPurchase: product.price,
    };
  });

  const orderNumber = `ORD-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  // 📝 Create order
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
    address: {
      name: customerName ?? "",
      country: "IN",
    },
    createdAt: new Date().toISOString(),
  });

  // 📦 Atomic stock update
  await productIdArray
    .reduce(
      (tx: any, productId: string, index: number) =>
        tx.patch(productId, (p: any) =>
          p.dec({ stock: quantityArray[index] })
        ),
      writeClient.transaction()
    )
    .commit();

  console.log("Order saved and stock updated successfully");
}
