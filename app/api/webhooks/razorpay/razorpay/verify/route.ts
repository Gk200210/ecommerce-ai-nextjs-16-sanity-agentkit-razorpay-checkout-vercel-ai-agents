import crypto from "crypto";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    await req.json();

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body.toString())
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    return NextResponse.json({ success: false }, { status: 400 });
  }

  // ✅ Mark order as paid in DB here

  return NextResponse.json({ success: true });
}
