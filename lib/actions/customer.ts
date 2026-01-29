"use server";

import Razorpay from "razorpay";
import { client, writeClient } from "@/sanity/lib/client";
import { CUSTOMER_BY_EMAIL_QUERY } from "@/sanity/queries/customer";

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

/**
 * Gets or creates a Razorpay customer by email
 * Also syncs the customer to Sanity database
 */
export async function getOrCreateRazorpayCustomer(
  email: string,
  name: string,
  clerkUserId: string
): Promise<{ razorpayCustomerId: string; sanityCustomerId: string }> {
  /* 1. Check Sanity first */
  const existingCustomer = await client.fetch(CUSTOMER_BY_EMAIL_QUERY, {
    email,
  });

  if (existingCustomer?.razorpayCustomerId) {
    return {
      razorpayCustomerId: existingCustomer.razorpayCustomerId,
      sanityCustomerId: existingCustomer._id,
    };
  }

  /* 2. Check Razorpay by email */
  const razorpay = getRazorpayInstance();
  const customers = await razorpay.customers.all({
    count: 10,
  });

  const matchedCustomer = customers.items.find(
    (c: any) => c.email === email
  );

  let razorpayCustomerId: string;

  if (matchedCustomer) {
    razorpayCustomerId = matchedCustomer.id;
  } else {
    /* 3. Create Razorpay customer */
    const newCustomer = await razorpay.customers.create({
      email,
      name,
      contact: "",
      notes: {
        clerkUserId,
      },
    });

    razorpayCustomerId = newCustomer.id;
  }

  /* 4. Sync with Sanity */
  if (existingCustomer) {
    await writeClient
      .patch(existingCustomer._id)
      .set({
        razorpayCustomerId,
        clerkUserId,
        name,
      })
      .commit();

    return {
      razorpayCustomerId,
      sanityCustomerId: existingCustomer._id,
    };
  }

  /* 5. Create new Sanity customer */
  const newSanityCustomer = await writeClient.create({
    _type: "customer",
    email,
    name,
    clerkUserId,
    razorpayCustomerId,
    createdAt: new Date().toISOString(),
  });

  return {
    razorpayCustomerId,
    sanityCustomerId: newSanityCustomer._id,
  };
}
