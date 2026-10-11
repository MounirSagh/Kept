import type { UserJSON } from "@clerk/backend";
import { clerk } from "../lib/clerk.js";
import { prisma } from "../lib/prisma.js";

interface ClerkProfile {
  clerkUserId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

function fullName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ") || null;
}

export function profileFromWebhook(data: UserJSON): ClerkProfile | null {
  const email = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  if (!email) return null;
  return {
    clerkUserId: data.id,
    email: email.email_address,
    fullName: fullName(data.first_name, data.last_name),
    avatarUrl: data.image_url || null,
  };
}

export function upsertUser(profile: ClerkProfile) {
  const data = {
    email: profile.email.toLowerCase(),
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
  };
  return prisma.user.upsert({
    where: { clerkUserId: profile.clerkUserId },
    create: { clerkUserId: profile.clerkUserId, ...data },
    update: data,
  });
}

export async function findOrSyncUser(clerkUserId: string) {
  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;

  const clerkUser = await clerk.users.getUser(clerkUserId);
  const email = clerkUser.primaryEmailAddress?.emailAddress;
  if (!email) throw new Error(`Clerk user ${clerkUserId} has no primary email`);

  return upsertUser({
    clerkUserId,
    email,
    fullName: fullName(clerkUser.firstName, clerkUser.lastName),
    avatarUrl: clerkUser.imageUrl || null,
  });
}

export function deleteUserByClerkId(clerkUserId: string) {
  return prisma.user.deleteMany({ where: { clerkUserId } });
}
