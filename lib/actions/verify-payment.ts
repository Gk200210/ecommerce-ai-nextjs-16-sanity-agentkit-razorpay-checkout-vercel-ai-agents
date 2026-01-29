"use server";

import crypto from "crypto";

export async function verifyPayment({
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) {
  try {
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return { success: false, error: "Payment verification failed" };
    }

    // TODO: Save order as paid in DB
    return { success: true };
  } catch (err) {
    return { success: false, error: "Verification error" };
  }
}
